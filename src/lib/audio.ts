/**
 * Rules for audio attached to card fields, kept free of any file-system calls
 * so they can be tested without a device. The actual copying lives in
 * `src/lib/audio-files.ts`.
 */

/** Where the copies live, relative to the app's document directory. */
export const AUDIO_DIRECTORY = 'card-audio';

/**
 * 10 MB per file. Generous for a spoken word or a sentence, small enough that a
 * deck of a few hundred cards cannot quietly fill the phone.
 */
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

export function withinSizeLimit(bytes: number | undefined): boolean {
  return typeof bytes === 'number' ? bytes <= MAX_AUDIO_BYTES : true;
}

/** "2,4 MB" — Polish decimal comma, one decimal place. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;

  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(0)} KB`;

  return `${(kilobytes / 1024).toFixed(1).replace('.', ',')} MB`;
}

/** The extension of a picked file, lowercased, without the dot. */
export function extensionOf(fileName: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return match ? match[1].toLowerCase() : 'm4a';
}

/**
 * The name a copy is stored under. Picked files may share a name (`audio.m4a`
 * twice over), so the stored name never reuses the original one: it is built
 * from the moment of import plus a random tail, keeping only the extension.
 */
export function storedFileName(
  originalName: string,
  now: Date = new Date(),
  random: () => number = Math.random
): string {
  const stamp = now.getTime().toString(36);
  const tail = Math.floor(random() * 0xffffff)
    .toString(36)
    .padStart(4, '0');

  return `${stamp}-${tail}.${extensionOf(originalName)}`;
}

/** What the card shows for an audio field when its file name is missing. */
export const AUDIO_FALLBACK_LABEL = 'Nagranie';

/** The label an audio field shows: its original file name, or a fallback. */
export function audioLabel(value: string): string {
  return value.trim() || AUDIO_FALLBACK_LABEL;
}
