import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { Button } from '@/components/button';
import { OptionPicker, type PickerOption } from '@/components/option-picker';
import { SegmentedControl, type Segment } from '@/components/segmented-control';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import {
  createDeck,
  deleteDeck,
  getDeck,
  getDeckFields,
  syncDeckFields,
  updateDeck,
} from '@/db/queries';
import {
  DEFAULT_NEW_CARD_ORDER,
  DEFAULT_NEW_CARD_PLACEMENT,
  DEFAULT_NEW_PER_DAY,
  DEFAULT_REVIEWS_PER_DAY,
  type FieldSide,
  type NewCardOrder,
  type NewCardPlacement,
} from '@/db/schema';
import { useTheme } from '@/hooks/use-theme';

const PLACEMENT_OPTIONS: PickerOption<NewCardPlacement>[] = [
  {
    value: 'mixed',
    label: 'Wymieszane z powtórkami',
    hint: 'Nowe karty rozłożone równomiernie w sesji — domyślnie, jak w Anki.',
  },
  {
    value: 'before',
    label: 'Przed powtórkami',
    hint: 'Najpierw cała nowa partia, potem powtórki.',
  },
  {
    value: 'after',
    label: 'Po powtórkach',
    hint: 'Najpierw zaległe powtórki, nowe karty na koniec.',
  },
];

const SIDE_OPTIONS: Segment<FieldSide>[] = [
  { value: 'front', label: 'Przód' },
  { value: 'back', label: 'Tył' },
];

/** A field as the form holds it: `id` is null until the deck is saved. */
type EditableField = { key: string; id: number | null; name: string; side: FieldSide };

const ORDER_OPTIONS: PickerOption<NewCardOrder>[] = [
  {
    value: 'oldest',
    label: 'Od najdawniej dodanych',
    hint: 'Najstarsze zaległości najpierw — domyślnie, jak w Anki.',
  },
  {
    value: 'newest',
    label: 'Od najnowszych',
    hint: 'Najpierw karty dodane ostatnio.',
  },
  {
    value: 'random',
    label: 'Losowo',
    hint: 'Za każdym razem inna próbka zaległych nowych kart.',
  },
];

