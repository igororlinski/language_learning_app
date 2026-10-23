import { useEvent } from 'expo';
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
 * image — generated or chosen, they render the same — the frame itself for
 * video. The file lives in the app's own directory
 * and may be gone — a card restored on another install, a copy deleted by hand
 * — so the missing case is shown rather than silently rendering nothing.
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

/** A frame that has not reported its shape yet is assumed to be widescreen. */
const DEFAULT_VIDEO_RATIO = 16 / 9;

/** How tall an upright clip may get before it starts crowding out the card. */
const MAX_VIDEO_HEIGHT = 320;

/**
 * Video: the picture and nothing else.
 *
 * The platform's own controls are off. They are built for a full-width player
 * and on a frame this size the scrim, the centre button and the seek bar cover
 * most of the clip — which is the whole content of the field. What replaces
 * them is the same gesture the audio field uses: one tap. The glyph shows only
 * while the clip is paused, so a playing video is never covered by anything.
 *
 * Nothing plays on its own — a card may hold several fields, and a review
 * screen that started talking the moment it appeared would be unusable.
 */
function VideoPlayer({ uri, label }: { uri: string; label?: string }) {
  const player = useVideoPlayer(uri);

  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const { videoTrack } = useEvent(player, 'videoTrackChange', { videoTrack: player.videoTrack });

  // Sizing the frame to the clip is what buys back the room: a 16:9 video in a
  // fixed 200 px box wasted the width, and an upright one — the shape a phone
  // records by default — was left tiny between two black bars.
  const size = videoTrack?.size;
  const ratio =
    size && size.width > 0 && size.height > 0 ? size.width / size.height : DEFAULT_VIDEO_RATIO;

  const toggle = () => {
    if (isPlaying) {
      player.pause();
      return;
    }

    // A clip that ran to the end sits on its last frame, where play() does
    // nothing; from anywhere else, carry on where it was paused.
    const ended = player.duration > 0 && player.currentTime >= player.duration - 0.1;
    if (ended) player.replay();
    else player.play();
  };

  return (
    <View
      style={[
        styles.video,
        ratio >= 1
          ? { width: '100%', aspectRatio: ratio }
          : { height: MAX_VIDEO_HEIGHT, aspectRatio: ratio, alignSelf: 'center' },
      ]}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="contain"
        nativeControls={false}
      />
      <Pressable
        onPress={toggle}
        style={StyleSheet.absoluteFill}
        accessibilityRole="button"
        accessibilityLabel={`${isPlaying ? 'Zatrzymaj' : 'Odtwórz'}: ${mediaLabel('video', label ?? '')}`}>
        {isPlaying ? null : (
          <View style={styles.videoGlyphArea}>
            <View style={styles.videoGlyphCircle}>
              <ThemedText style={styles.videoGlyph}>▶</ThemedText>
            </View>
          </View>
        )}
      </Pressable>
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
  image: {
    width: '100%',
    height: 200,
    borderRadius: Radius.medium,
  },
  video: {
    borderRadius: Radius.medium,
    overflow: 'hidden',
    // The frame is letterboxed against black, the way a video player looks
    // everywhere else, instead of showing the card's background through it.
    backgroundColor: '#000',
  },
  videoGlyphArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Its own colours, not the theme's: this sits on top of the picture. */
  videoGlyphCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  videoGlyph: {
    fontSize: 22,
    lineHeight: 28,
    color: '#fff',
    // The glyph's own bearing sits it left of centre in the circle.
    marginLeft: 3,
  },
});
