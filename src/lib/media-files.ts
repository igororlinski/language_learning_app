import { Directory, File, Paths } from 'expo-file-system';

import {
  MEDIA_DIRECTORIES,
  MEDIA_LIMITS,
  MEDIA_MIME_TYPES,
  storedFileName,
  withinSizeLimit,
  type MediaKind,
} from '@/lib/media';

/**
 * The files attached to card fields — sound and pictures.
 *
 * A picked file lives wherever the system put it and may vanish, so it is
 * copied into the app's own directory and only the **file name** is stored in
 * the database — absolute paths change between installs, the name does not.
 *
 * Picking goes through `File.pickFileAsync` rather than a separate picker
 * library on purpose: on Android the system picker hands back a `content://`
 * URI that the app has no read permission for, and copying from it fails with
 * "missing READ permission". A file picked by this module comes back as a
 * `File` the same module can read.
 */

function directory(kind: MediaKind): Directory {
  const media = new Directory(Paths.document, MEDIA_DIRECTORIES[kind]);
  if (!media.exists) media.create({ intermediates: true });

  return media;
}

/** The uri a player or an image can read, or null when the file is gone. */
export function mediaUri(kind: MediaKind, fileName: string | null | undefined): string | null {
  if (!fileName) return null;

  const file = new File(Paths.document, MEDIA_DIRECTORIES[kind], fileName);
  return file.exists ? file.uri : null;
}

/** Raised when a picked file is over the limit; the editors show the message. */
export class MediaTooLargeError extends Error {
  constructor(
    readonly kind: MediaKind,
    readonly size: number
  ) {
    super(`Plik ma ${size} B, limit to ${MEDIA_LIMITS[kind]} B.`);
    this.name = 'MediaTooLargeError';
  }
}

/** Opens the system picker filtered to the kind. Null means the user backed out. */
export async function pickMedia(kind: MediaKind): Promise<File | null> {
  const picked = await File.pickFileAsync({ mimeTypes: MEDIA_MIME_TYPES[kind] });
  return picked.canceled ? null : picked.result;
}

/**
 * Copies a picked file into the app's directory for that kind and returns the
 * name it was stored under. The size is checked before copying, so an oversized
 * file never lands on the device at all.
 */
export async function importMedia(
  kind: MediaKind,
  source: File
): Promise<{ fileName: string; name: string }> {
  const size = source.size ?? 0;
  if (!withinSizeLimit(kind, size)) throw new MediaTooLargeError(kind, size);

  const fileName = storedFileName(kind, source.name);
  await source.copy(new File(directory(kind), fileName));

  return { fileName, name: source.name };
}

/** What the generator hands back. Declared above its only reader, on purpose. */
const GENERATED_EXTENSION = 'jpg';

/**
 * Writes a generated picture — base64, straight out of the provider's JSON —
 * into the app's directory for its kind, and returns the stored name.
 *
 * The size check happens *after* the write, which is the opposite of an
 * imported file: nothing was picked, so there was no chance to refuse it in
 * advance. An oversized file is deleted again rather than left on the device,
 * so the limit still means what it says everywhere else.
 */
export async function saveGeneratedImage(kind: MediaKind, base64: string): Promise<string> {
  const fileName = storedFileName(kind, `generated.${GENERATED_EXTENSION}`);
  const file = new File(directory(kind), fileName);

  file.create({ overwrite: true, intermediates: true });
  file.write(base64, { encoding: 'base64' });

  if (!withinSizeLimit(kind, file.size)) {
    const size = file.size;
    file.delete();
    throw new MediaTooLargeError(kind, size);
  }

  return fileName;
}

/**
 * Copies a stored file to a new name in the same directory, for a card being
 * copied. Two cards must never share a file: deleting either one clears it and
 * would blank the other.
 *
 * Synchronous on purpose — the card copy runs inside a drizzle transaction,
 * which takes a synchronous callback (`copy()` is the async variant).
 *
 * A source that is already gone yields a name with no file behind it, which is
 * exactly the state the original was in; the field then shows "no file" on both
 * cards instead of one of them silently keeping the last copy.
 */
export function duplicateMedia(kind: MediaKind, fileName: string): string {
  const copyName = storedFileName(kind, fileName);
  const source = new File(Paths.document, MEDIA_DIRECTORIES[kind], fileName);

  if (source.exists) source.copySync(new File(directory(kind), copyName));

  return copyName;
}

/** Removes copies that no field points at any more. Missing files are fine. */
export function deleteMedia(entries: { kind: MediaKind; fileName: string | null }[]): void {
  for (const entry of entries) {
    if (!entry.fileName) continue;

    const file = new File(Paths.document, MEDIA_DIRECTORIES[entry.kind], entry.fileName);
    if (file.exists) file.delete();
  }
}
