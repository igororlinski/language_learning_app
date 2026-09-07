import { Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { mediaUri } from '@/lib/media-files';

export type Choice = {
  /** Identifies the pick; the caller decides what it means. */
  key: string;
  /**
   * What distinguishes this entry from the others. Left out when the entries
   * differ only by their picture — three copies of one sentence under three
   * thumbnails is noise, and the sentence belongs in `subtitle` instead.
   */
  label?: string;
  /** A file in the `mnemonic` directory, shown above the label. */
  fileName?: string | null;
};

export type ChoiceSheetProps = {
  visible: boolean;
  title: string;
  /** What every entry has in common — shown once, above them. */
  subtitle?: string;
  choices: Choice[];
  onPick: (key: string) => void;
  onCancel: () => void;
};

/**
 * Pick one of several, where seeing them side by side is the point.
 *
 * `ActionSheet` is the menu — a list of verbs, one of which you run. This is
 * the opposite: the entries are not actions but candidates, they carry a
 * picture as often as a name, and the whole reason the sheet exists is that
 * they are compared against each other before one is taken.
 *
 * It is used twice in the same flow and deliberately looks the same both
 * times: three sentences to choose an association, then three pictures of the
 * chosen one. The second step passes the same label with three different
 * files, so the sentence stays put while the drawings change under it — which
 * is exactly the comparison being made.
 *
 * Cancelling is a real answer here, not an escape hatch, so it is the same
 * "Anuluj" the menus use and it leaves the field untouched.
 */
export function ChoiceSheet({
  visible,
  title,
  subtitle,
  choices,
  onPick,
  onCancel,
}: ChoiceSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
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
              <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
                {subtitle}
              </ThemedText>
            ) : null}
          </View>

          {/* Side by side, because the comparison is the whole task. Stacked
              vertically these read as a menu of commands — one after another,
              each considered on its own — and the pictures scroll apart before
              the third is visible. In a row the eye does the work in one
              glance, which is what picking between three variants of the same
              thing actually is. */}
          <View style={styles.row}>
            {choices.map((choice, index) => {
              const uri = choice.fileName ? mediaUri('mnemonic', choice.fileName) : null;

              return (
                <Pressable
                  key={choice.key}
                  onPress={() => onPick(choice.key)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    choice.label
                      ? `Wybierz ${index + 1} z ${choices.length}: ${choice.label}`
                      : `Wybierz ${index + 1} z ${choices.length}`
                  }
                  style={({ pressed }) => [
                    styles.choice,
                    {
                      borderColor: theme.border,
                      backgroundColor: pressed ? theme.backgroundSelected : 'transparent',
                    },
                  ]}>
                  {uri ? (
                    <Image source={{ uri }} style={styles.picture} resizeMode="cover" />
                  ) : null}

                  {choice.label ? (
                    <ThemedText type="small" style={styles.label}>
                      {choice.label}
                    </ThemedText>
                  ) : null}
                </Pressable>
              );
            })}
          </View>

          <Pressable
            onPress={onCancel}
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
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
  },
  subtitle: {
    marginTop: Spacing.half,
  },
  row: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
    alignItems: 'stretch',
  },
  choice: {
    // Equal thirds, and `minWidth: 0` so a long word shrinks the column
    // instead of pushing its neighbours off the screen.
    flex: 1,
    minWidth: 0,
    padding: Spacing.two,
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.medium,
  },
  /**
   * Square because the model draws square, and `cover` rather than `contain`
   * so three thumbnails share a baseline instead of each shrinking to its own
   * letterboxed height — variations of one scene are compared by what is in
   * them, not by their outlines.
   */
  picture: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: Radius.small,
  },
  label: {
    textAlign: 'center',
  },
  cancel: {
    marginTop: Spacing.three,
    marginHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Radius.medium,
    alignItems: 'center',
  },
});
