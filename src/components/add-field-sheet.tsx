import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { SegmentedControl, type Segment } from '@/components/segmented-control';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import type { FieldKind, FieldSide } from '@/db/schema';
import { useTheme } from '@/hooks/use-theme';

const SIDES: Segment<FieldSide>[] = [
  { value: 'front', label: 'Przód' },
  { value: 'back', label: 'Tył' },
];

const KINDS: Segment<FieldKind>[] = [
  { value: 'text', label: 'Tekstowe' },
  { value: 'audio', label: 'Dźwiękowe' },
];

export type AddFieldSheetProps = {
  visible: boolean;
  onClose: () => void;
  onAdd: (choice: { side: FieldSide; kind: FieldKind }) => void;
};

/**
 * The small menu behind the "+" button: which side the new field goes on and
 * what it holds. The kind is decided here and never again — a field is a text
 * box or an audio slot for its whole life, so the editors never have to make
 * sense of a half-converted one.
 */
export function AddFieldSheet({ visible, onClose, onAdd }: AddFieldSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [side, setSide] = useState<FieldSide>('front');
  const [kind, setKind] = useState<FieldKind>('text');

  const add = () => {
    onClose();
    onAdd({ side, kind });
  };

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

          <ThemedText style={styles.title}>Nowe pole</ThemedText>

          <View style={styles.choice}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              Strona karty
            </ThemedText>
            <SegmentedControl
              value={side}
              options={SIDES}
              onChange={setSide}
              accessibilityLabel="Strona nowego pola"
            />
          </View>

          <View style={styles.choice}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              Rodzaj pola
            </ThemedText>
            <SegmentedControl
              value={kind}
              options={KINDS}
              onChange={setKind}
              accessibilityLabel="Rodzaj nowego pola"
            />
            <ThemedText type="small" themeColor="textSecondary">
              {kind === 'audio'
                ? 'Po dodaniu wybierzesz plik dźwiękowy. Rodzaju pola nie da się później zmienić.'
                : 'Zwykłe pole tekstowe. Rodzaju pola nie da się później zmienić.'}
            </ThemedText>
          </View>

          <Button title="Dodaj pole" onPress={add} />
          <Button title="Anuluj" variant="ghost" onPress={onClose} />
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
    paddingHorizontal: Spacing.three,
    gap: Spacing.three,
    borderTopLeftRadius: Radius.large,
    borderTopRightRadius: Radius.large,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
  },
  choice: {
    gap: Spacing.two,
  },
});
