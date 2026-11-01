import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Medal } from '@/components/medal';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { badgeId, formatCount, ladderStanding, type BadgeGroup, type BadgeProgress } from '@/lib/badges';
import { formatDate } from '@/lib/format';

export type BadgeSheetProps = {
  visible: boolean;
  group: BadgeGroup;
  progress: BadgeProgress;
  /** When each earned badge was earned, by id. */
  earnedAt: ReadonlyMap<string, Date>;
  onClose: () => void;
};

/**
 * One ladder in full: every tier as a medal with its condition, and beside it
 * the day it was earned — or, for the next one, how far there is to go.
 */
export function BadgeSheet({ visible, group, progress, earnedAt, onClose }: BadgeSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const earned = new Set(earnedAt.keys());
  const standing = ladderStanding(group, progress, earned);
  const count = group.tiers.filter((tier) => earned.has(badgeId(group.kind, tier))).length;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Swallows taps so they do not reach the backdrop behind the sheet. */}
        <Pressable
          onPress={() => {}}
          style={[
            styles.sheet,
            {
              backgroundColor: theme.backgroundElement,
              paddingBottom: insets.bottom + Spacing.three,
            },
          ]}>
          <View style={[styles.grabber, { backgroundColor: theme.border }]} />

          <View style={styles.header}>
            <Medal kind={group.kind} metal={standing.top} size={64} />
            <View style={styles.grow}>
              <ThemedText style={styles.title}>{group.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {count} z {group.tiers.length}
              </ThemedText>
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.list}>
            {group.tiers.map((tier, index) => {
              const id = badgeId(group.kind, tier);
              const at = earnedAt.get(id);
              const next = tier === standing.next;

              return (
                <View
                  key={tier}
                  accessible
                  style={[styles.row, at || next ? null : styles.later]}>
                  <Medal kind={group.kind} metal={at ? index : -1} size={36} ribbon={false} />
                  <ThemedText type={at ? 'smallBold' : 'small'} style={styles.grow}>
                    {group.label(tier)}
                  </ThemedText>
                  {at ? (
                    <ThemedText type="small" themeColor="textSecondary">
                      {formatDate(at)}
                    </ThemedText>
                  ) : next ? (
                    <ThemedText type="small" style={{ color: theme.accent }}>
                      {formatCount(standing.count)} / {formatCount(tier)}
                    </ThemedText>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>

          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.close,
              { backgroundColor: pressed ? theme.backgroundSelected : theme.background },
            ]}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              Zamknij
            </ThemedText>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    width: '100%',
    maxWidth: MaxContentWidth,
    maxHeight: '85%',
    alignSelf: 'center',
    paddingTop: Spacing.two,
    borderTopLeftRadius: Radius.large,
    borderTopRightRadius: Radius.large,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
  },
  grow: {
    flex: 1,
  },
  list: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  later: {
    opacity: 0.6,
  },
  close: {
    marginTop: Spacing.three,
    marginHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Radius.medium,
    alignItems: 'center',
  },
});
