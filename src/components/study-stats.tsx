import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BarChart } from '@/components/bar-chart';
import { Meter } from '@/components/meter';
import { SegmentedControl } from '@/components/segmented-control';
import { StackedBar } from '@/components/stacked-bar';
import {
  Figure,
  GroupTitle,
  LegendItem,
  MiniStats,
  StatCard,
  statStyles,
  Verdict,
} from '@/components/stat-card';
import { ThemedText } from '@/components/themed-text';
import { CardStateColors, QueueColors, RatingColors, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, pluralize, shortMonth } from '@/lib/format';
import { GRADE_LABELS, Rating } from '@/lib/scheduler';
import {
  cardStates,
  collectionGrowth,
  forecast,
  FORECAST_DAYS,
  FORECAST_LONG_DAYS,
  forecastLabel,
  formatDuration,
  formatSigned,
  formatPercent,
  GROWTH_WEEKS,
  MIN_ANSWERS,
  mnemonicComparison,
  mnemonicGap,
  ratingMix,
  recentRetention,
  RETENTION_WINDOW_DAYS,
  retentionTone,
  STUDY_TIME_DAYS,
  studyTime,
  studyTimeByDay,
  todayStats,
  WEEKDAYS,
  type RatingSplit,
  type RetentionStats,
  type StatsCard,
  type StatsLog,
} from '@/lib/stats';

/**
 * The part of "Statystyki" about one deck or all of them, in four groups:
 * today and this week, what is coming, how it is going, and the collection.
 *
 * Every card follows the same order — title and "?", the big number with its
 * unit, the smaller facts as labelled tiles, then the chart — so a card is
 * read the same way as the one above it. What a number means lives behind
 * its "?", not around it.
 */
export type StudyStatsProps = {
  logs: readonly StatsLog[];
  cards: readonly StatsCard[];
  /** Cards that show an association during review. */
  withMnemonic: ReadonlySet<number>;
  now: number;
};

const FORECAST_HEIGHT = 96;
const STUDY_CHART_HEIGHT = 48;
const GROWTH_HEIGHT = 80;

type Horizon = '7' | '30';

const HORIZONS: { value: Horizon; label: string }[] = [
  { value: String(FORECAST_DAYS) as Horizon, label: `${FORECAST_DAYS} dni` },
  { value: String(FORECAST_LONG_DAYS) as Horizon, label: `${FORECAST_LONG_DAYS} dni` },
];

/** The grades in the order of the buttons, in the buttons' colours. */
const GRADE_PARTS = [
  { key: 'again', label: GRADE_LABELS[Rating.Again], color: RatingColors.again },
  { key: 'hard', label: GRADE_LABELS[Rating.Hard], color: RatingColors.hard },
  { key: 'good', label: GRADE_LABELS[Rating.Good], color: RatingColors.good },
  { key: 'easy', label: GRADE_LABELS[Rating.Easy], color: RatingColors.easy },
] as const;

/** How retention stands against its target, as a word in its colour. */
const TONE = {
  good: { text: 'na celu', color: RatingColors.good },
  close: { text: 'trochę poniżej celu', color: RatingColors.hard },
  low: { text: 'poniżej celu', color: RatingColors.again },
} as const;

const answersLabel = (count: number) =>
  `${count} ${pluralize(count, 'odpowiedź', 'odpowiedzi', 'odpowiedzi')}`;

const cardsWord = (count: number) => pluralize(count, 'karta', 'karty', 'kart');

