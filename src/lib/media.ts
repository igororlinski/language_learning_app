import type { FieldKind } from '@/db/schema';

/**
 * Rules for the files a card field can carry — sound, pictures and video —
 * kept free of any file-system calls so they can be tested without a device.
 * The copying itself lives in `src/lib/media-files.ts`.
 */

/** A field kind that holds a file rather than typed text. */
export type MediaKind = Extract<FieldKind, 'audio' | 'image' | 'video' | 'ai-image'>;

const MEDIA_KINDS: readonly FieldKind[] = ['audio', 'image', 'video', 'ai-image'];

/**
 * The kinds whose file is generated rather than picked. They are media in every
 * other respect — copied, deleted and rendered by the same code — so the only
 * thing this decides is which fields offer a file picker and which offer a
 * "generate" button.
 */
const GENERATED_KINDS: readonly FieldKind[] = ['ai-image'];

export function isGeneratedKind(kind: FieldKind): kind is MediaKind {
  return GENERATED_KINDS.includes(kind);
}

export function isMediaKind(kind: FieldKind): kind is MediaKind {
  return MEDIA_KINDS.includes(kind);
}

/**
 * Where the copies live, relative to the app's document directory. Audio keeps
 * its original folder name: the files were put there before pictures existed
 * and moving them would gain nothing.
 */
export const MEDIA_DIRECTORIES: Record<MediaKind, string> = {
  audio: 'card-audio',
  image: 'card-images',
  video: 'card-videos',
  'ai-image': 'card-ai-images',
};

/**
 * Per-kind size limits, set by what the kind actually costs. Five megabytes is
 * already generous for a spoken word or a sentence; a photo straight off a
 * phone camera routinely passes that, so pictures get ten. Video gets the most
 * because it cannot be had for less — twenty five megabytes is a short clip,
 * which is all a flashcard should carry — and it is the one kind where a
 * careless pick from the gallery is a whole gigabyte. Together they keep a deck
 * of a few hundred cards from quietly filling the phone.
 */
export const MEDIA_LIMITS: Record<MediaKind, number> = {
  audio: 5 * 1024 * 1024,
  image: 10 * 1024 * 1024,
  video: 25 * 1024 * 1024,
  // Nothing picks this one, so the limit is a sanity check on what came back
  // over the network rather than a guard against a careless choice.
  'ai-image': 10 * 1024 * 1024,
};

/** What the system picker is asked for. */
export const MEDIA_MIME_TYPES: Record<MediaKind, string> = {
  audio: 'audio/*',
  image: 'image/*',
  video: 'video/*',
  // Unused today — a generated field has no picker. It is here because the
  // record covers every kind, and because letting a generated picture be
  // replaced by a chosen one is the obvious next thing to want.
  'ai-image': 'image/*',
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
  video: 'mp4',
  // FLUX hands back JPEG, and nothing else writes this kind.
  'ai-image': 'jpg',
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
  video: 'Wideo',
  'ai-image': 'Obraz AI',
};

/** The word for a kind inside a sentence: "Przód — pole 1 — dźwięk". */
export const MEDIA_NOUNS: Record<MediaKind, string> = {
  audio: 'dźwięk',
  image: 'obraz',
  video: 'wideo',
  'ai-image': 'obraz AI',
};

/** The same word in the genitive, for messages built as "Nie dodano …". */
export const MEDIA_NOUNS_GENITIVE: Record<MediaKind, string> = {
  audio: 'dźwięku',
  image: 'obrazu',
  video: 'wideo',
  'ai-image': 'obrazu AI',
};

/** Shown in place of a field whose file is gone. */
export const MEDIA_MISSING_LABELS: Record<MediaKind, string> = {
  audio: 'Brak pliku dźwiękowego',
  image: 'Brak pliku obrazu',
  video: 'Brak pliku wideo',
  'ai-image': 'Brak wygenerowanego obrazu',
};

/** The label a media field shows: its original file name, or a fallback. */
export function mediaLabel(kind: MediaKind, value: string): string {
  return value.trim() || MEDIA_FALLBACK_LABELS[kind];
}
