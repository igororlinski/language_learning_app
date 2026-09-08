import { Pressable, StyleSheet, View } from 'react-native';
import * as Speech from 'expo-speech';

import { MediaView } from '@/components/media-view';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { CardLine } from '@/lib/card-layout';

export type CardFacesProps = {
  frontLines: CardLine[];
  backLines: CardLine[];
  /** The back is hidden until the answer is shown; the preview always shows it. */
  revealed: boolean;
  /** Smaller type for the preview, where the card shares the screen with a form. */
  compact?: boolean;
  /**
   * Which voice a speech line reads in — the deck's answer language, or null
   * when it declares none. Passed in rather than read from a line because it
   * belongs to the deck, not to the field: every line on the card speaks the
   * same language.
   */
  voice?: string | null;
};

/**
 * A card as the learner sees it: each face reads in the order the editor
 * arranged it, so the mandatory field is one line among the extras rather than
 * always the first. Both the review screen and the editor's preview render
 * through here — a preview that used its own code could lie.
 */
export function CardFaces({
  frontLines,
  backLines,
  revealed,
  compact = false,
  voice = null,
}: CardFacesProps) {
  const theme = useTheme();

  const renderLine = (prefix: string, item: CardLine, index: number) => {
    // A speech field is a button and nothing else. It never plays by itself —
    // the same rule video lives by, and more so here: a card may carry several
    // and a screen that starts talking on its own is unbearable.
    if (item.speak) {
      return (
        <Pressable
          key={`${prefix}-${index}`}
          onPress={() => {
            // Stopping first makes a second tap mean "say it again" rather than
            // "queue it up", which is what anybody drilling a word wants.
            Speech.stop();
            Speech.speak(item.speak as string, voice ? { language: voice } : undefined);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Przeczytaj: ${item.speak}`}
          hitSlop={12}
          style={({ pressed }) => [
            styles.speech,
            {
              borderColor: theme.border,
              backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
            },
          ]}>
          <ThemedText style={[styles.speechGlyph, { color: theme.accent }]}>🔊</ThemedText>
        </Pressable>
      );
    }

    if (item.media) {
      const view = <MediaView kind={item.media.kind} fileName={item.media.fileName} />;

      // Every other media field keeps its label off the card — the field is the
      // sound or the picture, not the name of a file. A mnemonic is the
      // exception, and not a small one: its text is the association itself, the
      // half that does the remembering. A picture of a mosquito eating means
      // nothing without "Komar je" underneath it.
      if (item.media.kind !== 'mnemonic' || !item.text.trim()) {
        return <View key={`${prefix}-${index}`}>{view}</View>;
      }

      return (
        <View key={`${prefix}-${index}`} style={styles.mnemonic}>
          {view}
          <ThemedText style={compact ? styles.valueCompact : styles.value}>{item.text}</ThemedText>
        </View>
      );
    }

    const base = item.base ? (compact ? styles.faceCompact : styles.face) : null;
    const extra = compact ? styles.valueCompact : styles.value;

    return (
      <ThemedText
        key={`${prefix}-${index}`}
        style={[
          base ?? extra,
          item.base && prefix === 'back' ? styles.answer : null,
        ]}>
        {item.text}
      </ThemedText>
    );
  };

  return (
    <>
      {frontLines.map((item, index) => renderLine('front', item, index))}

      {revealed ? (
        <>
          <View style={[styles.divider, { borderColor: theme.border }]} />
          {backLines.map((item, index) => renderLine('back', item, index))}
        </>
      ) : null}
    </>
  );
}

/** Layout for a whole face area — the review screen's card region. */
export const cardFacesLayout = StyleSheet.create({
  area: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.four,
    padding: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
});

const styles = StyleSheet.create({
  face: {
    fontSize: 26,
    lineHeight: 34,
    fontWeight: '600',
    textAlign: 'center',
  },
  faceCompact: {
    fontSize: 19,
    lineHeight: 26,
    fontWeight: '600',
    textAlign: 'center',
  },
  answer: {
    fontWeight: '400',
  },
  value: {
    fontSize: 18,
    lineHeight: 26,
    textAlign: 'center',
  },
  valueCompact: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  /** A round button, sized like the play control on an audio field. */
  speech: {
    alignSelf: 'center',
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speechGlyph: {
    fontSize: 24,
  },
  /** Picture and sentence read as one thing, so they sit closer than two lines. */
  mnemonic: {
    gap: Spacing.two,
    alignSelf: 'stretch',
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
  },
});
