import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as Speech from 'expo-speech';

import { SpeakerIcon } from '@/components/icons';
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
   * The voice a line reads in **when it has none of its own** — which today
   * means only a retired `speech` field, the one kind that never carried a
   * language. Every text spoken since carries its own, so this is a fallback
   * and not the rule: a card whose question is Polish and whose answer is
   * Portuguese reads each in its own voice, which one deck-wide setting could
   * never do.
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

  /**
   * The loudspeaker for a line, tapped to hear what the line says.
   *
   * It never plays by itself — the same rule video lives by, and more so here:
   * a card may carry several spoken texts and a screen that starts talking on
   * its own is unbearable.
   *
   * `alone` is the retired `speech` field, where the button **was** the field
   * and keeps the size of one. Everywhere else it is a mark beside the words:
   * no ring, no ground, and drawn in the quiet text colour, because what is
   * worth looking at on a card is what is written on it. Pressing lifts it to
   * the accent — which is only possible because the icon is drawn rather than
   * set in an emoji font, where colour is not ours to choose. The tap target
   * stays full size through `hitSlop`: subtle is about how much of the eye it
   * takes, not how hard it is to hit.
   */
  const speaker = (speak: NonNullable<CardLine['speak']>, alone = false) => {
    const language = speak.language ?? voice;

    return (
      <Pressable
        onPress={() => {
          // Stopping first makes a second tap mean "say it again" rather than
          // "queue it up", which is what anybody drilling a word wants.
          Speech.stop();
          Speech.speak(speak.text, language ? { language } : undefined);
        }}
        accessibilityRole="button"
        accessibilityLabel={`Przeczytaj: ${speak.text}`}
        hitSlop={16}
        style={({ pressed }) =>
          alone
            ? [
                styles.speech,
                {
                  borderColor: theme.border,
                  backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
                },
              ]
            : styles.speechInline
        }>
        {({ pressed }) => (
          <SpeakerIcon
            size={alone ? 22 : 14}
            // The old field's button says what it is with its ring, so its icon
            // keeps the accent. The inline mark has nothing but its colour to
            // stay quiet with, and the accent is what answers a touch.
            color={alone || pressed ? theme.accent : theme.textSecondary}
          />
        )}
      </Pressable>
    );
  };

  /**
   * Words and their loudspeaker, side by side.
   *
   * Beside rather than beneath, because next to a word is where a mark about
   * that word belongs — on its own line under a short word it reads as a third
   * thing on the card rather than as part of the second. The row is centred as
   * a unit and the text is free to shrink, so long text wraps inside what is
   * left and the glyph settles against the middle of the block instead of
   * pushing anything off the screen.
   */
  const withSpeaker = (content: ReactNode, speak: CardLine['speak'], key: string) =>
    speak ? (
      <View key={key} style={styles.spoken}>
        {content}
        {speaker(speak)}
      </View>
    ) : (
      content
    );

  const renderLine = (prefix: string, item: CardLine, index: number) => {
    const key = `${prefix}-${index}`;

    // A retired `speech` field has no words of its own: the button is the whole
    // line, and it keeps the full size it had when it was a field.
    if (item.speak && !item.text.trim() && !item.media) {
      return <View key={key}>{speaker(item.speak, true)}</View>;
    }

    if (item.media) {
      const view = <MediaView kind={item.media.kind} fileName={item.media.fileName} />;

      // Every other media field keeps its label off the card — the field is the
      // sound or the picture, not the name of a file. A mnemonic is the
      // exception, and not a small one: its text is the association itself, the
      // half that does the remembering. A picture of a mosquito eating means
      // nothing without "Komar je" underneath it.
      if (item.media.kind !== 'mnemonic' || !item.text.trim()) {
        return <View key={key}>{view}</View>;
      }

      // The loudspeaker goes beside the **sentence**, not beside the block: the
      // sentence is what it reads, and a picture is not something a glyph can
      // stand next to without taking width away from it.
      return (
        <View key={key} style={styles.mnemonic}>
          {view}
          {withSpeaker(
            <ThemedText
              key={`${key}-text`}
              style={[
                compact ? styles.valueCompact : styles.value,
                item.speak ? styles.shrink : null,
              ]}>
              {item.text}
            </ThemedText>,
            item.speak,
            `${key}-said`
          )}
        </View>
      );
    }

    const base = item.base ? (compact ? styles.faceCompact : styles.face) : null;
    const extra = compact ? styles.valueCompact : styles.value;

    return withSpeaker(
      <ThemedText
        key={key}
        style={[
          base ?? extra,
          item.base && prefix === 'back' ? styles.answer : null,
          item.speak ? styles.shrink : null,
        ]}>
        {item.text}
      </ThemedText>,
      item.speak,
      key
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
  /** A mark beside the words, not a control competing with them. */
  speechInline: {
    paddingHorizontal: Spacing.half,
  },
  /**
   * Words and glyph on one line, centred as a unit. `shrink` on the text is
   * what keeps long text wrapping inside what is left over rather than pushing
   * the glyph off the card.
   */
  spoken: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    alignSelf: 'stretch',
  },
  shrink: {
    flexShrink: 1,
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
