import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Anki's stock deck options, used for every new deck. */
export const DEFAULT_NEW_PER_DAY = 20;
export const DEFAULT_REVIEWS_PER_DAY = 200;

/**
 * Where new cards sit relative to reviews in a session, mirroring Anki's
 * "new/review order".
 */
export const NEW_CARD_PLACEMENTS = ['mixed', 'before', 'after'] as const;
export type NewCardPlacement = (typeof NEW_CARD_PLACEMENTS)[number];
export const DEFAULT_NEW_CARD_PLACEMENT: NewCardPlacement = 'mixed';

/** Which end of the new backlog today's new cards are taken from. */
export const NEW_CARD_ORDERS = ['oldest', 'newest', 'random'] as const;
export type NewCardOrder = (typeof NEW_CARD_ORDERS)[number];
export const DEFAULT_NEW_CARD_ORDER: NewCardOrder = 'oldest';

/** Which face of a card a field belongs to. */
export const FIELD_SIDES = ['front', 'back'] as const;

/** A field holds typed text, or one attached file: sound, a picture or video. */
export const FIELD_KINDS = ['text', 'audio', 'image', 'video'] as const;
export type FieldSide = (typeof FIELD_SIDES)[number];
export type FieldKind = (typeof FIELD_KINDS)[number];

export const decks = sqliteTable('decks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  description: text('description'),
  /**
   * Daily caps, counted per study day. 0 switches a bucket off entirely.
   * Cards in Learning/Relearning are never capped — same as Anki, where
   * learning steps always come back regardless of the day's allowance.
   */
  newPerDay: integer('new_per_day').notNull().default(DEFAULT_NEW_PER_DAY),
  reviewsPerDay: integer('reviews_per_day').notNull().default(DEFAULT_REVIEWS_PER_DAY),
  /** How the session queue is built — see the two constant blocks above. */
  newCardPlacement: text('new_card_placement', { enum: NEW_CARD_PLACEMENTS })
    .notNull()
    .default(DEFAULT_NEW_CARD_PLACEMENT),
  newCardOrder: text('new_card_order', { enum: NEW_CARD_ORDERS })
    .notNull()
    .default(DEFAULT_NEW_CARD_ORDER),
  /**
   * Where a new card in this deck puts its two mandatory fields. The empty
   * extra fields it starts with live in `deck_field_slots`, because they are no
   * longer interchangeable: each one is a text box or a slot for one kind of file.
   * Only a brand new card reads any of this.
   */
  newFrontSide: text('new_front_side', { enum: FIELD_SIDES }).notNull().default('front'),
  newFrontPosition: integer('new_front_position').notNull().default(0),
  newBackSide: text('new_back_side', { enum: FIELD_SIDES }).notNull().default('back'),
  newBackPosition: integer('new_back_position').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const IMAGE_STATUSES = ['none', 'generating', 'ready', 'failed'] as const;
export type ImageStatus = (typeof IMAGE_STATUSES)[number];

/** One empty field a new card in this deck starts with. */
export const deckFieldSlots = sqliteTable(
  'deck_field_slots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    deckId: integer('deck_id')
      .notNull()
      .references(() => decks.id, { onDelete: 'cascade' }),
    side: text('side', { enum: FIELD_SIDES }).notNull(),
    position: integer('position').notNull().default(0),
    kind: text('kind', { enum: FIELD_KINDS }).notNull().default('text'),
  },
  (table) => [index('deck_field_slots_deck_id_idx').on(table.deckId)]
);

export const cards = sqliteTable(
  'cards',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    deckId: integer('deck_id')
      .notNull()
      .references(() => decks.id, { onDelete: 'cascade' }),
    front: text('front').notNull(),
    back: text('back').notNull(),
    /**
     * Where the two mandatory fields sit in the card's layout. They can be moved
     * anywhere, the other side included, so each carries its own side as well as
     * its position within it — which also lets one face end up empty.
     */
    frontSide: text('front_side', { enum: FIELD_SIDES }).notNull().default('front'),
    frontPosition: integer('front_position').notNull().default(0),
    backSide: text('back_side', { enum: FIELD_SIDES }).notNull().default('back'),
    backPosition: integer('back_position').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    // Reserved for the future AI image generation feature.
    imagePath: text('image_path'),
    imagePrompt: text('image_prompt'),
    imageStatus: text('image_status', { enum: IMAGE_STATUSES }).notNull().default('none'),
  },
  (table) => [index('cards_deck_id_idx').on(table.deckId)]
);