export function StudyStats({ logs, cards, withMnemonic, now }: StudyStatsProps) {
  const [horizon, setHorizon] = useState<Horizon>(String(FORECAST_DAYS) as Horizon);

  const today = todayStats(logs, now);
  const time = studyTime(logs, now);
  const timeByDay = studyTimeByDay(logs, now);

  const days = forecast(cards, now, Number(horizon));
  const dueTotal = days.reduce((sum, day) => sum + day.count, 0);
  const busiestIndex = days.reduce((top, day, index) => (day.count > days[top].count ? index : top), 0);
  const dayName = (index: number) =>
    days.length === FORECAST_DAYS
      ? forecastLabel(index, days[index].start)
      : index === 0
        ? 'Dziś'
        : formatDate(new Date(days[index].start), new Date(now));

  const recent = recentRetention(logs, now);
  const ratings = ratingMix(logs, now);
  const mnemonics = mnemonicComparison(logs, withMnemonic);
  const gap = mnemonicGap(mnemonics);

  const states = cardStates(cards);
  const growth = collectionGrowth(logs, cards, now);
  const first = growth[0];
  const last = growth[growth.length - 1];
  const matured = last.mature - first.mature;
  const hasHistory = growth.some((week) => week.learning + week.young + week.mature > 0);

  return (
    <>
      <GroupTitle>Dziś i ten tydzień</GroupTitle>

      <StatCard title="Dzisiaj" help="stats.today">
        <Figure value={today.answers} unit={pluralize(today.answers, 'odpowiedź', 'odpowiedzi', 'odpowiedzi')} />
        <MiniStats
          columns={2}
          items={[
            { label: 'Nowe', value: today.new, color: QueueColors.new },
            { label: 'Nauka', value: today.learning, color: QueueColors.learning },
            { label: 'Powtórki', value: today.review, color: QueueColors.review },
            { label: 'Poprawnie', value: today.correct == null ? '—' : formatPercent(today.correct) },
          ]}
        />
      </StatCard>

      <StatCard title="Czas nauki" help="stats.time">
        {time.week == null ? (
          <ThemedText type="small" themeColor="textSecondary">
            Jeszcze nie zmierzony
          </ThemedText>
        ) : (
          <>
            <Figure value={formatDuration(time.week)} unit={`w ${STUDY_TIME_DAYS} dni`} />
            <MiniStats
              items={[
                { label: 'Dziś', value: time.today == null ? '—' : formatDuration(time.today) },
                {
                  label: 'Na odpowiedź',
                  value: time.perAnswer == null ? '—' : formatDuration(time.perAnswer),
                },
              ]}
            />
            <BarChart
              height={STUDY_CHART_HEIGHT}
              bars={timeByDay.map((day, index) => ({
                key: day.start,
                value: day.ms,
                label: index === timeByDay.length - 1 ? 'Dziś' : WEEKDAYS[new Date(day.start).getDay()],
                highlight: index === timeByDay.length - 1,
              }))}
            />
          </>
        )}
      </StatCard>

      <GroupTitle>Co przed tobą</GroupTitle>

      <StatCard
        title="Do powtórki"
        help="stats.forecast"
        accessory={
          <View style={styles.switch}>
            <SegmentedControl
              size="small"
              value={horizon}
              options={HORIZONS}
              onChange={setHorizon}
              accessibilityLabel="Zakres prognozy"
            />
          </View>
        }>
        <Figure value={dueTotal} unit={`${cardsWord(dueTotal)} w ${days.length} dni`} />
        <MiniStats
          items={[
            { label: 'Dziś', value: days[0].count },
            { label: 'Średnio', value: Math.round(dueTotal / days.length) },
            {
              label: 'Najwięcej',
              value: days[busiestIndex].count,
              detail: days[busiestIndex].count > 0 ? dayName(busiestIndex) : undefined,
            },
          ]}
        />
        <BarChart
          height={FORECAST_HEIGHT}
          showValues
          bars={days.map((day, index) => ({
            key: day.start,
            value: day.count,
            label:
              days.length === FORECAST_DAYS || index === 0 || (index % 7 === 0 && index <= days.length - 5)
                ? dayName(index)
                : '',
            highlight: index === 0,
          }))}
        />
      </StatCard>

      <GroupTitle>Jak ci idzie</GroupTitle>

      <StatCard title={`Zapamiętane · ${RETENTION_WINDOW_DAYS} dni`} help="stats.retention">
        <RetentionFigure stats={recent} />
      </StatCard>

      <StatCard title={`Oceny · ${RETENTION_WINDOW_DAYS} dni`} help="stats.grades">
        <GradeTable
          rows={[
            { title: 'Powtórki', split: ratings.review },
            { title: 'Nauka', split: ratings.learning },
          ]}
        />
      </StatCard>

      <StatCard title="Skojarzenia a pamięć" help="stats.mnemonics" highlight>
        <MnemonicFigure gap={gap} />
        <ComparedRow title="Ze skojarzeniem" stats={mnemonics.with} />
        <ComparedRow title="Bez skojarzenia" stats={mnemonics.without} muted />
      </StatCard>

      <GroupTitle>Kolekcja</GroupTitle>

      <StatCard title="Karty" help="stats.collection">
        <Figure
          value={states.mature}
          unit={
            <View style={styles.unitRow}>
              <ThemedText themeColor="textSecondary" style={styles.unit}>
                {pluralize(states.mature, 'dojrzała', 'dojrzałe', 'dojrzałych')} z {cards.length}
              </ThemedText>
              {hasHistory && matured !== 0 ? (
                <Verdict
                  text={`${formatSigned(matured)} w ${GROWTH_WEEKS} tyg.`}
                  color={matured > 0 ? RatingColors.good : RatingColors.again}
                />
              ) : null}
            </View>
          }
        />

        <View style={styles.block}>
          <ThemedText type="small" themeColor="textSecondary">
            Teraz
          </ThemedText>
          <StackedBar
            parts={[
              { key: 'mature', amount: states.mature, color: CardStateColors.mature },
              { key: 'young', amount: states.young, color: CardStateColors.young },
              { key: 'learning', amount: states.learning, color: CardStateColors.learning },
              { key: 'new', amount: states.new, color: CardStateColors.new },
            ]}
          />
        </View>

        {hasHistory ? (
          <View style={styles.block}>
            <ThemedText type="small" themeColor="textSecondary">
              Ostatnie {GROWTH_WEEKS} tygodni
            </ThemedText>
            <BarChart
              height={GROWTH_HEIGHT}
              thin
              bars={growth.map((week, index) => ({
                key: week.at,
                value: week.learning + week.young + week.mature,
                stack: [
                  { amount: week.mature, color: CardStateColors.mature },
                  { amount: week.young, color: CardStateColors.young },
                  { amount: week.learning, color: CardStateColors.learning },
                ],
                // A month's name under its first week.
                label:
                  index === 0 || new Date(week.at).getMonth() !== new Date(growth[index - 1].at).getMonth()
                    ? shortMonth(new Date(week.at))
                    : '',
                highlight: index === growth.length - 1,
              }))}
            />
          </View>
        ) : null}

        <View style={statStyles.legend}>
          <LegendItem color={CardStateColors.mature} label="Dojrzałe" count={states.mature} />
          <LegendItem color={CardStateColors.young} label="Młode" count={states.young} />
          <LegendItem color={CardStateColors.learning} label="W nauce" count={states.learning} />
          <LegendItem color={CardStateColors.new} label="Nowe" count={states.new} />
        </View>
      </StatCard>
    </>
  );
}

