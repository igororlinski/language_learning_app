import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { ScrollViewContainer } from 'react-native-reorderable-list';

import { AddFieldSheet } from '@/components/add-field-sheet';
import { Button } from '@/components/button';
import { FieldLayoutList } from '@/components/field-layout-list';
import { OptionPicker, type PickerOption } from '@/components/option-picker';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import {
  createDeck,
  deckAudioPaths,
  deleteDeck,
  getDeck,
  newCardFields,
  newCardLayout,
  syncDeckSlots,
  updateDeck,
} from '@/db/queries';
import {
  type FieldKind,
  type FieldSide,
  DEFAULT_NEW_CARD_ORDER,
  DEFAULT_NEW_CARD_PLACEMENT,
  DEFAULT_NEW_PER_DAY,
  DEFAULT_REVIEWS_PER_DAY,
  type NewCardOrder,
  type NewCardPlacement,
} from '@/db/schema';
import { useTheme } from '@/hooks/use-theme';
import { deleteAudio } from '@/lib/audio-files';
import type { BaseKind } from '@/lib/card-layout';
import {
  BOUNDARY,
  buildRows,
  DEFAULT_PLACEMENT,
  describeRows,
  toPlacement,
  type Row,
  type RowInfo,
} from '@/lib/field-rows';

/** In the deck's template the two mandatory fields have no content yet. */
const BASE_LABELS: Record<BaseKind, string> = {
  front: 'Pytanie',
  back: 'Odpowiedź',
};

const LAYOUT_HINT =
  'Ten sam układ, co w edytorze karty: przeciągnij pole za uchwyt, ' +
  'nad linią „Tył karty” jest przód, pod nią — tył.';

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
  // The deck's default card, arranged in the very same list the card editor
  // uses — only the boxes hold no text, because a template has none.
  const [rows, setRows] = useState<Row[]>(() =>
    deckId
      ? buildRows(newCardLayout(deckId), newCardFields(deckId))
      : buildRows(DEFAULT_PLACEMENT, [])
  );

  const nextKey = useRef(0);
  const [adding, setAdding] = useState(false);
  const info = describeRows(rows, BASE_LABELS);

  const addField = ({ side, kind }: { side: FieldSide; kind: FieldKind }) => {
    nextKey.current += 1;
    const added: Row = {
      key: `new-${nextKey.current}`,
      kind: 'extra',
      id: null,
      field: kind,
      value: '',
      audioPath: null,
    };

    setRows((current) => {
      const boundary = current.findIndex((row) => row.key === BOUNDARY);
      return side === 'front'
        ? [...current.slice(0, boundary), added, ...current.slice(boundary)]
        : [...current, added];
    });
  };

  const removeRow = (key: string) =>
    setRows((current) => current.filter((row) => row.key !== key));

  const renderRow = (row: Row, rowInfo: RowInfo) => {
    if (row.kind === 'base') {
      return (
        <ThemedText type="small" themeColor="textSecondary">
          {`${rowInfo.label} — pole podstawowe, wypełniane przy dodawaniu karty.`}
        </ThemedText>
      );
    }

    if (row.kind === 'boundary') return null;

    return (
      <View style={styles.slot}>
        <ThemedText type="small" themeColor="textSecondary">
          {row.field === 'audio'
            ? `${rowInfo.label} — dźwięk, plik wybierany na karcie.`
            : `${rowInfo.label} — tekst, wypełniany na karcie.`}
        </ThemedText>
        <Pressable
          onPress={() => removeRow(row.key)}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={`Usuń ${rowInfo.label}`}>
          <ThemedText type="small" style={{ color: theme.danger }}>
            Usuń
          </ThemedText>
        </Pressable>
      </View>
    );
  };

  const canSave = name.trim().length > 0;

  const save = () => {
    if (!canSave) return;

    // The template keeps no content, so only the arrangement is worth saving:
    // where the mandatory fields sit and what shape each empty slot has.
    const { fields, placement } = toPlacement(rows);
    const slots = fields.map((field) => ({
      side: field.side,
      position: field.position,
      kind: field.kind,
    }));

    const input = {
      name,
      description,
      newPerDay: toLimit(newPerDay, DEFAULT_NEW_PER_DAY),
      reviewsPerDay: toLimit(reviewsPerDay, DEFAULT_REVIEWS_PER_DAY),
      newCardPlacement,
      newCardOrder,
      newCardLayout: placement,
    };

    if (deckId) {
      updateDeck(deckId, input);
      syncDeckSlots(deckId, slots);
      router.back();
    } else {
      const deck = createDeck(input);
      syncDeckSlots(deck.id, slots);
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
          // The audio copies are files, not rows, so the cascade misses them.
          const paths = deckAudioPaths(deckId);
          deleteDeck(deckId);
          deleteAudio(paths);
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

      <ScrollViewContainer
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled">
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
          <ThemedText type="smallBold">Domyślny układ nowej karty</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Tak będzie wyglądać każda nowa karta w tej talii, zanim cokolwiek
            w niej wpiszesz. To tylko punkt wyjścia: w edytorze karty można
            wszystko poprzestawiać, a zmiany tutaj nie ruszają kart już
            istniejących.
          </ThemedText>
        </View>

        <FieldLayoutList
          rows={rows}
          info={info}
          onChange={setRows}
          renderRow={renderRow}
          hint={LAYOUT_HINT}
        />

        <Pressable
          onPress={() => setAdding(true)}
          accessibilityRole="button"
          accessibilityLabel="Dodaj pole"
          style={({ pressed }) => [
            styles.add,
            { borderColor: theme.border, opacity: pressed ? 0.7 : 1 },
          ]}>
          <ThemedText style={[styles.addGlyph, { color: theme.accent }]}>+</ThemedText>
        </Pressable>
      </ScrollViewContainer>

      <AddFieldSheet visible={adding} onClose={() => setAdding(false)} onAdd={addField} />

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
  content: {
    padding: Spacing.three,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  slot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  add: {
    alignSelf: 'center',
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addGlyph: {
    fontSize: 26,
    lineHeight: 30,
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
