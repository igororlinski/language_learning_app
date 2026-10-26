import { useLiveQuery } from 'drizzle-orm/expo-sqlite';

import { appSettingsQuery, goalPlanFrom, studyDaysQuery } from '@/db/queries';
import { dayKey, goalOn, streak } from '@/lib/goals';

/**
 * Today's goal and the streak, live: an answer, an undo or a new goal shows
 * up at once on every screen that carries them — the deck list header, the
 * session summary and "Statystyki".
 */
export function useStreak(now: number) {
  const { data: days } = useLiveQuery(studyDaysQuery());
  const { data: settings } = useLiveQuery(appSettingsQuery());
  const plan = goalPlanFrom(settings);
  // What today is held to: the lighter goal on a lighter day.
  const goal = goalOn(plan, dayKey(now));

  return { days, plan, goal, streak: streak(days, goal, now) };
}
