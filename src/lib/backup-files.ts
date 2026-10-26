import { Directory, File, FileMode, Paths, type FileHandle } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { backupDatabaseSync, deserializeDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';

import migrations from '@drizzle/migrations';

import { db, sqliteDb } from '@/db/client';
import { backupCounts, phoneBackupState, putPhoneBackupState, setLastBackup } from '@/db/queries';
import {
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
  type ArchiveSink,
  type ArchiveSource,
  type BackupManifest,
  type BackupProblem,
} from '@/lib/archive';
import { databaseReplaced } from '@/lib/data-generation';
import { MEDIA_DIRECTORIES } from '@/lib/media';

/**
 * Backups on the phone: making one, handing it out of the app, and putting
 * one back. The zip itself is `archive.ts`, with tests; this is the part that
 * needs a device — files, the live database, the share sheet.
 *
 * **A backup has to leave the app to be one.** Anything kept in the app's own
 * directory goes with an uninstall — the exact thing it was meant to survive —
 * so a new backup is either written straight into a folder the user picks, or
 * handed to the system share sheet (Drive, e-mail…). Android's share sheet has
 * no „save to Files" — reported from the phone 2026-10-23 — hence the folder.
 *
 * **What is not in it:** the AI keys. They live in the phone's secure storage,
 * never in the database (`ai-keys-store.ts`), and a file the user e-mails
 * around is the last place a key belongs. Everything else — decks, cards,
 * history, settings, files — is.
 */

/** Every directory a card's file can live in, once each. */
const MEDIA_DIRS = [...new Set(Object.values(MEDIA_DIRECTORIES))];

/** The newest migration this build knows — the journal's last `when`. */
const APP_MIGRATED_TO = Math.max(...migrations.journal.entries.map((entry) => entry.when));

/** What one read of a file asks for — big enough to be quick, small enough to be cheap. */
const CHUNK = 512 * 1024;

/** Where the latest backup sits until the share sheet has taken it. */
const outbox = () => ensure(new Directory(Paths.cache, 'backups'));

/** Where restores stage their files before they are swapped in. */
const staging = () => new Directory(Paths.cache, 'restore');

/** The state before the last restore — the one way back from a wrong file. */
const safetyFile = () => new File(ensure(new Directory(Paths.document, 'backups')), 'przed-przywroceniem.zip');

export function ensure(directory: Directory): Directory {
  if (!directory.exists) directory.create({ intermediates: true });
  return directory;
}

/** Raised for anything a restore refuses; the screen turns `problem` into a sentence. */
export class BackupError extends Error {
  constructor(readonly problem: BackupProblem) {
    super(problem);
    this.name = 'BackupError';
  }
}

/** A file's bytes, in pieces, from a handle — never the whole file at once. */
export function* fileChunks(file: File): Generator<Uint8Array> {
  const handle = file.open(FileMode.ReadOnly);

  try {
    for (;;) {
      const chunk = handle.readBytesSync(CHUNK);
      if (chunk.length === 0) return;
      yield chunk;
      if (chunk.length < CHUNK) return;
    }
  } finally {
    handle.close();
  }
}

/** The media files as zip sources, with how many there are. */
function mediaSources(): ArchiveSource[] {
  const sources: ArchiveSource[] = [];

  for (const name of MEDIA_DIRS) {
    const directory = new Directory(Paths.document, name);
    if (!directory.exists) continue;

    for (const entry of directory.list()) {
      if (entry instanceof File) {
        sources.push({ name: mediaEntry(name, entry.name), compress: false, chunks: () => fileChunks(entry) });
      }
    }
  }

  return sources;
}

/** Writes a full backup through an open handle. The database is read in one consistent snapshot. */
async function writeBackupInto(handle: FileHandle): Promise<BackupManifest> {
  const media = mediaSources();
  const database = sqliteDb.serializeSync();
  const manifest = backupManifest(APP_MIGRATED_TO, { ...backupCounts(), media: media.length });

  await writeArchive(
    [
      { name: MANIFEST_ENTRY, compress: true, chunks: () => [manifestBytes(manifest)] },
      { name: DATABASE_ENTRY, compress: true, chunks: () => [database] },
      ...media,
    ],
    (chunk) => handle.writeBytesSync(chunk)
  );

  return manifest;
}

/** Writes a full backup into `target`, which must already exist. */
async function writeBackupTo(target: File): Promise<BackupManifest> {
  return writeInto(target, writeBackupInto);
}

/** Runs `write` on a handle to `target`, which must already exist. A failure leaves no half a file behind. */
export async function writeInto<T>(target: File, write: (handle: FileHandle) => Promise<T>): Promise<T> {
  const handle = target.open(FileMode.WriteOnly);

  try {
    const result = await write(handle);
    handle.close();
    return result;
  } catch (error) {
    handle.close();
    try {
      target.delete();
    } catch {
      // Already gone, or the folder will not let go of it — the error below says more.
    }
    throw error;
  }
}

/** Writes a full backup into a file of the app's own, replacing what was there. */
export async function writeBackup(target: File): Promise<BackupManifest> {
  if (target.exists) target.delete();
  target.create();

  return writeBackupTo(target);
}

/**
 * Picks a folder and saves a backup straight into it — the one way of saving
 * where the app *knows* the file landed, so the only one that counts as
 * „Ostatnia kopia". Null when the user backed out of the picker.
 *
 * Android's folder picker (`ACTION_OPEN_DOCUMENT_TREE`) does not offer the
 * root of Downloads or of the storage itself, only folders in them — the
 * picker has its own „create folder" for that. `initialUri` opens it where
 * the last backup went.
 */
export async function saveBackupToFolder(initialUri?: string, now = new Date()): Promise<string | null> {
  const folder = await pickFolder(initialUri);
  if (!folder) return null;

  const file = folder.createFile(backupFileName(now), 'application/zip');
  await writeBackupTo(file);

  setLastBackup(now, folder.uri);

  return folder.uri;
}

/** The system folder picker; null when the user backed out of it. */
export async function pickFolder(initialUri?: string): Promise<Directory | null> {
  try {
    return await Directory.pickDirectoryAsync(initialUri);
  } catch (error) {
    if (isCancelled(error)) return null;
    throw error;
  }
}

/** The native picker rejects instead of resolving when backed out of. */
const isCancelled = (error: unknown) =>
  (error as { code?: string } | null)?.code === 'ERR_PICKER_CANCELLED' ||
  (error instanceof Error && /cancel/i.test(error.message));

/**
 * Makes a backup and opens the share sheet on it (Drive, e-mail…). Older
 * backups waiting in the outbox are dropped first — they were shared
 * already, or never will be.
 *
 * Not recorded as „Ostatnia kopia": the share sheet comes back the same way
 * whether the file went somewhere or the user just closed it.
 */
export async function shareBackup(now = new Date()): Promise<void> {
  const file = outboxFile(backupFileName(now));
  await writeBackup(file);
  await shareFile(file, 'Udostępnij kopię zapasową');
}

/**
 * A fresh file in the outbox, where a zip waits for the share sheet. Whatever
 * waited there before goes first — it was shared already, or never will be.
 */
export function outboxFile(name: string): File {
  const box = outbox();

  for (const entry of box.list()) entry.delete();

  return new File(box, name);
}

export const shareFile = (file: File, dialogTitle: string) =>
  Sharing.shareAsync(file.uri, { mimeType: 'application/zip', dialogTitle });

/** The system picker, for a zip. Null when the user backed out. */
export async function pickBackup(): Promise<File | null> {
  const picked = await File.pickFileAsync({
    mimeTypes: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'],
  });

  return picked.canceled ? null : picked.result;
}

/** What a backup holds, read from its first entry only — for the question before restoring. */
export async function readBackupManifest(file: File): Promise<BackupManifest> {
  const sink = collect();

  try {
    await readArchive(
      fileChunks(file),
      (name) => (name === MANIFEST_ENTRY ? sink : null),
      () => sink.closed()
    );
  } catch {
    throw new BackupError('damaged');
  }

  const manifest = sink.closed() ? parseManifest(sink.bytes()) : null;
  const problem = backupProblem(manifest, APP_MIGRATED_TO);

  if (problem || !manifest) throw new BackupError(problem ?? 'not-backup');

  return manifest;
}

/** Whether there is a state from before the last restore to go back to. */
export const hasSafetyBackup = () => safetyFile().exists;

export const safetyBackup = () => safetyFile();

/** A sink writing one staged media file. */
function stagedFile(directory: string, fileName: string): ArchiveSink {
  const file = new File(ensure(new Directory(staging(), directory)), fileName);

  if (file.exists) file.delete();
  file.create();

  const handle = file.open(FileMode.WriteOnly);

  return { write: (chunk) => handle.writeBytesSync(chunk), close: () => handle.close() };
}

/** The newest migration a database has had, or null when it is not one of ours. */
function migratedTo(database: SQLiteDatabase): number | null {
  try {
    const row = database.getFirstSync<{ at: number | null }>('select max(created_at) as at from __drizzle_migrations');
    const decks = database.getFirstSync<{ n: number }>(
      "select count(*) as n from sqlite_master where type = 'table' and name = 'decks'"
    );

    return row?.at != null && decks?.n === 1 ? Number(row.at) : null;
  } catch {
    return null;
  }
}

/**
 * Replaces everything with what the backup holds.
 *
 * In this order, so that nothing on the phone is touched until the file has
 * proved itself:
 *
 * 1. unpack — the database into memory, the files into a staging folder;
 * 2. check — manifest, schema level, `quick_check` on the database itself;
 * 3. save the current state as „przed przywróceniem" — one way back;
 * 4. copy the backup's database over the live one (SQLite backup API, same
 *    connection, so `db` keeps working) and run the migrations it is missing;
 * 5. swap the media folders.
 *
 * If step 4 or 5 fails, the database snapshot from before is put back.
 */
export async function restoreBackup(file: File): Promise<BackupManifest> {
  const box = staging();
  if (box.exists) box.delete();
  ensure(box);

  const manifestSink = collect();
  const databaseSink = collect();

  try {
    await readArchive(fileChunks(file), (name) => {
      if (name === MANIFEST_ENTRY) return manifestSink;
      if (name === DATABASE_ENTRY) return databaseSink;

      const media = parseMediaEntry(name, MEDIA_DIRS);

      return media ? stagedFile(media.directory, media.fileName) : null;
    });
  } catch {
    box.delete();
    throw new BackupError('damaged');
  }

  const manifest = manifestSink.closed() ? parseManifest(manifestSink.bytes()) : null;
  const problem = backupProblem(manifest, APP_MIGRATED_TO);

  if (problem || !manifest) {
    box.delete();
    throw new BackupError(problem ?? 'not-backup');
  }

  if (!databaseSink.closed()) {
    box.delete();
    throw new BackupError('damaged');
  }

  let restored: SQLiteDatabase;

  try {
    restored = deserializeDatabaseSync(databaseSink.bytes());
  } catch {
    box.delete();
    throw new BackupError('damaged');
  }

  const level = migratedTo(restored);
  const healthy = restored.getFirstSync<{ quick_check: string }>('pragma quick_check')?.quick_check === 'ok';

  if (level == null || !healthy) {
    restored.closeSync();
    box.delete();
    throw new BackupError(level == null ? 'not-backup' : 'damaged');
  }

  if (level > APP_MIGRATED_TO) {
    restored.closeSync();
    box.delete();
    throw new BackupError('newer');
  }

  // The way back, before anything is overwritten: a full backup on disk for
  // "Cofnij przywracanie", and the database in memory for a failure below.
  await writeBackup(safetyFile());
  const before = sqliteDb.serializeSync();
  const phone = phoneBackupState();

  try {
    backupDatabaseSync({ sourceDatabase: restored, destDatabase: sqliteDb });
    restored.closeSync();
    sqliteDb.execSync('PRAGMA foreign_keys = ON;');
    await migrate(db, migrations);
    putPhoneBackupState(phone);
    swapMedia();
  } catch (error) {
    const previous = deserializeDatabaseSync(before);
    backupDatabaseSync({ sourceDatabase: previous, destDatabase: sqliteDb });
    previous.closeSync();
    box.delete();
    throw error;
  }

  box.delete();
  databaseReplaced();

  return manifest;
}

/**
 * The staged files become the app's files; whatever was there before goes.
 * Not atomic — a failure halfway leaves a mix — which is what the
 * „przed przywróceniem" backup written just before is for.
 */
function swapMedia(): void {
  for (const name of MEDIA_DIRS) {
    const live = new Directory(Paths.document, name);
    const staged = new Directory(staging(), name);

    if (live.exists) live.delete();
    if (!staged.exists) continue;

    ensure(live);

    for (const entry of staged.list()) {
      if (entry instanceof File) entry.moveSync(new File(live, entry.name));
    }
  }
}
