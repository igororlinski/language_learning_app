/**
 * The backup zip, without a phone: written from memory, read back from
 * chunks of any size, and refusing what is not ours or points outside the
 * media directories.
 */
import { strToU8 } from 'fflate';

import {
  BACKUP_VERSION,
  backupFileName,
  backupManifest,
  backupProblem,
  collect,
  DATABASE_ENTRY,
  MANIFEST_ENTRY,
  manifestBytes,
  mediaEntry,
  parseManifest,
  parseMediaEntry,
  readArchive,
  writeArchive,
  type ArchiveSource,
} from '@/lib/archive';

import { check, group } from './harness';

group('Archiwum kopii: manifest');

const counts = { decks: 2, cards: 40, reviews: 300, media: 3 };
const manifest = backupManifest(1761000000000, counts, new Date(2026, 9, 23, 14, 5));

check('manifest wraca z bajtow', parseManifest(manifestBytes(manifest)), manifest);
check('obcy JSON to nie kopia', parseManifest(strToU8('{"format":"anki"}')), null);
check('smieci tez', parseManifest(strToU8('PK\u0003\u0004')), null);
check('brak licznika to nie kopia', parseManifest(strToU8(JSON.stringify({ ...manifest, counts: { decks: 1 } }))), null);

check('ta sama wersja schematu — mozna', backupProblem(manifest, 1761000000000), null);
// An older backup is fine: the restore runs the migrations it is missing.
check('starsza — mozna', backupProblem(manifest, 1762000000000), null);
check('z nowszej aplikacji — nie', backupProblem(manifest, 1760000000000), 'newer');
check(
  'nowszy uklad zipa — nie',
  backupProblem({ ...manifest, version: BACKUP_VERSION + 1 }, 1761000000000),
  'newer'
);
check('bez manifestu — to nie kopia', backupProblem(null, 1761000000000), 'not-backup');

check('nazwa pliku sortuje sie z data', backupFileName(new Date(2026, 9, 3, 9, 7)), 'fiszki-2026-10-03-0907.zip');

group('Archiwum kopii: sciezki plikow');

const DIRS = ['card-images', 'card-audio'];

check('plik obrazu', parseMediaEntry(mediaEntry('card-images', 'a.jpg'), DIRS), {
  directory: 'card-images',
  fileName: 'a.jpg',
});
// A backup is a file from somewhere: it must not be a way to overwrite the app.
check('wyjscie w gore odrzucone', parseMediaEntry('media/card-images/../../x.db', DIRS), null);
check('dwie kropki jako nazwa tez', parseMediaEntry('media/card-images/..', DIRS), null);
check('zagniezdzony katalog odrzucony', parseMediaEntry('media/card-images/x/y.jpg', DIRS), null);
check('nieznany katalog odrzucony', parseMediaEntry('media/secrets/a.jpg', DIRS), null);
check('ukosnik wsteczny odrzucony', parseMediaEntry('media/card-images/..\\a', DIRS), null);
check('baza to nie plik karty', parseMediaEntry(DATABASE_ENTRY, DIRS), null);

group('Archiwum kopii: zapis i odczyt');

/** Bytes of a given size with a pattern, so a misplaced byte shows. */
const pattern = (size: number, seed: number) =>
  Uint8Array.from({ length: size }, (_, index) => (index * 31 + seed) % 251);

/** Yields the bytes in pieces, the way a FileHandle hands them over. */
function* pieces(bytes: Uint8Array, size: number) {
  for (let offset = 0; offset < bytes.length; offset += size) yield bytes.slice(offset, offset + size);
}

const database = pattern(200_000, 7);
const picture = pattern(70_000, 3);
const sources: ArchiveSource[] = [
  { name: MANIFEST_ENTRY, compress: true, chunks: () => [manifestBytes(manifest)] },
  { name: DATABASE_ENTRY, compress: true, chunks: () => pieces(database, 65_536) },
  { name: mediaEntry('card-images', 'a.jpg'), compress: false, chunks: () => pieces(picture, 4096) },
  { name: mediaEntry('card-audio', 'empty.m4a'), compress: false, chunks: () => [] },
];

const written: Uint8Array[] = [];
await writeArchive(sources, (chunk) => written.push(chunk));

const zipped = collect();
written.forEach((chunk) => zipped.write(chunk));
const zipBytes = zipped.bytes();

check('zip zaczyna sie od naglowka PK', [zipBytes[0], zipBytes[1]], [0x50, 0x4b]);

/** Reads everything back, chunked at `size`, into a name → bytes map. */
async function unpack(size: number) {
  const entries = new Map<string, ReturnType<typeof collect>>();

  await readArchive(pieces(zipBytes, size), (name) => {
    const sink = collect();
    entries.set(name, sink);
    return sink;
  });

  return entries;
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i]);

for (const size of [7, 1000, 1 << 20]) {
  const entries = await unpack(size);

  check(`kawalki po ${size} B: wszystkie wpisy w kolejnosci`, [...entries.keys()], sources.map((s) => s.name));
  check(`kawalki po ${size} B: baza bajt w bajt`, same(entries.get(DATABASE_ENTRY)!.bytes(), database), true);
  check(
    `kawalki po ${size} B: obraz bajt w bajt`,
    same(entries.get(mediaEntry('card-images', 'a.jpg'))!.bytes(), picture),
    true
  );
}

const unpacked = await unpack(4096);
check('pusty plik zostaje pusty', unpacked.get(mediaEntry('card-audio', 'empty.m4a'))?.bytes().length, 0);
check('kazdy wpis zamkniety', [...unpacked.values()].every((sink) => sink.closed()), true);
check(
  'manifest z zipa',
  parseManifest(unpacked.get(MANIFEST_ENTRY)!.bytes()),
  manifest
);

// Peeking stops after the manifest: no need to read the videos to show what a backup is.
let pushed = 0;
const peek = collect();
await readArchive(
  (function* () {
    for (const chunk of pieces(zipBytes, 512)) {
      pushed += 1;
      yield chunk;
    }
  })(),
  (name) => (name === MANIFEST_ENTRY ? peek : null),
  () => peek.closed()
);

check('podglad czyta manifest', parseManifest(peek.bytes())?.counts, counts);
check('i konczy wczesnie', pushed < Math.ceil(zipBytes.length / 512), true);

// Garbage either throws or yields no entry; either way no manifest comes out,
// and the missing manifest is what the restore refuses on.
const garbageEntries: string[] = [];
try {
  await readArchive([strToU8('to nie jest zip, tylko tekst udajacy plik')], (name) => {
    garbageEntries.push(name);
    return collect();
  });
} catch {
  // thrown is fine too
}
check('smieci nie daja manifestu', garbageEntries.includes(MANIFEST_ENTRY), false);
