import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { HelpButton } from '@/components/help-button';
import { ThemedText } from '@/components/themed-text';
import type { HelpTopicId } from '@/constants/help';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The pieces every statistic on "Statystyki" is built from, so each card reads
 * the same way: a titled card with its "?", one big number with its unit right
 * beside it, the smaller facts as labelled tiles rather than a sentence, and
 * the cards grouped under short headings.
 */

/** A card with a title, the "?" that says what it measures, and maybe a control on the right. */
export function StatCard({
  title,
  help,
  accessory,
  highlight = false,
  children,
}: {
  title: string;
  help: HelpTopicId;
  /** On the right of the title — a switch, a badge. */
  accessory?: ReactNode;
  /** The warm background of the association field, for the one number Anki cannot show. */
  highlight?: boolean;
  children: ReactNode;
}) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: highlight ? theme.backgroundHighlight : theme.backgroundElement,
          borderColor: theme.border,
        },
      ]}>
      <View style={styles.header}>
        <View style={styles.title}>
          <ThemedText style={styles.titleText}>{title}</ThemedText>
          <HelpButton topic={help} />
        </View>
        {accessory}
      </View>
      {children}
    </View>
  );
}

/** A big number and its unit on one line: `22 min w 7 dni`, `93% na celu`. */
export function Figure({ value, unit, color }: { value: string | number; unit?: ReactNode; color?: string }) {
  return (
    <View style={styles.figure}>
      <ThemedText style={[styles.figureValue, color ? { color } : null]}>{value}</ThemedText>
      {typeof unit === 'string' ? (
        <ThemedText themeColor="textSecondary" style={styles.figureUnit}>
          {unit}
        </ThemedText>
      ) : (
        unit
      )}
    </View>
  );
}

export type MiniStat = {
  label: string;
  value: string | number;
  /** Small and grey after the value — which day, for a count of a day: `5 pt`. */
  detail?: string;
  color?: string;
};

/**
 * The smaller facts of a card, each a tile: a grey label over its value, a dot
 * if it has a colour. `columns` tiles to a row — four in one row leave a
 * label no room.
 */
export function MiniStats({ items, columns = items.length }: { items: readonly MiniStat[]; columns?: number }) {
  const theme = useTheme();

  return (
    <View style={styles.minis}>
      {items.map((item) => (
        <View
          key={item.label}
          style={[styles.mini, { flexBasis: `${100 / columns - 4}%`, backgroundColor: theme.backgroundTile }]}>
          <View style={styles.miniLabel}>
            {item.color ? <View style={[styles.dot, { backgroundColor: item.color }]} /> : null}
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.shrink}>
              {item.label}
            </ThemedText>
          </View>
          <ThemedText style={styles.miniValue} numberOfLines={1}>
            {item.value}
            {item.detail ? (
              <ThemedText type="small" themeColor="textSecondary">
                {'  '}
                {item.detail}
              </ThemedText>
            ) : null}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

/**
 * A word in a tinted pill — how a number stands: `na celu`, `lepiej ze
 * skojarzeniem`. The colour is in the dot and the tint; the word stays in the
 * text colour, since amber or pale green text on its own tint is hard to read.
 */
export function Verdict({ text, color }: { text: string; color: string }) {
  return (
    <View style={[styles.verdict, { backgroundColor: `${color}26` }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <ThemedText type="smallBold">{text}</ThemedText>
    </View>
  );
}

/** A heading over a few cards that belong together. */
export function GroupTitle({ children }: { children: string }) {
  return (
    <ThemedText themeColor="textSecondary" style={styles.group}>
      {children.toUpperCase()}
    </ThemedText>
  );
}

/** A colour dot and a name, for a chart's legend. */
export function LegendItem({ color, label, count }: { color: string; label: string; count?: number }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <ThemedText type="small">
        {label}
        {count != null ? <ThemedText type="smallBold"> {count}</ThemedText> : null}
      </ThemedText>
    </View>
  );
}

export const statStyles = StyleSheet.create({
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: Spacing.three,
    rowGap: Spacing.one,
  },
  note: {
    marginTop: Spacing.one,
  },
});

const styles = StyleSheet.create({
  card: {
    padding: Spacing.three,
    gap: Spacing.three,
    borderRadius: Radius.large,
    borderWidth: StyleSheet.hairlineWidth,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    minHeight: 28,
  },
  title: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexShrink: 1,
  },
  titleText: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    flexShrink: 1,
  },
  figure: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    columnGap: Spacing.two,
    marginTop: -Spacing.one,
  },
  figureValue: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  figureUnit: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
  },
  minis: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  mini: {
    flexGrow: 1,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    borderRadius: Radius.medium,
    gap: Spacing.half,
  },
  miniLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  miniValue: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  shrink: {
    flexShrink: 1,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  verdict: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Radius.small,
  },
  group: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginTop: Spacing.two,
    marginBottom: -Spacing.one,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
});
