import { useEffect, useState } from 'react';
import { Animated, Dimensions, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type SideMenuItem = { label: string; onPress: () => void };

export type SideMenuProps = {
  visible: boolean;
  items: SideMenuItem[];
  onClose: () => void;
};

/**
 * Three quarters of the screen, capped, and never wider than the screen minus a
 * strip — so a tappable piece of backdrop always shows and the panel reads as a
 * drawer rather than a full-screen takeover.
 */
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PANEL_WIDTH = Math.min(320, Math.round(SCREEN_WIDTH * 0.75), SCREEN_WIDTH - 56);

/**
 * A slide-out menu anchored to the left, behind a hamburger.
 *
 * An in-screen overlay rather than a `Modal`, on purpose. A React Native `Modal`
 * is a separate full-screen window: it always spans the whole display, and
 * `useSafeAreaInsets()` inside one returns zeros on Android, so the panel could
 * not be held to the app's height. Rendered here as the last child of the
 * screen, it fills only that screen's own box — which already sits below the
 * header and above nothing it should cover — so the panel is exactly as tall as
 * the app, no insets needed. It slides in on open; closing is immediate.
 *
 * Tapping an item closes the menu *before* running its action, the same order
 * `ActionSheet` uses: navigating out from under a still-open overlay is what
 * makes the next screen render behind it.
 */
export function SideMenu({ visible, items, onClose }: SideMenuProps) {
  const theme = useTheme();
  // Lazy state rather than a ref: the React Compiler forbids reading a ref's
  // value during render, and this animated value is read below for the transform.
  const [anim] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!visible) return;

    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [visible, anim]);

  if (!visible) return null;

  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [-PANEL_WIDTH, 0] });

  const run = (item: SideMenuItem) => {
    onClose();
    item.onPress();
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* The scrim: tapping anywhere off the panel closes the menu. Rendered
          before the panel so the panel sits on top of it. */}
      <Pressable style={[StyleSheet.absoluteFill, styles.backdrop]} onPress={onClose} />

      <Animated.View
        style={[
          styles.panel,
          {
            backgroundColor: theme.backgroundElement,
            borderColor: theme.border,
            transform: [{ translateX }],
          },
        ]}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <ThemedText style={styles.headerTitle}>Menu</ThemedText>
        </View>

        {items.map((item, index) => (
          <Pressable
            key={`${index}-${item.label}`}
            onPress={() => run(item)}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            style={({ pressed }) => [
              styles.item,
              { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' },
            ]}>
            <ThemedText style={styles.itemLabel}>{item.label}</ThemedText>
          </Pressable>
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  // Pinned to the left edge and the full height of the screen's own box — which
  // is the app's content area, not the whole display.
  panel: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: PANEL_WIDTH,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  header: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
  },
  item: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  itemLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
});
