import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type SheetAction = {
  label: string;
  onPress: () => void;
  /** Rendered in the danger colour. */
  destructive?: boolean;
  /**
   * Keeps the sheet open — for entries that only swap what it shows. Replacing
   * one `Modal` with another in the same frame drops the animation on Android,
   * so a submenu reuses this sheet instead of opening a second one.
   */
  keepOpen?: boolean;
};

export type ActionSheetProps = {
  visible: boolean;
  title: string;
  subtitle?: string;
  actions: SheetAction[];
  onClose: () => void;
};

/**
 * Bottom sheet used instead of `Alert.alert` for menus. The native Android
 * dialog caps out at three buttons, drops the rest without warning and cannot
 * be styled; this one takes any number of entries and follows the app theme.
 */
export function ActionSheet({ visible, title, subtitle, actions, onClose }: ActionSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  // Close first: navigating out from under a visible modal is what makes the
  // next screen render behind it.
  const run = (action: SheetAction) => {
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

          {actions.map((action, index) => (
            <Pressable
              key={`${index}-${action.label}`}
              onPress={() => run(action)}
              style={({ pressed }) => [
                styles.action,
                {
                  borderColor: theme.border,
                  backgroundColor: pressed ? theme.backgroundSelected : 'transparent',
                },
              ]}>
              <ThemedText
                style={[styles.actionLabel, action.destructive ? { color: theme.danger } : null]}>
                {action.label}
              </ThemedText>
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
  cancel: {
    marginTop: Spacing.three,
    marginHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Radius.medium,
    alignItems: 'center',
  },
});
