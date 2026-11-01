import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { CheckIcon, ClockIcon, FlameIcon, TargetIcon } from '@/components/icons';
import { Medal } from '@/components/medal';
import { ThemedText } from '@/components/themed-text';
import { FlameColors, Radius, RatingColors, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { BADGE_GROUPS, badgeLabel, highestTier } from '@/lib/badges';
import { pluralize } from '@/lib/format';
import type { Person } from '@/lib/friends';
import { formatDuration } from '@/lib/stats';

const daysLabel = (count: number) => `${count} ${pluralize(count, 'dzień', 'dni', 'dni')}`;

const TOTAL_BADGES = BADGE_GROUPS.reduce((sum, group) => sum + group.tiers.length, 0);

/** The pale circle behind a tile's icon: the icon's own colour, faint. */
const tint = (color: string) => `${color}24`;

/**
 * One friend in full, opened from the ranking: what they did in the period as
 * four tiles with icons, then their badges as the same medals "Statystyki"
 * shows — every ladder, the highest tier they reached in its metal, the ones
 * they have not started in grey.
 *
 * `named` puts their name at the top, for a person opened from the podium,
 * whose name is not right above.
 */
export function PersonDetails({
  person,
  named = false,
  actions,
}: {
  person: Person;
  named?: boolean;
  /** Under the medals — what can be done about this person, like removing them. */
  actions?: ReactNode;
}) {
  const theme = useTheme();
  const earned = new Set(person.badges);
  const known = person.badges.filter((id) => badgeLabel(id) != null).length;

  return (
    <View style={[styles.panel, { backgroundColor: theme.background, borderColor: theme.border }]}>
      {named ? (
        <ThemedText style={[styles.name, person.me ? { color: theme.accent } : null]}>
          {person.me ? `${person.name} (ty)` : person.name}
        </ThemedText>
      ) : null}

      <View style={styles.tiles}>
        <Tile
          color={person.streak > 0 ? FlameColors.outer : theme.textSecondary}
          icon={
            <FlameIcon
              size={20}
              color={person.streak > 0 ? FlameColors.outer : theme.textSecondary}
              core={person.streak > 0 ? FlameColors.inner : theme.background}
            />
          }
          value={daysLabel(person.streak)}
          label="seria"
        />
        <Tile
          color={person.todayMet ? RatingColors.good : theme.textSecondary}
          icon={
            person.todayMet ? (
              <CheckIcon size={18} color={RatingColors.good} />
            ) : (
              <View style={[styles.emptyDay, { borderColor: theme.textSecondary }]} />
            )
          }
          value={person.todayMet ? 'spełniony' : 'jeszcze nie'}
          label="cel dziś"
        />
        {/* Only for a week or a month: the all-time ranking has no such count. */}
        {person.goalDays != null ? (
          <Tile
            color={theme.accent}
            icon={<TargetIcon size={18} color={theme.accent} />}
            value={daysLabel(person.goalDays)}
            label="z celem"
          />
        ) : null}
        <Tile
          color={RatingColors.easy}
          icon={<ClockIcon size={18} color={RatingColors.easy} />}
          value={person.studyMs > 0 ? formatDuration(person.studyMs) : '—'}
          label="czas nauki"
        />
      </View>

      <ThemedText type="smallBold" themeColor="textSecondary">
        Odznaki · {known}/{TOTAL_BADGES}
      </ThemedText>
      <View style={styles.medals}>
        {BADGE_GROUPS.map((group) => {
          const top = highestTier(group, earned);

          return (
            <View
              key={group.kind}
              accessible
              accessibilityLabel={top >= 0 ? group.label(group.tiers[top]) : `${group.title}, bez odznaki`}
              style={styles.medal}>
              <Medal kind={group.kind} metal={top} size={36} />
              <ThemedText
                type="small"
                numberOfLines={2}
                themeColor={top >= 0 ? 'text' : 'textSecondary'}
                style={styles.medalLabel}>
                {top >= 0 ? group.label(group.tiers[top]) : group.title}
              </ThemedText>
            </View>
          );
        })}
      </View>

      {actions}
    </View>
  );
}

/** One number about a person: an icon in a tinted circle, the value, and what it is. */
function Tile({ color, icon, value, label }: { color: string; icon: ReactNode; value: string; label: string }) {
  const theme = useTheme();

  return (
    <View style={[styles.tile, { backgroundColor: theme.backgroundElement }]}>
      <View style={[styles.bubble, { backgroundColor: tint(color) }]}>{icon}</View>
      <View style={styles.tileText}>
        <ThemedText type="smallBold" numberOfLines={1} style={styles.tabular}>
          {value}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {label}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
  name: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '700',
  },
  tiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  tile: {
    flexBasis: '45%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.two,
    borderRadius: Radius.medium,
  },
  bubble: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyDay: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
  },
  tileText: {
    flex: 1,
  },
  tabular: {
    fontVariant: ['tabular-nums'],
  },
  medals: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: Spacing.three,
    marginTop: -Spacing.one,
  },
  medal: {
    width: '33.33%',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.one,
  },
  medalLabel: {
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 16,
  },
});
