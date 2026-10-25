import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { appSettingsQuery, dailyGoalFrom, studyDaysQuery } from '@/db/queries';
import { streak } from '@/lib/goals';

/**
 * Today's goal and the streak, live: an answer, an undo or a new goal shows
 * up at once on every screen that carries them — the deck list header, the
 * session summary and "Statystyki".
 */
export function useStreak(now: number) {
  const { data: days } = useLiveQuery(studyDaysQuery());
  const { data: settings } = useLiveQuery(appSettingsQuery());
  const goal = dailyGoalFrom(settings);

  return { days, goal, streak: streak(days, goal, now) };
}
