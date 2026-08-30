import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Anki's stock deck options, used for every new deck. */
export const DEFAULT_NEW_PER_DAY = 20;
export const DEFAULT_REVIEWS_PER_DAY = 200;

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
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const IMAGE_STATUSES = ['none', 'generating', 'ready', 'failed'] as const;
export type ImageStatus = (typeof IMAGE_STATUSES)[number];

export const cards = sqliteTable(
  'cards',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    deckId: integer('deck_id')
      .notNull()
      .references(() => decks.id, { onDelete: 'cascade' }),
    front: text('front').notNull(),
    back: text('back').notNull(),
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
export type Card = typeof cards.$inferSelect;
export type FsrsStateRow = typeof fsrsState.$inferSelect;
export type ReviewLog = typeof reviewLogs.$inferSelect;
