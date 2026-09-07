import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { OptionPicker, type PickerOption } from '@/components/option-picker';
import { SegmentedControl, type Segment } from '@/components/segmented-control';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import type { FieldKind, FieldSide } from '@/db/schema';
import { useTheme } from '@/hooks/use-theme';

const SIDES: Segment<FieldSide>[] = [
  { value: 'front', label: 'Przód' },
  { value: 'back', label: 'Tył' },
];

/**
 * A list rather than a row of segments.
 *
 * Five kinds already had to be squeezed — the generated picture was labelled
 * just "AI" to fit across a phone — and the sixth ends that. A stacked picker
 * costs one line per kind and gives back the room to name each one properly,
 * and to say what the two generated kinds actually do, which is the one thing
 * here nobody can guess from a word.
 */
const KINDS: PickerOption<FieldKind>[] = [
  { value: 'text', label: 'Tekst' },
  { value: 'audio', label: 'Dźwięk' },
  { value: 'image', label: 'Obraz' },
  { value: 'video', label: 'Wideo' },
  {
    value: 'ai-image',
    label: 'Obraz AI',
    hint: 'Rysowany z pytania albo z odpowiedzi.',
  },
  {
    value: 'mnemonic',
    label: 'Skojarzenie',
    hint: 'Słowo o podobnym brzmieniu do odpowiedzi i obrazek, który łączy je ze znaczeniem.',
  },
];

export type AddFieldSheetProps = {
  visible: boolean;
  onClose: () => void;
  onAdd: (choice: { side: FieldSide; kind: FieldKind }) => void;
};

/**
 * The small menu behind the "+" button: which side the new field goes on and
 * what it holds. The kind is decided here and never again — a field is a text
 * box or a slot for one kind of file for its whole life, so the editors never
 * have to make sense of a half-converted one. That includes how it gets filled:
 * "Obraz" takes a file off the phone, "Obraz AI" makes one out of one of the
 * card's texts, and "Skojarzenie" makes one out of both at once.
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

          <OptionPicker
            label="Rodzaj pola"
            value={kind}
            options={KINDS}
            onChange={setKind}
          />

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