export default function DeckEditorScreen() {
  const theme = useTheme();
  const router = useRouter();

  const { deckId: deckIdParam } = useLocalSearchParams<{ deckId?: string }>();
  const deckId = deckIdParam ? Number(deckIdParam) : null;

  const existing = useMemo(() => (deckId ? getDeck(deckId) : undefined), [deckId]);

  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [newPerDay, setNewPerDay] = useState(String(existing?.newPerDay ?? DEFAULT_NEW_PER_DAY));
  const [reviewsPerDay, setReviewsPerDay] = useState(
    String(existing?.reviewsPerDay ?? DEFAULT_REVIEWS_PER_DAY)
  );
  const [newCardPlacement, setNewCardPlacement] = useState<NewCardPlacement>(
    existing?.newCardPlacement ?? DEFAULT_NEW_CARD_PLACEMENT
  );
  const [newCardOrder, setNewCardOrder] = useState<NewCardOrder>(
    existing?.newCardOrder ?? DEFAULT_NEW_CARD_ORDER
  );
  const [fields, setFields] = useState<EditableField[]>(() =>
    (deckId ? getDeckFields(deckId) : []).map((field) => ({
      key: `saved-${field.id}`,
      id: field.id,
      name: field.name,
      side: field.side,
    }))
  );

  // Rows added in this session have no database id yet, so they need a key of
  // their own to stay put while their name is being typed.
  const nextKey = useRef(0);

  const addField = (side: FieldSide) => {
    nextKey.current += 1;
    setFields((current) => [
      ...current,
      { key: `new-${nextKey.current}`, id: null, name: '', side },
    ]);
  };

  const patchField = (key: string, patch: Partial<EditableField>) =>
    setFields((current) =>
      current.map((field) => (field.key === key ? { ...field, ...patch } : field))
    );

  const removeField = (key: string) =>
    setFields((current) => current.filter((field) => field.key !== key));

  const canSave = name.trim().length > 0;

  const save = () => {
    if (!canSave) return;

    const input = {
      name,
      description,
      newPerDay: toLimit(newPerDay, DEFAULT_NEW_PER_DAY),
      reviewsPerDay: toLimit(reviewsPerDay, DEFAULT_REVIEWS_PER_DAY),
      newCardPlacement,
      newCardOrder,
    };

    if (deckId) {
      updateDeck(deckId, input);
      syncDeckFields(deckId, fields);
      router.back();
    } else {
      const deck = createDeck(input);
      syncDeckFields(deck.id, fields);
      router.replace({ pathname: '/deck/[deckId]', params: { deckId: deck.id } });
    }
  };

  const confirmDelete = () => {
    if (!deckId) return;
    Alert.alert('Usunąć talię?', 'Znikną też wszystkie karty i historia powtórek.', [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Usuń',
        style: 'destructive',
        onPress: () => {
          deleteDeck(deckId);
          router.dismissTo('/');
        },
      },
    ], { cancelable: true });
  };

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: theme.background }]}
      behavior="padding"
      automaticOffset>
      <Stack.Screen options={{ title: deckId ? 'Edytuj talię' : 'Nowa talia' }} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextField
          label="Nazwa"
          value={name}
          onChangeText={setName}
          placeholder="np. Angielski — czasowniki nieregularne"
          autoFocus={!deckId}
        />
        <TextField
          label="Opis (opcjonalny)"
          value={description}
          onChangeText={setDescription}
          placeholder="Do czego służy ta talia?"
          multiline
        />

        <View style={styles.limits}>
          <ThemedText type="smallBold">Dzienne limity</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Ile kart talia wypuści w ciągu jednego dnia nauki. Karty w trakcie
            nauki wracają zawsze, niezależnie od limitów. Wpisz 0, żeby wyłączyć
            dany rodzaj. Dzień liczy się od 4:00, jak w Anki.
          </ThemedText>
        </View>

        <TextField
          label="Nowe karty dziennie"
          value={newPerDay}
          onChangeText={setNewPerDay}
          keyboardType="number-pad"
          placeholder={String(DEFAULT_NEW_PER_DAY)}
        />
        <TextField
          label="Maksimum powtórek dziennie"
          value={reviewsPerDay}
          onChangeText={setReviewsPerDay}
          keyboardType="number-pad"
          placeholder={String(DEFAULT_REVIEWS_PER_DAY)}
        />

        <View style={styles.limits}>
          <ThemedText type="smallBold">Kolejka nauki</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Jak sesja układa nowe karty względem powtórek i skąd bierze nowe
            karty, kiedy zaległych jest więcej niż dzienny limit.
          </ThemedText>
        </View>

        <OptionPicker
          label="Nowe karty a powtórki"
          value={newCardPlacement}
          options={PLACEMENT_OPTIONS}
          onChange={setNewCardPlacement}
        />
        <OptionPicker
          label="Kolejność nowych kart"
          value={newCardOrder}
          options={ORDER_OPTIONS}
          onChange={setNewCardOrder}
        />

        <View style={styles.limits}>
          <ThemedText type="smallBold">Domyślne pola nowej karty</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Każda karta ma przód i tył — tych dwóch pól nie da się usunąć. Tutaj
            ustawiasz, jakie dodatkowe rubryki (np. „Wymowa”, „Przykład”) dostaje
            nowo dodawana karta w tej talii. To tylko punkt wyjścia: w edytorze karty
            możesz je zmienić, dodać własne albo usunąć, a zmiany tutaj nie ruszą
            kart już istniejących.
          </ThemedText>
        </View>

        {fields.map((field) => (
          <View
            key={field.key}
            style={[styles.field, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
            <TextField
              label="Nazwa pola"
              value={field.name}
              onChangeText={(name) => patchField(field.key, { name })}
              placeholder="np. Wymowa"
            />
            <View style={styles.fieldRow}>
              <SegmentedControl
                value={field.side}
                options={SIDE_OPTIONS}
                onChange={(side) => patchField(field.key, { side })}
                accessibilityLabel={`Strona pola ${field.name || 'bez nazwy'}`}
              />
              <Pressable
                onPress={() => removeField(field.key)}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={`Usuń pole ${field.name || 'bez nazwy'}`}>
                <ThemedText type="small" style={{ color: theme.danger }}>
                  Usuń pole
                </ThemedText>
              </Pressable>
            </View>
          </View>
        ))}

        <View style={styles.fieldRow}>
          <Button
            title="Dodaj pole z przodu"
            variant="secondary"
            style={styles.addField}
            onPress={() => addField('front')}
          />
          <Button
            title="Dodaj pole z tyłu"
            variant="secondary"
            style={styles.addField}
            onPress={() => addField('back')}
          />
        </View>
      </ScrollView>

      <View style={[styles.footer, { borderColor: theme.border }]}>
        <Button title="Zapisz" onPress={save} disabled={!canSave} />
        {deckId ? <Button title="Usuń talię" variant="danger" onPress={confirmDelete} /> : null}
      </View>
    </KeyboardAvoidingView>
  );
}

/** Blank or nonsense input falls back to the stock value, never silently to zero. */
function toLimit(value: string, fallback: number): number {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  limits: {
    gap: Spacing.one,
    paddingTop: Spacing.two,
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
  addField: {
    flex: 1,
  },
  content: {
    padding: Spacing.three,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
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
