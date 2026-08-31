import { StyleSheet, View } from 'react-native';

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
};

/**
 * A card as the learner sees it: each face reads in the order the editor
 * arranged it, so the mandatory field is one line among the extras rather than
 * always the first. Both the review screen and the editor's preview render
 * through here — a preview that used its own code could lie.
 */
export function CardFaces({ frontLines, backLines, revealed, compact = false }: CardFacesProps) {
  const theme = useTheme();

  const renderLine = (prefix: string, item: CardLine, index: number) => {
    if (item.media) {
      return (
        <MediaView
          key={`${prefix}-${index}`}
          kind={item.media.kind}
          fileName={item.media.fileName}
        />
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
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
  },
});
