/**
 * When a card scheduled in days comes back. Pure functions, so no database —
 * but the same rule the session commits through, see `applyGrade`.
 */
import { createEmptyCard, Rating } from 'ts-fsrs';

import { DEFAULT_RETENTION, RETENTIONS } from '@/db/schema';
import { formatSchedule } from '@/lib/format';
import { applyGrade, RETENTION_HINTS, RETENTION_LABELS } from '@/lib/scheduler';
import { dueOnStudyDay, studyDayStart } from '@/lib/study-day';

import { check, group } from './harness';

const base = new Date(2026, 7, 31, 12, 0, 0, 0);

const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 7, day, hour, minute, 0, 0);

group('Termin liczony w dniach');

// Answering in the evening with a one-day interval brings the card back at the
// next rollover, not twenty four hours later.
check(
  'jeden dzien to poczatek nastepnego dnia nauki, nie doba',
  dueOnStudyDay(at(31, 20), 1, at(30, 20)),
  at(31, 4)
);

// A review at 2 AM still belongs to the previous study day, so "one day" lands
// at the rollover a couple of hours away.
check(
  'noc nalezy do poprzedniego dnia, wiec termin jest juz o 4:00',
  dueOnStudyDay(at(32, 2), 1, at(31, 2)),
  at(31, 4)
);

check('dziesiec dni odlicza sie od granicy dnia', dueOnStudyDay(at(41, 15), 10, at(31, 15)), at(41, 4));

// Learning steps keep their exact minute: `10 min` has to mean ten minutes or
// the card disappears from the session teaching it.
check('krok nauki zostaje co do minuty', dueOnStudyDay(at(31, 20, 10), 0, at(31, 20)), at(31, 20, 10));
check(
  'ulamek dnia tez zostaje nietkniety',
  dueOnStudyDay(at(31, 23), 0.5, at(31, 20)),
  at(31, 23)
);

// The boundary itself is what everything is measured from.
check('granica dnia o 4:00', studyDayStart(at(31, 12)), at(31, 4));
check('a przed 4:00 to jeszcze poprzedni dzien', studyDayStart(at(31, 2)), at(30, 4));

group('Etykieta na przycisku oceny');

const HOUR = 60 * 60 * 1000;

// The clock says eight hours; the promise is "tomorrow", and that is what the
// button has to say.
check('dni pokazuja sie jako dni, nie jako godziny do 4:00', formatSchedule(1, 8 * HOUR), '1 dni');
check('dluzsze interwaly tez licza sie w dniach', formatSchedule(6, 3 * HOUR), '6 dni');
check('krok nauki pokazuje zegar', formatSchedule(0, 10 * 60 * 1000), '10 min');

group('Retencja steruje dlugoscia odstepow');

// The complaint that started this: "Łatwe" on a new card disappearing for two
// weeks. The numbers are measured, not assumed — a change to ts-fsrs or to the
// defaults shows up here rather than on the phone.
const firstEasy = (retention: number) => {
  const fresh = createEmptyCard(base);
  const { card } = applyGrade(fresh, Rating.Easy, base, retention);
  return card.scheduled_days;
};

check('domyslna retencja daje kilkudniowy pierwszy odstep', firstEasy(DEFAULT_RETENTION) <= 6, true);
check('i nie zerowy', firstEasy(DEFAULT_RETENTION) >= 1, true);

// Higher retention has to mean shorter intervals, whatever the exact numbers.
check(
  'wyzsza retencja skraca odstepy',
  firstEasy(0.97) <= firstEasy(DEFAULT_RETENTION),
  true
);
check('a nizsza je wydluza', firstEasy(0.9) >= firstEasy(DEFAULT_RETENTION), true);

// Every offered level needs both words, or the picker shows a blank row.
check(
  'kazdy poziom ma nazwe i opis',
  RETENTIONS.filter((value) => !RETENTION_LABELS[value] || !RETENTION_HINTS[value]),
  []
);
