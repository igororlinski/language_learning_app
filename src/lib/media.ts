import type { FieldKind } from '@/db/schema';

/**
 * Rules for the files a card field can carry — sound and pictures — kept free
 * of any file-system calls so they can be tested without a device. The copying
 * itself lives in `src/lib/media-files.ts`.
 */

/** A field kind that holds a file rather than typed text. */
export type MediaKind = Extract<FieldKind, 'audio' | 'image'>;

export function isMediaKind(kind: FieldKind): kind is MediaKind {
  return kind === 'audio' || kind === 'image';
}

/**
 * Where the copies live, relative to the app's document directory. Audio keeps
 * its original folder name: the files were put there before pictures existed
 * and moving them would gain nothing.
 */
export const MEDIA_DIRECTORIES: Record<MediaKind, string> = {
  audio: 'card-audio',
  image: 'card-images',
};

/**
 * Per-kind size limits. Ten megabytes is generous for a spoken word or a
 * sentence; a picture on a flashcard needs far less, and holding it down keeps
 * a deck of a few hundred cards from quietly filling the phone.
 */
export const MEDIA_LIMITS: Record<MediaKind, number> = {
  audio: 10 * 1024 * 1024,
  image: 5 * 1024 * 1024,
};

/** What the system picker is asked for. */
export const MEDIA_MIME_TYPES: Record<MediaKind, string> = {
  audio: 'audio/*',
  image: 'image/*',
};

export function withinSizeLimit(kind: MediaKind, bytes: number | undefined): boolean {
  return typeof bytes === 'number' ? bytes <= MEDIA_LIMITS[kind] : true;
}

/** "2,4 MB" — Polish decimal comma, one decimal place. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;

  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(0)} KB`;

  return `${(kilobytes / 1024).toFixed(1).replace('.', ',')} MB`;
}

/** The extension of a picked file, lowercased, without the dot. */
export function extensionOf(fileName: string, fallback: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return match ? match[1].toLowerCase() : fallback;
}

const FALLBACK_EXTENSIONS: Record<MediaKind, string> = {
  audio: 'm4a',
  image: 'jpg',
};

/**
 * The name a copy is stored under. Picked files may share a name (`audio.m4a`
 * twice over), so the stored name never reuses the original one: it is built
 * from the moment of import plus a random tail, keeping only the extension.
 */
export function storedFileName(
  kind: MediaKind,
  originalName: string,
  now: Date = new Date(),
  random: () => number = Math.random
): string {
  const stamp = now.getTime().toString(36);
  const tail = Math.floor(random() * 0xffffff)
    .toString(36)
    .padStart(4, '0');

  return `${stamp}-${tail}.${extensionOf(originalName, FALLBACK_EXTENSIONS[kind])}`;
}

/** What a field shows when the file it points at has no name. */
export const MEDIA_FALLBACK_LABELS: Record<MediaKind, string> = {
  audio: 'Nagranie',
  image: 'Obraz',
};

/** The label a media field shows: its original file name, or a fallback. */
export function mediaLabel(kind: MediaKind, value: string): string {
  return value.trim() || MEDIA_FALLBACK_LABELS[kind];
}
