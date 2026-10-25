import { strFromU8 } from 'fflate';
import { Directory, File, FileMode, Paths, type FileHandle } from 'expo-file-system';

import {
  deckMediaFiles,
  exportDeckPackage,
  importCsvCards,
  importDeckPackage,
  createDeck,
  type CsvImportResult,
  type DeckImportResult,
} from '@/db/queries';
import { DEFAULT_NEW_PER_DAY, DEFAULT_REVIEWS_PER_DAY } from '@/db/schema';
import {
  collect,
  MANIFEST_ENTRY,
  mediaEntry,
  parseManifest,
  parseMediaEntry,
  readArchive,
  writeArchive,
  type ArchiveSink,
  type ArchiveSource,
} from '@/lib/archive';
import { ensure, fileChunks, outboxFile, pickFolder, shareFile, writeInto } from '@/lib/backup-files';
import { parseCsv, type CsvCard } from '@/lib/csv-import';
import {
  DECK_ENTRY,
  DECK_VERSION,
  deckFileName,
  deckManifest,
  jsonBytes,
  parseDeckManifest,
  parseDeckPackage,
  type DeckManifest,
} from '@/lib/deck-package';
import { MEDIA_DIRECTORIES, storedFileName } from '@/lib/media';

/**
 * Decks and spreadsheets on the phone: a deck written out as a file, and a
 * file — a deck or a CSV — read back in. The formats are `deck-package.ts` and
 * `csv-import.ts`, with tests; the rows are `queries.ts`; this is the part
 * that needs a device. The backup's helpers (`backup-files.ts`) do the folder
 * picker, the share sheet and the reading in pieces for both.
 */

const MEDIA_DIRS = [...new Set(Object.values(MEDIA_DIRECTORIES))];

/** Where an import stages a deck's files before they get their names here. */
const staging = () => new Directory(Paths.cache, 'import');

/** A spreadsheet is text; one this big is not a list of words. */
const MAX_CSV_BYTES = 20 * 1024 * 1024;

export class ImportError extends Error {
  constructor(readonly problem: 'unknown' | 'damaged' | 'newer' | 'empty' | 'too-large') {
    super(problem);
    this.name = 'ImportError';
  }
}

/* ----------------------------------------------------------------- export */

/** Writes one deck as a zip through `handle`; the deck's name is what the screen tells the user. */
async function writeDeck(deckId: number, withProgress: boolean, handle: FileHandle): Promise<void> {
  const pkg = exportDeckPackage(deckId, withProgress);
  if (!pkg) throw new Error('Talii już nie ma.');

  const media: ArchiveSource[] = [];
  const seen = new Set<string>();

  for (const { kind, fileName } of deckMediaFiles(deckId)) {
    const entry = mediaEntry(MEDIA_DIRECTORIES[kind], fileName);
    const file = new File(Paths.document, MEDIA_DIRECTORIES[kind], fileName);

    if (seen.has(entry) || !file.exists) continue;
    seen.add(entry);
    media.push({ name: entry, compress: false, chunks: () => fileChunks(file) });
  }

  await writeArchive(
    [
      { name: MANIFEST_ENTRY, compress: true, chunks: () => [jsonBytes(deckManifest(pkg))] },
      { name: DECK_ENTRY, compress: true, chunks: () => [jsonBytes(pkg)] },
      ...media,
    ],
    (chunk) => handle.writeBytes(chunk)
  );
}

/** Saves a deck into a folder the user picks. False when they backed out of the picker. */
export async function saveDeckToFolder(
  deckId: number,
  deckName: string,
  withProgress: boolean,
  initialUri?: string
): Promise<boolean> {
  const folder = await pickFolder(initialUri);
  if (!folder) return false;

  const file = folder.createFile(deckFileName(deckName), 'application/zip');
  await writeInto(file, (handle) => writeDeck(deckId, withProgress, handle));

  return true;
}

/** Writes a deck and opens the share sheet on it. */
export async function shareDeck(deckId: number, deckName: string, withProgress: boolean): Promise<void> {
  const file = outboxFile(deckFileName(deckName));

  file.create();
  await writeInto(file, (handle) => writeDeck(deckId, withProgress, handle));
  await shareFile(file, 'Udostępnij talię');
}

/* ----------------------------------------------------------------- import */

/** What a picked file turned out to be — read before anything is imported. */
export type ImportFile =
  | { kind: 'backup' }
  | { kind: 'deck'; file: File; manifest: DeckManifest }
  | { kind: 'csv'; rows: CsvCard[]; name: string };