/**
 * A card's own extra fields, on top of the built-in front/back. They belong to
 * the card, not to the deck, so two cards in one deck can carry entirely
 * different content and moving a card between decks changes nothing about them.
 *
 * A field has no name: its identity is the row id and nothing is printed above
 * it during review — it is simply one more line on its side of the card.
 */
export const cardFields = sqliteTable(
  'card_fields',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    cardId: integer('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    side: text('side', { enum: FIELD_SIDES }).notNull(),
    /** Order within the side, as arranged in the card editor. */
    position: integer('position').notNull().default(0),
    kind: text('kind', { enum: FIELD_KINDS }).notNull().default('text'),
    /** Typed text, or the original name of the file attached here. */
    value: text('value').notNull().default(''),
    /**
     * File name inside the app's media directory; null for a text field. The
     * SQL column is still called audio_path: it was added when sound was the
     * only attachment — pictures and video came later — and renaming it would
     * cost a migration that copies every row for no gain.
     */
    mediaPath: text('audio_path'),
  },
  (table) => [index('card_fields_card_id_idx').on(table.cardId)]
);

/**
 * Tags are shared by every deck, the way they are in Anki: a card moved to
 * another deck keeps them, and a tag typed once can be picked from then on.
 *
 * `slug` is the name with case and diacritics folded away (`src/lib/tags.ts`),
 * and it is what uniqueness is checked against — SQLite's own `nocase` folds
 * ASCII only, so `Łatwe` and `łatwe` would otherwise be two different tags.
 * `name` keeps whatever the user actually typed, which is what is shown.
 */
export const tags = sqliteTable('tags', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
});

/** Which cards carry which tags. */
export const cardTags = sqliteTable(
  'card_tags',
  {
    cardId: integer('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.cardId, table.tagId] }),
    index('card_tags_tag_id_idx').on(table.tagId),
  ]
);

/** 1:1 with `cards`. Fields mirror the ts-fsrs `Card` shape. */
export const fsrsState = sqliteTable(
  'fsrs_state',
  {
    cardId: integer('card_id')
      .primaryKey()
      .references(() => cards.id, { onDelete: 'cascade' }),
    due: integer('due', { mode: 'timestamp_ms' }).notNull(),
    stability: real('stability').notNull(),
    difficulty: real('difficulty').notNull(),
    elapsedDays: real('elapsed_days').notNull(),
    scheduledDays: real('scheduled_days').notNull(),
    learningSteps: integer('learning_steps').notNull().default(0),
    reps: integer('reps').notNull(),
    lapses: integer('lapses').notNull(),
    /** ts-fsrs State enum: 0 New, 1 Learning, 2 Review, 3 Relearning. */
    state: integer('state').notNull(),
    lastReview: integer('last_review', { mode: 'timestamp_ms' }),
  },
  (table) => [index('fsrs_state_due_idx').on(table.due)]
);

/** Full ts-fsrs ReviewLog, kept for stats and for `scheduler.rollback()`. */
export const reviewLogs = sqliteTable(
  'review_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    cardId: integer('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    /** ts-fsrs Rating enum: 1 Again, 2 Hard, 3 Good, 4 Easy. */
    rating: integer('rating').notNull(),
    /** Card state *before* this review. */
    state: integer('state').notNull(),
    due: integer('due', { mode: 'timestamp_ms' }).notNull(),
    stability: real('stability').notNull(),
    difficulty: real('difficulty').notNull(),
    elapsedDays: real('elapsed_days').notNull(),
    lastElapsedDays: real('last_elapsed_days').notNull(),
    scheduledDays: real('scheduled_days').notNull(),
    learningSteps: integer('learning_steps').notNull().default(0),
    reviewedAt: integer('reviewed_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('review_logs_card_id_idx').on(table.cardId)]
);

export type Deck = typeof decks.$inferSelect;
export type CardField = typeof cardFields.$inferSelect;
export type DeckFieldSlot = typeof deckFieldSlots.$inferSelect;
export type Card = typeof cards.$inferSelect;
export type FsrsStateRow = typeof fsrsState.$inferSelect;
export type ReviewLog = typeof reviewLogs.$inferSelect;
export type Tag = typeof tags.$inferSelect;
