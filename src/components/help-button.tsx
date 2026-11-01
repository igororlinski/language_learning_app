import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { HelpSheet } from '@/components/help-sheet';
import { HelpIcon } from '@/components/icons';
import { HELP_TOPICS, type HelpTopicId } from '@/constants/help';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type HelpButtonProps = {
  /** Which entry of `HELP_TOPICS` the button opens. */
  topic: HelpTopicId;
  size?: number;
  style?: ViewStyle;
};

/**
 * A "?" that opens the explanation of one topic. Each button owns its sheet,
 * so dropping one into a screen takes nothing else — no provider, no state in
 * the screen.
 *
 * Grey rather than accent: it is there for whoever looks for it and should not
 * compete with the controls it sits beside.
 */
export function HelpButton({ topic, size = 16, style }: HelpButtonProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={`Pomoc: ${HELP_TOPICS[topic].title}`}
        style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }, style]}>
        <HelpIcon size={size} color={theme.textSecondary} />
      </Pressable>
      <HelpSheet visible={open} topic={topic} onClose={() => setOpen(false)} />
    </>
  );
}

/**
 * A heading — or anything else — with a "?" after it. Without a topic it
 * renders the children alone, so a component can take an optional `help` prop
 * and pass it straight through.
 */
export function WithHelp({ topic, children }: { topic?: HelpTopicId; children: ReactNode }) {
  if (!topic) return children;

  return (
    <View style={styles.row}>
      <View style={styles.label}>{children}</View>
      <HelpButton topic={topic} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  // Lets a long heading wrap instead of pushing the "?" off the screen.
  label: {
    flexShrink: 1,
  },
});
