import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type PickerOption<T extends string | number> = {
  value: T;
  label: string;
  /** One line under the label, for what the option actually does. */
  hint?: string;
};

export type OptionPickerProps<T extends string | number> = {
  label: string;
  hint?: string;
  value: T;
  options: readonly PickerOption<T>[];
  onChange: (value: T) => void;
};

/**
 * Vertical radio group. Stacked rather than segmented because the labels are
 * whole Polish phrases, which a row of chips would truncate on a phone.
 */
export function OptionPicker<T extends string | number>({
  label,
  hint,
  value,
  options,
  onChange,
}: OptionPickerProps<T>) {
  const theme = useTheme();

  return (
    <View style={styles.wrapper} accessibilityRole="radiogroup" accessibilityLabel={label}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {label}
      </ThemedText>
      {hint ? (
        <ThemedText type="small" themeColor="textSecondary">
          {hint}
        </ThemedText>
      ) : null}

      <View style={styles.options}>
        {options.map((option) => {
          const selected = option.value === value;

          return (
            <Pressable
              key={option.value}
              onPress={() => onChange(option.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={option.label}
              accessibilityHint={option.hint}
              style={({ pressed }) => [
                styles.option,
                {
                  backgroundColor: selected ? theme.backgroundSelected : theme.backgroundElement,
                  borderColor: selected ? theme.accent : theme.border,
                  borderWidth: selected ? 1 : StyleSheet.hairlineWidth,
                  opacity: pressed ? 0.75 : 1,
                },
              ]}>
              <View style={styles.optionText}>
                <ThemedText style={selected ? styles.selectedLabel : null}>
                  {option.label}
                </ThemedText>
                {option.hint ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {option.hint}
                  </ThemedText>
                ) : null}
              </View>

              <View
                style={[
                  styles.dot,
                  { borderColor: selected ? theme.accent : theme.border },
                  selected ? { backgroundColor: theme.accent } : null,
                ]}
              />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: Spacing.two,
  },
  options: {
    gap: Spacing.two,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 48,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.medium,
  },
  optionText: {
    flex: 1,
    gap: Spacing.half,
  },
  selectedLabel: {
    fontWeight: '700',
  },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
  },
});
