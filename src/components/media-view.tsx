import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useMemo } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { mediaLabel, MEDIA_MISSING_LABELS, type MediaKind } from '@/lib/media';
import { mediaUri } from '@/lib/media-files';

export type MediaViewProps = {
  kind: MediaKind;
  /** File name inside the app's directory for that kind. */
  fileName: string | null;
  /**
   * The original file name. Shown next to a player where it helps — in the
   * editor, to tell one attachment from another. On the card itself it is left
   * out: the field is the sound or the picture, not the name of a file.
   */
  label?: string;
};

/**
 * Shows one media field: a play button for sound, the picture itself for an
 * image, a player with the usual controls for video. The file lives in the
 * app's own directory and may be gone — a card restored on another install, a
 * copy deleted by hand — so the missing case is shown rather than silently
 * rendering nothing.
 */
export function MediaView({ kind, fileName, label }: MediaViewProps) {
  const theme = useTheme();
  const uri = useMemo(() => mediaUri(kind, fileName), [kind, fileName]);

  if (!uri) {
    return (
      <ThemedText type="small" style={{ color: theme.danger }}>
        {MEDIA_MISSING_LABELS[kind]}
      </ThemedText>
    );
  }

  if (kind === 'audio') return <AudioPlayer uri={uri} label={label} />;
  if (kind === 'video') return <VideoPlayer uri={uri} label={label} />;

  return (
    <Image
      source={{ uri }}
      style={styles.image}
      resizeMode="contain"
      accessible
      accessibilityRole="image"
      accessibilityLabel={mediaLabel('image', label ?? '')}
    />
  );
}

/** Sound: one button that starts from the top and can be stopped mid-way. */
function AudioPlayer({ uri, label }: { uri: string; label?: string }) {
  const theme = useTheme();
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);

  const named = Boolean(label && label.trim());
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
        accessibilityLabel={`${playing ? 'Zatrzymaj' : 'Odtwórz'}: ${mediaLabel('audio', label ?? '')}`}
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
          {mediaLabel('audio', label ?? '')}
        </ThemedText>
      ) : null}
    </View>
  );
}

/**
 * Video: the frame itself with the platform's own controls. Nothing plays on
 * its own — a card may hold several fields, and a review screen that started
 * talking the moment it appeared would be unusable.
 */
function VideoPlayer({ uri, label }: { uri: string; label?: string }) {
  const player = useVideoPlayer(uri);

  return (
    <VideoView
      player={player}
      style={styles.video}
      contentFit="contain"
      nativeControls
      fullscreenOptions={{ enable: true }}
      accessible
      accessibilityLabel={mediaLabel('video', label ?? '')}
    />
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
  image: {
    width: '100%',
    height: 200,
    borderRadius: Radius.medium,
  },
  video: {
    width: '100%',
    height: 200,
    borderRadius: Radius.medium,
    // The frame is letterboxed against black, the way a video player looks
    // everywhere else, instead of showing the card's background through it.
    backgroundColor: '#000',
  },
});