/** Any file: a deck, a spreadsheet, or something to say no to. Null when backed out. */
export async function pickImportFile(): Promise<File | null> {
  const picked = await File.pickFileAsync({ mimeTypes: ['*/*'] });

  return picked.canceled ? null : picked.result;
}

/** The first bytes of a file, without reading the rest. */
function head(file: File): Uint8Array {
  const chunks = fileChunks(file);
  const first = chunks.next();

  chunks.return(undefined); // closes the handle
  return first.done ? new Uint8Array(0) : first.value;
}

const isZip = (bytes: Uint8Array) => bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

/** The name a new deck made from a spreadsheet gets: the file's, without its extension. */
const baseName = (file: File) => file.name.replace(/\.[^.]+$/, '').trim() || 'Import';

/**
 * Tells what a file is by its content, not its name — a picker hands over
 * whatever a name the provider likes. A zip is ours by its manifest; anything
 * else is read as a spreadsheet.
 */
export async function inspectImportFile(file: File): Promise<ImportFile> {
  if (isZip(head(file))) {
    const sink = collect();

    try {
      await readArchive(
        fileChunks(file),
        (name) => (name === MANIFEST_ENTRY ? sink : null),
        () => sink.closed()
      );
    } catch {
      throw new ImportError('damaged');
    }

    const bytes = sink.closed() ? sink.bytes() : null;

    if (bytes && parseManifest(bytes)) return { kind: 'backup' };

    const manifest = bytes ? parseDeckManifest(bytes) : null;
    if (!manifest) throw new ImportError('unknown');
    if (manifest.version > DECK_VERSION) throw new ImportError('newer');

    return { kind: 'deck', file, manifest };
  }

  if ((file.size ?? 0) > MAX_CSV_BYTES) throw new ImportError('too-large');

  const parts = [...fileChunks(file)];
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;

  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }

  const rows = parseCsv(strFromU8(bytes));
  if (rows.length === 0) throw new ImportError('empty');

  return { kind: 'csv', rows, name: baseName(file) };
}

/** A sink writing one staged media file. */
function stagedFile(directory: string, fileName: string): ArchiveSink {
  const file = new File(ensure(new Directory(staging(), directory)), fileName);

  if (file.exists) file.delete();
  file.create();

  const handle = file.open(FileMode.WriteOnly);

  return { write: (chunk) => handle.writeBytes(chunk), close: () => handle.close() };
}

/**
 * Imports a deck file: unpacked to staging, joined into the database
 * (`importDeckPackage` — new cards in, known ones left alone), then each file
 * of an added card copied in under its new name.
 */
export async function importDeckFile(file: File): Promise<DeckImportResult> {
  const box = staging();
  if (box.exists) box.delete();
  ensure(box);

  const deckSink = collect();

  try {
    try {
      await readArchive(fileChunks(file), (name) => {
        if (name === DECK_ENTRY) return deckSink;

        const media = parseMediaEntry(name, MEDIA_DIRS);
        return media ? stagedFile(media.directory, media.fileName) : null;
      });
    } catch {
      throw new ImportError('damaged');
    }

    const pkg = deckSink.closed() ? parseDeckPackage(deckSink.bytes()) : null;
    if (!pkg) throw new ImportError('damaged');

    const result = importDeckPackage(pkg, (kind, fileName) => storedFileName(kind, fileName));

    for (const { kind, from, to } of result.media) {
      const staged = new File(staging(), MEDIA_DIRECTORIES[kind], from);
      const target = ensure(new Directory(Paths.document, MEDIA_DIRECTORIES[kind]));

      // A missing file stays missing — the field says so, as it did there.
      if (staged.exists) staged.copySync(new File(target, to));
    }

    return result;
  } finally {
    if (box.exists) box.delete();
  }
}

/** Cards from a spreadsheet into a deck — `deckId`, or a new deck named `newDeckName`. */
export function importCsv(
  rows: CsvCard[],
  target: { deckId: number } | { newDeckName: string }
): CsvImportResult & { deckId: number } {
  const deckId =
    'deckId' in target
      ? target.deckId
      : createDeck({ name: target.newDeckName, newPerDay: DEFAULT_NEW_PER_DAY, reviewsPerDay: DEFAULT_REVIEWS_PER_DAY })
          .id;

  return { ...importCsvCards(deckId, rows), deckId };
}
