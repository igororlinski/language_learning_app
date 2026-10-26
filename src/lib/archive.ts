import {
  strFromU8,
  strToU8,
  Unzip,
  UnzipInflate,
  UnzipPassThrough,
  Zip,
  ZipDeflate,
  ZipPassThrough,
} from 'fflate';

/**
 * The backup file: one `.zip` the user can keep anywhere, and what is in it.
 *
 * ```
 * fiszki-2026-10-23-1405.zip
 * ├ manifest.json   what this is, from which schema, how much is inside
 * ├ collection.db   the whole SQLite database, as `serializeSync()` gives it
 * └ media/card-images/…, media/card-audio/…   the files card fields point at
 * ```
 *
 * A zip rather than a format of our own so that a backup is something a
 * computer can open, and `fflate` rather than a native module because Expo Go
 * has no zip of its own. Everything here works on chunks of bytes and never
 * touches a file: the phone side (`backup-files.ts`) feeds it from
 * `FileHandle.readBytesSync` and drains it into `writeBytesSync`, and the tests feed it
 * from memory. Chunks matter — a backup with videos is hundreds of megabytes,
 * and holding it whole in memory is how a phone kills an app.
 *
 * Media is stored, not deflated: JPEG, M4A and MP4 are compressed already and
 * deflating them again costs time for nothing. The database deflates well.
 */

export const BACKUP_FORMAT = 'fiszki-backup';
/** Raised when the layout of the zip itself changes, not the database schema. */
export const BACKUP_VERSION = 1;

export const MANIFEST_ENTRY = 'manifest.json';
export const DATABASE_ENTRY = 'collection.db';
const MEDIA_PREFIX = 'media/';

export type BackupCounts = { decks: number; cards: number; reviews: number; media: number };

export type BackupManifest = {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  /**
   * The newest migration the database has, as drizzle records it
   * (`__drizzle_migrations.created_at`, the journal's `when`). A backup newer
   * than the app reading it holds tables this app does not know.
   */
  migratedTo: number;
  counts: BackupCounts;
};

export function backupManifest(
  migratedTo: number,
  counts: BackupCounts,
  now = new Date()
): BackupManifest {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: now.toISOString(),
    migratedTo,
    counts,
  };
}

export const manifestBytes = (manifest: BackupManifest) =>
  strToU8(JSON.stringify(manifest, null, 2));

const isCount = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** The manifest out of its bytes, or null for anything that is not ours. */
export function parseManifest(bytes: Uint8Array): BackupManifest | null {
  let data: Record<string, unknown>;

  try {
    data = JSON.parse(strFromU8(bytes));
  } catch {
    return null;
  }

  const counts = data?.counts as Record<string, unknown> | undefined;

  if (
    data?.format !== BACKUP_FORMAT ||
    !isCount(data.version) ||
    typeof data.createdAt !== 'string' ||
    Number.isNaN(Date.parse(data.createdAt)) ||
    typeof data.migratedTo !== 'number' ||
    !counts ||
    !['decks', 'cards', 'reviews', 'media'].every((key) => isCount(counts[key]))
  ) {
    return null;
  }

  return data as unknown as BackupManifest;
}

export type BackupProblem = 'not-backup' | 'newer' | 'damaged';

/**
 * Whether this app can restore a backup. An older one is fine — the restore
 * runs the migrations it is missing, the same ones a phone runs on update.
 */
export function backupProblem(
  manifest: BackupManifest | null,
  appMigratedTo: number
): BackupProblem | null {
  if (!manifest) return 'not-backup';
  if (manifest.version > BACKUP_VERSION || manifest.migratedTo > appMigratedTo) return 'newer';

  return null;
}

/** Where a card's file goes inside the zip. */
export const mediaEntry = (directory: string, fileName: string) =>
  `${MEDIA_PREFIX}${directory}/${fileName}`;

