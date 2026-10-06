import { Modal, Pressable, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SegmentedControl } from '@/components/segmented-control';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type SheetAction = {
  label: string;
  onPress: () => void;
  /** Rendered in the danger colour. */
  destructive?: boolean;
  /**
   * Greys the entry out and stops it responding. An entry that cannot be used
   * right now stays on the list rather than disappearing: a menu that quietly
   * drops items teaches the user the feature does not exist.
   */
  disabled?: boolean;
  /** A second line under the label — mostly why a disabled entry is disabled. */
  hint?: string;
  /**
   * Keeps the sheet open — for entries that only swap what it shows. Replacing
   * one `Modal` with another in the same frame drops the animation on Android,
   * so a submenu reuses this sheet instead of opening a second one.
   */
  keepOpen?: boolean;
};

/**
 * A two-state setting shown above the actions, for the things a menu toggles
 * rather than does. A setting changes something and leaves the sheet open; an
 * action is a verb that runs once and closes it. Keeping them in the same sheet,
 * but told apart by their shape, is what makes a menu readable: a switch looks
 * like a switch and a choice looks like a choice, instead of every option being
 * a line of text you tap and guess at.
 */
export type SheetSetting =
  | {
      kind: 'segment';
      /** The small label above the choice. */
      label: string;
      value: string;
      options: readonly { value: string; label: string }[];
      onChange: (value: string) => void;
    }
  | {
      kind: 'toggle';
      label: string;
      value: boolean;
      onChange: (value: boolean) => void;
    };

export type ActionSheetProps = {
  visible: boolean;
  title: string;
  subtitle?: string;
  /** Two-state controls shown above the actions; mostly empty. */
  settings?: SheetSetting[];
  actions: SheetAction[];
  onClose: () => void;
};

/**
 * Bottom sheet used instead of `Alert.alert` for menus. The native Android
 * dialog caps out at three buttons, drops the rest without warning and cannot
 * be styled; this one takes any number of entries and follows the app theme.
 */
export function ActionSheet({
  visible,
  title,
  subtitle,
  settings,
  actions,
  onClose,
}: ActionSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  // Close first: navigating out from under a visible modal is what makes the
  // next screen render behind it.
  const run = (action: SheetAction) => {
    if (action.disabled) return;
    if (!action.keepOpen) onClose();
    action.onPress();
  };

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
            <ThemedText style={styles.title} numberOfLines={2}>
              {title}
            </ThemedText>
            {subtitle ? (
              <ThemedText type="small" themeColor="textSecondary">
                {subtitle}
              </ThemedText>
            ) : null}
          </View>

          {settings && settings.length > 0 ? (
            <View style={styles.settings}>
              {settings.map((setting, index) =>
                setting.kind === 'segment' ? (
                  <View key={`setting-${index}`} style={styles.setting}>
                    <ThemedText type="small" themeColor="textSecondary">
                      {setting.label}
                    </ThemedText>
                    <SegmentedControl
                      value={setting.value}
                      options={setting.options}
                      onChange={setting.onChange}
                      accessibilityLabel={setting.label}
                    />
                  </View>
                ) : (
                  <View key={`setting-${index}`} style={[styles.setting, styles.toggle]}>
                    <ThemedText style={styles.toggleLabel}>{setting.label}</ThemedText>
                    <Switch
                      value={setting.value}
                      onValueChange={setting.onChange}
                      trackColor={{ true: theme.accent, false: theme.border }}
                      thumbColor={theme.backgroundElement}
                      ios_backgroundColor={theme.border}
                    />
                  </View>
                )
              )}
            </View>
          ) : null}

          {actions.map((action, index) => (
            <Pressable
              key={`${index}-${action.label}`}
              onPress={() => run(action)}
              disabled={action.disabled}
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(action.disabled) }}
              accessibilityLabel={action.hint ? `${action.label}. ${action.hint}` : action.label}
              style={({ pressed }) => [
                styles.action,
                {
                  borderColor: theme.border,
                  backgroundColor:
                    pressed && !action.disabled ? theme.backgroundSelected : 'transparent',
                },
              ]}>
              <ThemedText
                style={[
                  styles.actionLabel,
                  action.destructive ? { color: theme.danger } : null,
                  action.disabled ? styles.disabled : null,
                ]}>
                {action.label}
              </ThemedText>
              {action.hint ? (
                <ThemedText type="small" themeColor="textSecondary" style={styles.actionHint}>
                  {action.hint}
                </ThemedText>
              ) : null}
            </Pressable>
          ))}

          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              styles.cancel,
              { backgroundColor: pressed ? theme.backgroundSelected : theme.background },
            ]}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              Anuluj
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
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
    gap: Spacing.half,
  },
  settings: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
    gap: Spacing.three,
  },
  setting: {
    gap: Spacing.one,
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleLabel: {
    fontSize: 16,
    flexShrink: 1,
    paddingRight: Spacing.three,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
  },
  action: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionLabel: {
    fontSize: 16,
  },
  actionHint: {
    marginTop: Spacing.half,
  },
  /** Dimmed rather than hidden, so the entry still says what is possible. */
  disabled: {
    opacity: 0.4,
  },
  cancel: {
    marginTop: Spacing.three,
    marginHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Radius.medium,
    alignItems: 'center',
  },
});
