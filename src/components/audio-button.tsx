import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { audioLabel } from '@/lib/audio';
import { audioUri } from '@/lib/audio-files';

export type AudioButtonProps = {
  /** File name inside the app's audio directory. */
  audioPath: string | null;
  /**
   * The original file name. Shown next to the button where it helps — in the
   * editor, to tell one attachment from another. On the card itself it is left
   * out: the field is the sound, and the name of a file says nothing about it.
   */
  label?: string;
};

/**
 * Plays one audio field. The file lives in the app's own directory and may be
 * gone — a card restored on another install, a copy deleted by hand — so the
 * missing case is shown rather than silently doing nothing on tap.
 */
export function AudioButton({ audioPath, label }: AudioButtonProps) {
  const theme = useTheme();

  const uri = useMemo(() => audioUri(audioPath), [audioPath]);
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);

  const named = Boolean(label && label.trim());

  if (!uri) {
    return (
      <View style={named ? styles.row : styles.alone}>
        <ThemedText type="small" style={{ color: theme.danger }}>
          Brak pliku dźwiękowego
        </ThemedText>
      </View>
    );
  }

  const playing = status.playing;

  const toggle = () => {
    if (playing) {
      player.pause();
      return;
    }

    // Always from the top: a field is a word or a sentence, not a track.
    player.seekTo(0);
    player.play();
  };

  return (
    <View style={named ? styles.row : styles.alone}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={`${playing ? 'Zatrzymaj' : 'Odtwórz'}: ${audioLabel(label ?? '')}`}
        style={({ pressed }) => [
          styles.button,
          named ? null : styles.buttonAlone,
          { backgroundColor: theme.accent, opacity: pressed ? 0.75 : 1 },
        ]}>
        <ThemedText style={[styles.glyph, { color: theme.onAccent }]}>
          {playing ? '❚❚' : '▶'}
        </ThemedText>
      </Pressable>

      {named ? (
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.label}>
          {audioLabel(label ?? '')}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  /** On the card there is nothing but the button, centred on its own line. */
  alone: {
    alignItems: 'center',
    alignSelf: 'center',
  },
  button: {
    width: 44,
    height: 44,
    borderRadius: Radius.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonAlone: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  glyph: {
    fontSize: 17,
    lineHeight: 22,
  },
  label: {
    flex: 1,
  },
});
