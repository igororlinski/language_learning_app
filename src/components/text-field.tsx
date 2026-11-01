import type { Ref } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  type TextInputInstance,
  type TextInputProps,
} from 'react-native';

import { WithHelp } from '@/components/help-button';
import { ThemedText } from '@/components/themed-text';
import type { HelpTopicId } from '@/constants/help';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type TextFieldProps = TextInputProps & {
  label: string;
  /** A "?" after the label, opening this topic. */
  help?: HelpTopicId;
  /** Shown under the field and paints its border: what is wrong with the value. */
  error?: string;
  ref?: Ref<TextInputInstance>;
};

export function TextField({ label, help, error, style, multiline, ref, ...rest }: TextFieldProps) {
  const theme = useTheme();

  return (
    <View style={styles.wrapper}>
      <WithHelp topic={help}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          {label}
        </ThemedText>
      </WithHelp>
      <TextInput
        ref={ref}
        multiline={multiline}
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          {
            color: theme.text,
            backgroundColor: theme.backgroundElement,
            borderColor: error ? theme.danger : theme.border,
          },
          multiline && styles.multiline,
          style,
        ]}
        {...rest}
      />
      {error ? (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: Spacing.two,
  },
  input: {
    minHeight: 48,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: 16,
  },
  multiline: {
    minHeight: 112,
    textAlignVertical: 'top',
    paddingTop: Spacing.three,
  },
});