/**
 * Retention as a percent with how it stands against the target, a bar with
 * the target marked and named on it, and what it rests on. With too few
 * answers, how many there are and how many it takes — a percentage from five
 * answers would be read as if it meant something.
 */
function RetentionFigure({ stats }: { stats: RetentionStats }) {
  const theme = useTheme();

  if (stats.rate == null) {
    return (
      <>
        <Figure value="—" />
        <ThemedText type="small" themeColor="textSecondary">
          {stats.answers === 0
            ? 'Jeszcze brak powtórek'
            : `Procent od ${MIN_ANSWERS} powtórek, jest ${stats.answers}`}
        </ThemedText>
      </>
    );
  }

  const tone = TONE[retentionTone(stats.rate, stats.target)];

  return (
    <>
      <Figure value={formatPercent(stats.rate)} unit={<Verdict text={tone.text} color={tone.color} />} />
      <Meter
        share={stats.rate}
        color={tone.color}
        trackColor={theme.backgroundSelected}
        marker={stats.target}
        markerColor={theme.text}
        markerLabel={stats.target != null ? `cel ${formatPercent(stats.target)}` : undefined}
      />
      <ThemedText type="small" themeColor="textSecondary" style={statStyles.note}>
        z {answersLabel(stats.answers)} w powtórkach
      </ThemedText>
    </>
  );
}

