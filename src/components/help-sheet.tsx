import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { HELP_TOPICS, type HelpBlock, type HelpTopicId } from '@/constants/help';
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
            {body.map((block, index) => (
              <Block key={index} block={block} />
            ))}
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

function Block({ block }: { block: HelpBlock }) {
  if (typeof block === 'string') {
    return <ThemedText style={styles.paragraph}>{block}</ThemedText>;
  }

  const numbered = 'steps' in block;
  const items = numbered ? block.steps : block.list;

  return (
    <View style={styles.items}>
      {items.map((item, index) => (
        <View key={index} style={styles.item}>
          <ThemedText themeColor="textSecondary" style={styles.marker}>
            {numbered ? `${index + 1}.` : '•'}
          </ThemedText>
          <ThemedText style={styles.itemText}>{item}</ThemedText>
        </View>
      ))}
    </View>
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
    gap: Spacing.three,
  },
  paragraph: {
    fontSize: 15,
    lineHeight: 22,
  },
  items: {
    gap: Spacing.two,
  },
  item: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  marker: {
    fontSize: 15,
    lineHeight: 22,
    minWidth: 16,
  },
  itemText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
  },
  close: {
    marginTop: Spacing.three,
    marginHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Radius.medium,
    alignItems: 'center',
  },
});
