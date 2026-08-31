import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { Button } from '@/components/button';
import { SegmentedControl, type Segment } from '@/components/segmented-control';
import { ThemedText } from '@/components/themed-text';
import { TextField } from '@/components/text-field';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import {
  createCard,
  deleteCard,
  getCard,
  getCardFields,
  newCardFields,
  updateCard,
  type CardFieldInput,
} from '@/db/queries';
import type { FieldSide } from '@/db/schema';
import { useTheme } from '@/hooks/use-theme';

const SIDE_OPTIONS: Segment<FieldSide>[] = [
  { value: 'front', label: 'Przód' },
  { value: 'back', label: 'Tył' },
];

/** A field as the form holds it; `id` is null until the card is saved. */
type EditableField = CardFieldInput & { key: string };

export default function CardEditorScreen() {
  const theme = useTheme();
  const router = useRouter();

  const { deckId: deckIdParam, cardId: cardIdParam } = useLocalSearchParams<{
    deckId: string;
    cardId?: string;
  }>();
  const cardId = cardIdParam ? Number(cardIdParam) : null;

  const existing = useMemo(() => (cardId ? getCard(cardId) : undefined), [cardId]);

  // An edited card knows its own deck; only a brand new one relies on the param.
  const deckId = existing?.deckId ?? Number(deckIdParam);

  // Fields belong to the card. A new one starts from the deck's template, an
  // existing one from whatever it carries — after that the deck has no say.
  const initialFields = useMemo(
    () => (cardId ? getCardFields(cardId) : newCardFields(deckId)),
    [cardId, deckId]
  );

  const [front, setFront] = useState(existing?.front ?? '');
  const [back, setBack] = useState(existing?.back ?? '');
  const [fields, setFields] = useState<EditableField[]>(() => initialFields.map(toEditable));
  const [savedCount, setSavedCount] = useState(0);

  // Rows added here have no database id yet, so they need a key of their own to
  // stay put while their name is being typed.
  const nextKey = useRef(0);

  const addField = (side: FieldSide) => {
    nextKey.current += 1;
    setFields((current) => [
      ...current,
      { key: `new-${nextKey.current}`, id: null, name: '', side, value: '' },
    ]);
  };

  const patchField = (key: string, patch: Partial<EditableField>) =>
    setFields((current) =>
      current.map((field) => (field.key === key ? { ...field, ...patch } : field))
    );

  const removeField = (key: string) =>
    setFields((current) => current.filter((field) => field.key !== key));

  const fieldsOn = (side: FieldSide) => fields.filter((field) => field.side === side);

  const frontInput = useRef<TextInput>(null);
  const canSave = front.trim().length > 0 && back.trim().length > 0;

  const save = () => {
    if (!canSave) return;

    if (cardId) {
      updateCard(cardId, { front, back, fields });
      router.back();
      return;
    }

    // Fast entry: saving a new card clears the form and keeps the editor open so
    // a whole batch can be typed in one go. Leaving is the header back arrow.
    createCard(deckId, front, back, new Date(), fields);
    setFront('');
    setBack('');
    // The next card in the batch starts from the deck's template again, blank.
    setFields(newCardFields(deckId).map(toEditable));
    setSavedCount((count) => count + 1);
    frontInput.current?.focus();
  };

  const confirmDelete = () => {
    if (!cardId) return;
    Alert.alert('Usunąć kartę?', 'Historia powtórek tej karty też zniknie.', [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Usuń',
        style: 'destructive',
        onPress: () => {
          deleteCard(cardId);
          router.back();
        },
      },
    ], { cancelable: true });
  };

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: theme.background }]}
      behavior="padding"
      automaticOffset>
      <Stack.Screen options={{ title: cardId ? 'Edytuj kartę' : 'Nowa karta' }} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextField
          ref={frontInput}
          label="Przód (pytanie)"
          value={front}
          onChangeText={setFront}
          placeholder="np. to break"
          autoFocus={!cardId}
          multiline
        />
        {fieldsOn('front').map((field) => (
          <FieldBox
            key={field.key}
            field={field}
            onPatch={(patch) => patchField(field.key, patch)}
            onRemove={() => removeField(field.key)}
          />
        ))}

        <TextField
          label="Tył (odpowiedź)"
          value={back}
          onChangeText={setBack}
          placeholder="np. broke / broken — łamać"
          multiline
        />

        {fieldsOn('back').map((field) => (
          <FieldBox
            key={field.key}
            field={field}
            onPatch={(patch) => patchField(field.key, patch)}
            onRemove={() => removeField(field.key)}
          />
        ))}

        <View style={styles.addRow}>
          <Button
            title="Dodaj pole z przodu"
            variant="secondary"
            style={styles.addButton}
            onPress={() => addField('front')}
          />
          <Button
            title="Dodaj pole z tyłu"
            variant="secondary"
            style={styles.addButton}
            onPress={() => addField('back')}
          />
        </View>

        {savedCount > 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            Dodano w tej sesji: {savedCount}
          </ThemedText>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { borderColor: theme.border }]}>
        <Button title="Zapisz" onPress={save} disabled={!canSave} />
        {cardId ? <Button title="Usuń kartę" variant="danger" onPress={confirmDelete} /> : null}
      </View>
    </KeyboardAvoidingView>
  );
}

/** Turns a stored (or templated) field into a row the form can track. */
function toEditable(field: CardFieldInput | { id: number; name: string; side: FieldSide; value: string }): EditableField {
  return {
    key: field.id === null ? `template-${field.name}-${field.side}` : `saved-${field.id}`,
    id: field.id,
    name: field.name,
    side: field.side,
    value: field.value,
  };
}

/** One extra field: its name, which face it belongs to, and its content. */
function FieldBox({
  field,
  onPatch,
  onRemove,
}: {
  field: EditableField;
  onPatch: (patch: Partial<EditableField>) => void;
  onRemove: () => void;
}) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.field,
        { borderColor: theme.border, backgroundColor: theme.backgroundElement },
      ]}>
      <TextField
        label="Nazwa pola"
        value={field.name}
        onChangeText={(name) => onPatch({ name })}
        placeholder="np. Wymowa"
      />
      <TextField
        label="Treść"
        value={field.value}
        onChangeText={(value) => onPatch({ value })}
        placeholder="Można zostawić puste"
        multiline
      />
      <View style={styles.fieldRow}>
        <SegmentedControl
          value={field.side}
          options={SIDE_OPTIONS}
          onChange={(side) => onPatch({ side })}
          accessibilityLabel={`Strona pola ${field.name || 'bez nazwy'}`}
        />
        <Pressable
          onPress={onRemove}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={`Usuń pole ${field.name || 'bez nazwy'}`}>
          <ThemedText type="small" style={{ color: theme.danger }}>
            Usuń pole
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    padding: Spacing.three,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  field: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.large,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  addRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  addButton: {
    flex: 1,
  },
  footer: {
    padding: Spacing.three,
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
});
