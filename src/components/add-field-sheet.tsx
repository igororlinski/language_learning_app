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
 * A list rather than a row of segments: the labels are Polish phrases, and a
 * row of chips would truncate them on a phone.
 *
 * **"Obraz AI" was removed here on 2026-09-07.** It drew a picture from one of
 * the card's texts, which "Skojarzenie" does as part of doing something much
 * more useful — and once the association could be made without a picture at
 * all, the two were the same field with different amounts of help. The kind
 * still exists in the schema and fields already made with it still work; it is
 * simply not offered any more.
 *
 * The association sits apart and wears the warm background the card's own
 * question and answer wear. It is not one more container for a file: it is the
 * one field that invents its own contents, and the reason this app has a
 * language model at all.
 */
const KINDS: PickerOption<FieldKind>[] = [
  { value: 'text', label: 'Tekst' },
  { value: 'audio', label: 'Dźwięk' },
  { value: 'image', label: 'Obraz' },
  { value: 'video', label: 'Wideo' },
  {
    value: 'mnemonic',
    label: 'Skojarzenie',
    hint: 'Słowo o podobnym brzmieniu do odpowiedzi i obrazek, który łączy je ze znaczeniem.',
    highlight: true,
  },
];

/** What an association is made of — asked as soon as the kind is chosen. */
const MNEMONIC_MODES: PickerOption<'picture' | 'text'>[] = [
  { value: 'picture', label: 'Obraz i skojarzenie' },
  { value: 'text', label: 'Samo skojarzenie' },
];

/**
 * How much of the association the card carries.
 *
 * The model invents both halves at once — the sound-alike word and a sentence
 * putting it together with the meaning — so this costs nothing either way and
 * is switchable later. The sentence explains the link; the word alone is what
 * some people would rather see once they already know the link.
 */
const MNEMONIC_TEXTS: PickerOption<'sentence' | 'word'>[] = [
  { value: 'sentence', label: 'Całe zdanie' },
  { value: 'word', label: 'Sam wyraz' },
];

export type AddFieldSheetProps = {
  visible: boolean;
  onClose: () => void;
  onAdd: (choice: {
    side: FieldSide;
    kind: FieldKind;
    withPicture: boolean;
    asWord: boolean;
  }) => void;
  /**
   * Whether picking the association also asks what it should be made of. The
   * deck editor arranges empty slots for future cards and generates nothing,
   * so there the question would have no answer worth keeping.
   */
  askMode?: boolean;
};

/**
 * The small menu behind the "+" button: which side the new field goes on and
 * what it holds. The kind is decided here and never again — a field is a text
 * box or a slot for one kind of file for its whole life, so the editors never
 * have to make sense of a half-converted one. That includes how it gets filled:
 * "Obraz" takes a file off the phone, "Skojarzenie" writes its own text and
 * draws its own picture out of the card's two texts at once.
 *
 * Picking the association asks two more questions, on a second step of the
 * same sheet: what it is made of, and how much of it the card carries. They
 * come after "Dodaj pole" rather than under the list of kinds because they are
 * not part of choosing a kind — they are the first two decisions about a field
 * that already exists, and a sheet that grows by four rows the moment one of
 * six options is touched is a sheet nobody can predict the size of.
 *
 * The step swaps the sheet's contents rather than opening a second Modal:
 * replacing one Modal with another in the same frame drops the animation on
 * Android, which is the same reason `ActionSheet` grew its `keepOpen`.
 */
export function AddFieldSheet({ visible, onClose, onAdd, askMode = true }: AddFieldSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [side, setSide] = useState<FieldSide>('front');
  const [kind, setKind] = useState<FieldKind>('text');
  const [mode, setMode] = useState<'picture' | 'text'>('picture');
  const [text, setText] = useState<'sentence' | 'word'>('sentence');

  /** Which half of the sheet is showing: the field, or the association's own two questions. */
  const [asking, setAsking] = useState(false);

  const close = () => {
    setAsking(false);
    onClose();
  };

  const add = () => {
    // The association is the one kind with anything left to decide.
    if (askMode && kind === 'mnemonic' && !asking) {
      setAsking(true);
      return;
    }

    close();
    onAdd({ side, kind, withPicture: mode === 'picture', asWord: text === 'word' });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
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

          <ThemedText style={styles.title}>{asking ? 'Skojarzenie' : 'Nowe pole'}</ThemedText>

          {asking ? (
            <>
              <OptionPicker
                label="Co ma powstać"
                value={mode}
                options={MNEMONIC_MODES}
                onChange={setMode}
              />
              <OptionPicker
                label="Skojarzenie jako"
                value={text}
                options={MNEMONIC_TEXTS}
                onChange={setText}
              />

              <Button title="Dodaj pole" onPress={add} />
              <Button title="Wstecz" variant="ghost" onPress={() => setAsking(false)} />
            </>
          ) : (
            <>
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

              <OptionPicker label="Rodzaj pola" value={kind} options={KINDS} onChange={setKind} />

              <Button title={askMode && kind === 'mnemonic' ? 'Dalej' : 'Dodaj pole'} onPress={add} />
              <Button title="Anuluj" variant="ghost" onPress={close} />
            </>
          )}
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