/**
 * A media entry back into its directory and file name — or null for anything
 * else, and in particular for any name that could write outside the media
 * directories (`..`, nested folders, an unknown directory). A backup is a file
 * from somewhere; the restore must not be a way to overwrite the app.
 */
export function parseMediaEntry(
  name: string,
  directories: readonly string[]
): { directory: string; fileName: string } | null {
  if (!name.startsWith(MEDIA_PREFIX)) return null;

  const parts = name.slice(MEDIA_PREFIX.length).split('/');

  if (parts.length !== 2) return null;

  const [directory, fileName] = parts;

  if (!directories.includes(directory)) return null;
  if (!fileName || fileName === '.' || fileName === '..' || /[\\:]/.test(fileName)) return null;

  return { directory, fileName };
}

/* ------------------------------------------------------------------ write */

type Chunks = Iterable<Uint8Array> | AsyncIterable<Uint8Array>;

export type ArchiveSource = {
  name: string;
  /** Deflate it — worth it for the database and JSON, not for media. */
  compress: boolean;
  chunks: () => Chunks;
};

/** Lets the screen draw its spinner between files instead of freezing. */
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Writes the sources, in order, as one zip into `write`. The manifest goes
 * first so that a restore can read what a backup is without unpacking it.
 */
export async function writeArchive(
  sources: readonly ArchiveSource[],
  write: (chunk: Uint8Array) => void
): Promise<void> {
  let failure: Error | null = null;

  const zip = new Zip((error, chunk) => {
    if (error) failure = error;
    else write(chunk);
  });

  for (const source of sources) {
    const entry = source.compress
      ? new ZipDeflate(source.name, { level: 6 })
      : new ZipPassThrough(source.name);

    zip.add(entry);

    for await (const chunk of source.chunks()) {
      entry.push(chunk, false);
      if (failure) throw failure;
    }

    entry.push(new Uint8Array(0), true);
    if (failure) throw failure;

    await breathe();
  }

  zip.end();
  if (failure) throw failure;
}

/* ------------------------------------------------------------------- read */

/** Where one entry's bytes go. */
export type ArchiveSink = { write: (chunk: Uint8Array) => void; close: () => void };

/**
 * Reads a zip from chunks and hands each entry to the sink `open` returns for
 * its name — or skips it, when `open` returns null. `done` lets a reader stop
 * early: the manifest is the first entry, and peeking at a backup should not
 * mean reading three hundred megabytes of video.
 */
export async function readArchive(
  chunks: Chunks,
  open: (name: string) => ArchiveSink | null,
  done: () => boolean = () => false
): Promise<void> {
  let failure: Error | null = null;

  const unzip = new Unzip((file) => {
    const sink = open(file.name);

    if (!sink) return;

    file.ondata = (error, data, final) => {
      if (error) {
        failure = error;
        return;
      }

      sink.write(data);
      if (final) sink.close();
    };

    file.start();
  });

  unzip.register(UnzipPassThrough);
  unzip.register(UnzipInflate);

  let count = 0;

  for await (const chunk of chunks) {
    unzip.push(chunk, false);
    if (failure) throw failure;
    if (done()) return;

    count += 1;
    if (count % 16 === 0) await breathe();
  }

  unzip.push(new Uint8Array(0), true);
  if (failure) throw failure;
}

/** A sink that keeps the entry in memory — for the manifest and the database. */
export function collect(): ArchiveSink & { bytes: () => Uint8Array; closed: () => boolean } {
  const parts: Uint8Array[] = [];
  let closed = false;

  return {
    write: (chunk) => parts.push(chunk),
    close: () => {
      closed = true;
    },
    closed: () => closed,
    bytes: () => {
      const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
      let offset = 0;

      for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
      }

      return out;
    },
  };
}

/** `fiszki-2026-10-23-1405.zip` — sortable, and says what it is. */
export function backupFileName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');

  return (
    `fiszki-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}.zip`
  );
}