/**
 * The grades as a small table: the four names once, in their colours, as the
 * header, then each kind of answer as a row of shares with its bar under it.
 */
function GradeTable({ rows }: { rows: readonly { title: string; split: RatingSplit }[] }) {
  return (
    <View style={styles.table}>
      <View style={styles.tableRow}>
        <View style={styles.rowHead} />
        {GRADE_PARTS.map((part) => (
          <View key={part.key} style={styles.cell}>
            <View style={[styles.gradeDot, { backgroundColor: part.color }]} />
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {part.label}
            </ThemedText>
          </View>
        ))}
      </View>

      {rows.map(({ title, split }) => (
        <View key={title} style={styles.gradeBlock}>
          <View style={styles.tableRow}>
            <View style={styles.rowHead}>
              <ThemedText type="smallBold">{title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.count}>
                {split.total} odp.
              </ThemedText>
            </View>
            {GRADE_PARTS.map((part) => (
              <View key={part.key} style={styles.cell}>
                <ThemedText style={styles.share}>
                  {split.total === 0 ? '—' : formatPercent(split[part.key] / split.total)}
                </ThemedText>
              </View>
            ))}
          </View>
          <StackedBar
            height={10}
            parts={GRADE_PARTS.map((part) => ({ key: part.key, amount: split[part.key], color: part.color }))}
          />
        </View>
      ))}
    </View>
  );
}

/** The comparison's answer first: how many points better (or worse) with an association. */
function MnemonicFigure({ gap }: { gap: number | null }) {
  const theme = useTheme();

  if (gap == null) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        Porównanie od {MIN_ANSWERS} powtórek po każdej stronie
      </ThemedText>
    );
  }

  const verdict =
    gap > 0
      ? { text: 'lepiej ze skojarzeniem', color: RatingColors.good }
      : gap < 0
        ? { text: 'gorzej ze skojarzeniem', color: RatingColors.again }
        : { text: 'bez różnicy', color: theme.textSecondary };

  return (
    <Figure
      value={formatSigned(gap)}
      unit={
        <View style={styles.unitRow}>
          <ThemedText themeColor="textSecondary" style={styles.unit}>
            pkt proc.
          </ThemedText>
          <Verdict text={verdict.text} color={verdict.color} />
        </View>
      }
    />
  );
}

/** One side of the comparison: its name and percent on a line, the bar, the count under. */
function ComparedRow({ title, stats, muted = false }: { title: string; stats: RetentionStats; muted?: boolean }) {
  const theme = useTheme();

  return (
    <View style={styles.compared}>
      <View style={styles.comparedHead}>
        <ThemedText type="smallBold">{title}</ThemedText>
        <ThemedText style={styles.share}>{stats.rate == null ? '—' : formatPercent(stats.rate)}</ThemedText>
      </View>
      <Meter
        share={stats.rate ?? 0}
        color={muted ? theme.textSecondary : RatingColors.good}
        trackColor={theme.backgroundSelected}
      />
      <ThemedText type="small" themeColor="textSecondary">
        {stats.rate == null && stats.answers > 0
          ? `${answersLabel(stats.answers)} — za mało na procent`
          : answersLabel(stats.answers)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  switch: {
    width: 148,
  },
  unitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
  unit: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
  },
  block: {
    gap: Spacing.two,
  },
  table: {
    gap: Spacing.three,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowHead: {
    width: 84,
  },
  count: {
    fontVariant: ['tabular-nums'],
  },
  cell: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.half,
  },
  gradeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  gradeBlock: {
    gap: Spacing.two,
  },
  share: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  compared: {
    gap: Spacing.one,
  },
  comparedHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
});
