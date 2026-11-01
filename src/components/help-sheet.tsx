import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HelpBody } from '@/components/help-body';
import { ThemedText } from '@/components/themed-text';
import { HELP_TOPICS, type HelpTopicId } from '@/constants/help';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type HelpSheetProps = {
  visible: boolean;
  topic: HelpTopicId;
  onClose: () => void;
};

/**
 * The explanation behind a "?" — a bottom sheet in the same frame as the menus,
 * with a scrolling body, since a topic can run longer than a screen.
 */
export function HelpSheet({ visible, topic, onClose }: HelpSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { title, body } = HELP_TOPICS[topic];

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

          <ThemedText style={styles.title}>{title}</ThemedText>
          <ScrollView contentContainerStyle={styles.body}>
            <HelpBody body={body} />
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
  title: {
    fontSize: 17,
    fontWeight: '600',
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.two,
  },
  body: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.two,
  },
  close: {
    marginTop: Spacing.three,
    marginHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Radius.medium,
    alignItems: 'center',
  },
});
