import { StyleSheet, View, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { HelpBlock } from '@/constants/help';
import { Spacing } from '@/constants/theme';

/**
 * A topic's body — paragraphs, bullets and numbered steps. Shared by the "?"
 * sheet and the "O tej aplikacji" screen, so a topic reads the same wherever
 * it is opened.
 */
export function HelpBody({ body, style }: { body: readonly HelpBlock[]; style?: ViewStyle }) {
  return (
    <View style={[styles.body, style]}>
      {body.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </View>
  );
}

function Block({ block }: { block: HelpBlock }) {
  if (typeof block === 'string') {
    return <ThemedText style={styles.text}>{block}</ThemedText>;
  }

  const numbered = 'steps' in block;
  const items = numbered ? block.steps : block.list;

  return (
    <View style={styles.items}>
      {items.map((item, index) => (
        <View key={index} style={styles.item}>
          <ThemedText themeColor="textSecondary" style={[styles.text, styles.marker]}>
            {numbered ? `${index + 1}.` : '•'}
          </ThemedText>
          <ThemedText style={[styles.text, styles.itemText]}>{item}</ThemedText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: Spacing.three,
  },
  text: {
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
    minWidth: 16,
  },
  itemText: {
    flex: 1,
  },
});
