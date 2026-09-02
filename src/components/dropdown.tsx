import { useState } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type DropdownOption<T extends string> = { value: T; label: string };

export type DropdownProps<T extends string> = {
  /** Shown above the field, the way `TextField` shows its own. */
  label?: string;
  value: T;
  options: readonly DropdownOption<T>[];
  onChange: (value: T) => void;
  accessibilityLabel?: string;
  style?: ViewStyle;
};

/**
 * A closed field naming the current choice, which opens into the list of the
 * rest. Unlike `SegmentedControl` it costs one line whatever the number of
 * options, so the labels can say what they mean instead of being squeezed into
 * a share of the screen width.
 *
 * The list pushes what is below it down rather than floating over it: this
 * lives inside a `FlatList` header, where an absolutely positioned panel would
 * be drawn under the rows or clipped away entirely.
 */
export function Dropdown<T extends string>({
  label,
  value,
  options,
  onChange,
  accessibilityLabel,
  style,
}: DropdownProps<T>) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  const current = options.find((option) => option.value === value);

  const pick = (next: T) => {
    setOpen(false);
    onChange(next);
  };

  return (
    <View style={[styles.wrapper, style]}>
      {label ? (
        <ThemedText type="smallBold" themeColor="textSecondary">
          {label}
        </ThemedText>
      ) : null}
      <Pressable
        onPress={() => setOpen((was) => !was)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={
          accessibilityLabel ? `${accessibilityLabel}: ${current?.label ?? ''}` : current?.label
        }
        style={({ pressed }) => [
          styles.field,
          {
            borderColor: open ? theme.accent : theme.border,
            backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
          },
        ]}>
        <ThemedText type="small" numberOfLines={1} style={styles.label}>
          {current?.label ?? ''}
        </ThemedText>
        <ThemedText type="small" style={{ color: theme.accent }}>
          {open ? '▲' : '▼'}
        </ThemedText>
      </Pressable>

      {open ? (
        <View
          style={[
            styles.panel,
            { borderColor: theme.border, backgroundColor: theme.backgroundElement },
          ]}>
          {options.map((option) => {
            const selected = option.value === value;

            return (
              <Pressable
                key={option.value}
                onPress={() => pick(option.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={option.label}
                style={({ pressed }) => [
                  styles.option,
                  {
                    borderColor: theme.border,
                    backgroundColor: pressed ? theme.backgroundSelected : 'transparent',
                  },
                ]}>
                <ThemedText
                  type={selected ? 'smallBold' : 'small'}
                  style={selected ? { color: theme.accent } : undefined}>
                  {option.label}
                </ThemedText>
                {selected ? (
                  <ThemedText type="small" style={{ color: theme.accent }}>
                    ✓
                  </ThemedText>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: Spacing.two,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: {
    flexShrink: 1,
  },
  panel: {
    marginTop: Spacing.one,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
