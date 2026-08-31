import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { OptionPicker, type PickerOption } from '@/components/option-picker';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { createDeck, deleteDeck, getDeck, updateDeck } from '@/db/queries';
import {
  DEFAULT_NEW_CARD_ORDER,
  DEFAULT_NEW_CARD_PLACEMENT,
  DEFAULT_NEW_PER_DAY,
  DEFAULT_REVIEWS_PER_DAY,
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
      router.back();
    } else {
      const deck = createDeck(input);
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
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
