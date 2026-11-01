import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BadgeSheet } from '@/components/badge-sheet';
import { Medal } from '@/components/medal';
import { Meter } from '@/components/meter';
import { ThemedText } from '@/components/themed-text';
import { MedalColors, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  BADGE_GROUPS,
  formatCount,
  ladderStanding,
  type BadgeKind,
  type BadgeProgress,
} from '@/lib/badges';

export type BadgeBoardProps = {
  progress: BadgeProgress;
  /** When each earned badge was earned, by id. */
  earnedAt: ReadonlyMap<string, Date>;
};

/**
 * Every ladder as one medal in the metal of its highest tier, with how far
 * the next one is. A tap opens the whole ladder.
 */
export function BadgeBoard({ progress, earnedAt }: BadgeBoardProps) {
  const theme = useTheme();
  const earned = new Set(earnedAt.keys());
  const total = BADGE_GROUPS.reduce((sum, group) => sum + group.tiers.length, 0);

  // The ladder shown stays put while the sheet fades out.
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<BadgeKind>(BADGE_GROUPS[0].kind);
  const shownGroup = BADGE_GROUPS.find((group) => group.kind === shown) ?? BADGE_GROUPS[0];

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        Odznaki · {earned.size}/{total}
      </ThemedText>

      <View style={styles.grid}>
        {BADGE_GROUPS.map((group) => {
          const standing = ladderStanding(group, progress, earned);
          const nextMetal = MedalColors[Math.min(standing.top + 1, MedalColors.length - 1)];

          return (
            <Pressable
              key={group.kind}
              onPress={() => {
                setShown(group.kind);
                setOpen(true);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${group.title}${
                standing.next == null ? ', komplet' : `, ${standing.count} z ${standing.next}`
              }`}
              style={({ pressed }) => [
                styles.tile,
                { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' },
              ]}>
              <Medal kind={group.kind} metal={standing.top} size={52} />
              <ThemedText type="small" numberOfLines={2} style={styles.tileTitle}>
                {group.title}
              </ThemedText>
              <Meter
                share={standing.share}
                color={nextMetal.face}
                trackColor={theme.backgroundSelected}
                height={4}
                style={styles.meter}
              />
              <ThemedText type="small" themeColor="textSecondary" style={styles.count}>
                {standing.next == null
                  ? 'komplet'
                  : `${formatCount(standing.count)} / ${formatCount(standing.next)}`}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      <BadgeSheet
        visible={open}
        group={shownGroup}
        progress={progress}
        earnedAt={earnedAt}
        onClose={() => setOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.three,
    gap: Spacing.two,
    borderRadius: Radius.large,
    borderWidth: StyleSheet.hairlineWidth,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: Spacing.two,
  },
  tile: {
    width: '33.33%',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.one,
    borderRadius: Radius.medium,
  },
  tileTitle: {
    textAlign: 'center',
    // Two lines whether the title takes one or two, so the bars line up.
    minHeight: 40,
    lineHeight: 20,
    marginBottom: Spacing.one,
  },
  meter: {
    width: '72%',
  },
  count: {
    fontVariant: ['tabular-nums'],
  },
});
