import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type Segment<T extends string> = {
  value: T;
  label: string;
  /**
   * What a screen reader says, when the chip has to be shorter than the thing
   * it names. Five segments share a phone's width, so a label sometimes has to
   * lose a word that the spoken version keeps.
   */
  accessibilityLabel?: string;
};

export type SegmentedControlProps<T extends string> = {
  value: T;
  options: readonly Segment<T>[];
  onChange: (value: T) => void;
  accessibilityLabel?: string;
};

/**
 * Compact row of choices, for picking between a handful of short labels inline.
 * `OptionPicker` is the stacked version, for options that need a sentence of
 * explanation; this one is for things like a field's side.
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  accessibilityLabel,
}: SegmentedControlProps<T>) {
  const theme = useTheme();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={[styles.track, { backgroundColor: theme.background, borderColor: theme.border }]}>
      {options.map((option) => {
        const selected = option.value === value;

        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            style={({ pressed }) => [
              styles.segment,
              {
                backgroundColor: selected ? theme.accent : 'transparent',
                opacity: pressed && !selected ? 0.6 : 1,
              },
            ]}>
            <ThemedText
              type="smallBold"
              style={{ color: selected ? theme.onAccent : theme.textSecondary }}>
              {option.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    padding: Spacing.half,
    gap: Spacing.half,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
  segment: {
    // Equal shares rather than label-sized: five options have to fit a phone.
    flex: 1,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    borderRadius: Radius.small,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
