import { Directory, File, Paths } from 'expo-file-system';

import { AUDIO_DIRECTORY, MAX_AUDIO_BYTES, storedFileName, withinSizeLimit } from '@/lib/audio';

/**
 * The audio copies attached to card fields.
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

function directory(): Directory {
  const audio = new Directory(Paths.document, AUDIO_DIRECTORY);
  if (!audio.exists) audio.create({ intermediates: true });

  return audio;
}

/** The uri a player can read, or null when the file is gone. */
export function audioUri(fileName: string | null | undefined): string | null {
  if (!fileName) return null;

  const file = new File(Paths.document, AUDIO_DIRECTORY, fileName);
  return file.exists ? file.uri : null;
}

/** Raised when a picked file is over the limit; the editors show the message. */
export class AudioTooLargeError extends Error {
  constructor(readonly size: number) {
    super(`Plik ma ${size} B, limit to ${MAX_AUDIO_BYTES} B.`);
    this.name = 'AudioTooLargeError';
  }
}

/** Opens the system picker filtered to audio. Null means the user backed out. */
export async function pickAudio(): Promise<File | null> {
  const picked = await File.pickFileAsync({ mimeTypes: 'audio/*' });
  return picked.canceled ? null : picked.result;
}

/**
 * Copies a picked file into the app's audio directory and returns the name it
 * was stored under. The size is checked before copying, so an oversized file
 * never lands on the device at all.
 */
export async function importAudio(source: File): Promise<{ fileName: string; name: string }> {
  const size = source.size ?? 0;
  if (!withinSizeLimit(size)) throw new AudioTooLargeError(size);

  const fileName = storedFileName(source.name);
  await source.copy(new File(directory(), fileName));

  return { fileName, name: source.name };
}

/** Removes copies that no field points at any more. Missing files are fine. */
export function deleteAudio(fileNames: (string | null | undefined)[]): void {
  for (const name of fileNames) {
    if (!name) continue;

    const file = new File(Paths.document, AUDIO_DIRECTORY, name);
    if (file.exists) file.delete();
  }
}
