import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { ScrollViewContainer } from 'react-native-reorderable-list';

import { AddFieldSheet } from '@/components/add-field-sheet';
import { Button } from '@/components/button';
import { FieldLayoutList } from '@/components/field-layout-list';
import { Dropdown, type DropdownOption } from '@/components/dropdown';
import { LanguageSheet } from '@/components/language-sheet';
import { OptionPicker, type PickerOption } from '@/components/option-picker';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import {
  createDeck,
  deckMediaFiles,
  deleteDeck,
  getDeck,
  newCardFields,
  newCardLayout,
  stabilitySamples,
  syncDeckSlots,
  updateDeck,
} from '@/db/queries';
import {
  type FieldKind,
  type FieldSide,
  DEFAULT_NEW_CARD_ORDER,
  DEFAULT_NEW_CARD_PLACEMENT,
  DEFAULT_NEW_PER_DAY,
  DEFAULT_PICTURE_QUALITY,
  DEFAULT_REVIEWS_PER_DAY,
  type NewCardOrder,
  type NewCardPlacement,
  type PictureQuality,
} from '@/db/schema';
import { useTheme } from '@/hooks/use-theme';
import {
  dedupeLanguages,
  languageLabel,
  parseLanguage,
  parseLanguages,
} from '@/lib/languages';
import { FIELD_NOUNS } from '@/lib/media';
import {
  DEFAULT_LEARNING_STEPS,
  DEFAULT_MAXIMUM_INTERVAL,
  DEFAULT_RELEARNING_STEPS,
  DEFAULT_RETENTION,
  CUSTOM_INTERVAL,
  formatRetention,
  isValidSteps,
  isPresetInterval,
  MAXIMUM_INTERVAL_LABELS,
  MAXIMUM_INTERVALS,
  NO_INTERVAL_LIMIT,
  parseMaximumInterval,
  parseWeights,
  RETENTIONS,
} from '@/lib/fsrs-options';
import { MIN_SAMPLES, optimizeWeights, RATING_ORDER } from '@/lib/fsrs-optimizer';
import { firstEasyInterval, GRADE_LABELS } from '@/lib/scheduler';
import { studyDayStart } from '@/lib/study-day';
import { deleteMedia } from '@/lib/media-files';
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

/**
 * Which way this deck's generated pictures lean.
 *
 * The labels alone would not carry it — „dokładny" and „szybki" say nothing
 * about five times the wait, and that is the whole trade. The card editor asks
 * the same question with the same words when a field is made, so that changing
 * your mind there is recognisably the same decision.
 */
const QUALITY_OPTIONS: PickerOption<PictureQuality>[] = [
  {
    value: 'accurate',
    label: 'Dokładne',
    hint: 'Rysunek wypełnia kadr. Kilkanaście sekund na obraz.',
  },
  {
    value: 'fast',
    label: 'Szybkie',
    hint: 'Mniejszy rysunek w kadrze. Kilka sekund.',
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

const INTERVAL_OPTIONS: DropdownOption<string>[] = [
  ...MAXIMUM_INTERVALS.map((days) => ({
    value: String(days),
    label: MAXIMUM_INTERVAL_LABELS[days],
  })),
  { value: CUSTOM_INTERVAL, label: 'Własne…' },
];

/**
 * Retention is a number nobody has a feel for, so each choice is labelled with
 * what it actually does: how far out the first "Łatwe" on a new card lands.
 * Measured through the scheduler rather than written down, so it stays true if
 * ts-fsrs changes underneath.
 */
const retentionOptions = (scheduling: {
  maximumInterval: number;
  learningSteps: string;
  relearningSteps: string;
}): DropdownOption<string>[] =>
  RETENTIONS.map((value) => ({
    value: String(value),
    label: `${formatRetention(value)} — pierwsze „Łatwe" za ${firstEasyInterval({
      ...scheduling,
      desiredRetention: value,
    })} dni`,
  }));

/**
 * Expo Router renders this in place of the screen when it throws, keeping the
 * navigator — and the way back — alive. See `src/components/error-screen.tsx`.
 */
export { ErrorScreen as ErrorBoundary } from '@/components/error-screen';

export default function DeckEditorScreen() {
  const theme = useTheme();
  const router = useRouter();

  const { deckId: deckIdParam } = useLocalSearchParams<{ deckId?: string }>();
  const deckId = deckIdParam ? Number(deckIdParam) : null;

  const existing = useMemo(() => (deckId ? getDeck(deckId) : undefined), [deckId]);

  const [name, setName] = useState(existing?.name ?? '');
  const [frontLanguages, setFrontLanguages] = useState(() =>
    parseLanguages(existing?.frontLanguages)
  );
  const [backLanguage, setBackLanguage] = useState<string | null>(() =>
    parseLanguage(existing?.backLanguages)
  );
  /** Which of the two lists the sheet is editing, or null while it is closed. */
  const [languageSheet, setLanguageSheet] = useState<'front' | 'back' | null>(null);
  const [imageQuality, setImageQuality] = useState<PictureQuality>(
    existing?.imageQuality ?? DEFAULT_PICTURE_QUALITY
  );
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
  const [retention, setRetention] = useState(existing?.desiredRetention ?? DEFAULT_RETENTION);
  const [maximumInterval, setMaximumInterval] = useState(
    existing?.maximumInterval ?? DEFAULT_MAXIMUM_INTERVAL
  );

  // Held apart from the number so the field does not vanish mid-typing the
  // moment the digits happen to spell one of the presets.
  const [customInterval, setCustomInterval] = useState(
    existing ? !isPresetInterval(existing.maximumInterval) : false
  );
  const [customDays, setCustomDays] = useState(String(existing?.maximumInterval ?? ''));

  const pickInterval = (value: string) => {
    if (value === CUSTOM_INTERVAL) {
      setCustomInterval(true);
      setCustomDays(String(maximumInterval));
      return;
    }

    setCustomInterval(false);
    setMaximumInterval(Number(value));
  };

  const typedDays = parseMaximumInterval(customDays);
  const savedInterval = customInterval ? (typedDays ?? maximumInterval) : maximumInterval;
  const [learningSteps, setLearningSteps] = useState(
    existing?.learningSteps ?? DEFAULT_LEARNING_STEPS
  );
  const [relearningSteps, setRelearningSteps] = useState(
    existing?.relearningSteps ?? DEFAULT_RELEARNING_STEPS
  );

  // Weights fitted to this deck's own history. Held in state so the button can
  // report what it did without the screen having to be left and reopened.
  const [weights, setWeights] = useState<number[] | null>(
    existing ? parseWeights(existing.fsrsWeights) : null
  );

  /**
   * Fits what the history supports, and says exactly what it could not.
   * A deck too young to learn anything from must hear that, rather than get
   * four confident numbers pulled out of a handful of answers.
   */
  const optimize = () => {
    if (!deckId) return;

    const result = optimizeWeights(
      stabilitySamples(deckId, studyDayStart),
      weights ?? undefined
    );

    if (result.fitted.length === 0) {
      Alert.alert(
        'Za mało historii',
        `Ta talia ma ${result.total} ${result.total === 1 ? 'powtórkę' : 'powtórek'} nadających się do policzenia. Każda ocena potrzebuje ${MIN_SAMPLES}, żeby cokolwiek z niej wyszło.`,
        [{ text: 'OK' }],
        { cancelable: true }
      );
      return;
    }

    setWeights(result.weights);

    const counted = RATING_ORDER.map(
      (rating) => `${GRADE_LABELS[rating]}: ${result.counts[rating]}`
    ).join(', ');

    Alert.alert(
      'Dopasowano',
      `Policzone z ${result.total} powtórek (${counted}). Zmienione oceny: ${result.fitted
        .map((rating) => GRADE_LABELS[rating])
        .join(', ')}. Zapisz talię, żeby to zostało.`,
      [{ text: 'OK' }],
      { cancelable: true }
    );
  };

  const stepsOk =
    isValidSteps(learningSteps) &&
    isValidSteps(relearningSteps) &&
    (!customInterval || typedDays !== null);
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
      mnemonic: null,
      value: '',
      mediaPath: null,
      // A deck slot holds no text yet, so there is nothing to read out loud.
      // Which language a field speaks in is settled on the card, once it has
      // words — see `src/lib/speech.ts`.
      speech: null,
      hideValue: false,
      hideMedia: false,
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
          {rowInfo.label}
        </ThemedText>
      );
    }

    if (row.kind === 'boundary') return null;

    return (
      <View style={styles.slot}>
        <ThemedText type="small" themeColor="textSecondary">
          {row.field === 'text' ? rowInfo.label : `${rowInfo.label} — ${FIELD_NOUNS[row.field]}`}
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

  /**
   * One labelled row of chips: each language picked, removable by tapping it,
   * plus the chip that opens the sheet. The same gesture the card editor gives
   * tags, because it is the same kind of list.
   */
  const renderLanguages = (
    label: string,
    picked: string[],
    setPicked: (next: string[]) => void,
    open: () => void,
    {
      /** Numbered, because on the question side the order is the instruction. */
      ranked = false,
      /**
       * Whether this row holds exactly one language. The chip that opens the
       * sheet then disappears as soon as it is filled: „+ język" beside a
       * language that cannot have a second one promises something the sheet
       * will not do. Removing the chip that is there brings it back.
       */
      single = false,
    }: { ranked?: boolean; single?: boolean } = {}
  ) => (
    <View style={styles.limits}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <View style={styles.languages}>
        {picked.map((language, index) => (
          <Pressable
            key={language}
            onPress={() => setPicked(picked.filter((own) => own !== language))}
            accessibilityRole="button"
            accessibilityLabel={`Usuń język ${languageLabel(language)}`}
            style={({ pressed }) => [
              styles.language,
              {
                borderColor: theme.accent,
                backgroundColor: pressed ? theme.backgroundSelected : 'transparent',
                opacity: pressed ? 0.7 : 1,
              },
            ]}>
            <ThemedText type="small" style={{ color: theme.accent }}>
              {`${ranked ? `${index + 1}. ` : ''}${languageLabel(language)}  ×`}
            </ThemedText>
          </Pressable>
        ))}
        {single && picked.length > 0 ? null : (
          <Pressable
            onPress={open}
            accessibilityRole="button"
            accessibilityLabel={label}
            style={({ pressed }) => [
              styles.language,
              {
                borderColor: theme.border,
                backgroundColor: pressed ? theme.backgroundSelected : 'transparent',
              },
            ]}>
            <ThemedText type="small" themeColor="textSecondary">
              {picked.length > 0 ? '+ język' : single ? '+ język' : '+ języki'}
            </ThemedText>
          </Pressable>
        )}
      </View>
    </View>
  );

  const canSave = name.trim().length > 0 && stepsOk;

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
      scheduling: {
        desiredRetention: retention,
        maximumInterval: savedInterval,
        learningSteps: learningSteps.trim().toLowerCase(),
        relearningSteps: relearningSteps.trim().toLowerCase(),
        weights,
      },
      newCardLayout: placement,
      languages: { front: frontLanguages, back: backLanguage },
      imageQuality,
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
          // The media copies are files, not rows, so the cascade misses them.
          const files = deckMediaFiles(deckId);
          deleteDeck(deckId);
          deleteMedia(files);
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
          <ThemedText type="smallBold">Algorytm powtórek</ThemedText>
        </View>

        <TextField
          label="Nowa karta wraca po"
          value={learningSteps}
          onChangeText={setLearningSteps}
          placeholder={DEFAULT_LEARNING_STEPS}
          autoCapitalize="none"
          autoCorrect={false}
          error={isValidSteps(learningSteps) ? undefined : 'np. 1m 10m — rosnąco, m/h/d'}
        />
        <TextField
          label="Zapomniana karta wraca po"
          value={relearningSteps}
          onChangeText={setRelearningSteps}
          placeholder={DEFAULT_RELEARNING_STEPS}
          autoCapitalize="none"
          autoCorrect={false}
          error={isValidSteps(relearningSteps) ? undefined : 'np. 10m — rosnąco, m/h/d'}
        />

        <Dropdown
          label="Jak często wracają karty"
          value={String(retention)}
          options={retentionOptions({ maximumInterval, learningSteps, relearningSteps })}
          onChange={(value) => setRetention(Number(value))}
        />

        <Dropdown
          label="Karta nie zniknie na dłużej niż"
          value={customInterval ? CUSTOM_INTERVAL : String(maximumInterval)}
          options={INTERVAL_OPTIONS}
          onChange={pickInterval}
        />

        {customInterval ? (
          <TextField
            label="Ile dni"
            value={customDays}
            onChangeText={setCustomDays}
            placeholder="np. 90"
            keyboardType="number-pad"
            error={
              parseMaximumInterval(customDays) === null
                ? `liczba dni, od 1 do ${NO_INTERVAL_LIMIT}`
                : undefined
            }
          />
        ) : null}

        <View style={styles.limits}>
          <ThemedText type="smallBold">
            {weights ? 'Wagi dopasowane do tej talii' : 'Wagi domyślne FSRS'}
          </ThemedText>
        </View>

        {deckId ? (
          <Button title="Optymalizuj" variant="secondary" onPress={optimize} />
        ) : null}

        {weights ? (
          <Button
            title="Wróć do domyślnych"
            variant="ghost"
            onPress={() => setWeights(null)}
          />
        ) : null}

        {/* Ranked, and numbered so that the ranking is visible: the model hunts
            for a sound-alike in the first language and reaches for the second
            only when the first has nothing worth using. */}
        {renderLanguages(
          'Języki pytania — od najlepiej znanego',
          frontLanguages,
          setFrontLanguages,
          () => setLanguageSheet('front'),
          { ranked: true }
        )}

        {/* One, and only one. It decides which voice reads the card and which
            word a sound-alike has to sound like, and both questions have
            exactly one useful answer. */}
        {renderLanguages(
          'Język odpowiedzi',
          backLanguage ? [backLanguage] : [],
          (next) => setBackLanguage(next[0] ?? null),
          () => setLanguageSheet('back'),
          { single: true }
        )}

        {/* Stoi przy językach, bo dotyczy tej samej funkcji: skojarzeń. To
            ustawienie domyślne — edytor karty otwiera się na nim i pozwala
            odejść od niego przy pojedynczym obrazie. */}
        <OptionPicker
          label="Obrazy w skojarzeniach"
          value={imageQuality}
          options={QUALITY_OPTIONS}
          onChange={setImageQuality}
        />

        <View style={styles.limits}>
          <ThemedText type="smallBold">Domyślny układ nowej karty</ThemedText>
        </View>

        <FieldLayoutList
          rows={rows}
          info={info}
          onChange={setRows}
          renderRow={renderRow}
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

      <LanguageSheet
        visible={languageSheet !== null}
        title={languageSheet === 'back' ? 'Język odpowiedzi' : 'Języki pytania'}
        single={languageSheet === 'back'}
        picked={
          languageSheet === 'back' ? (backLanguage ? [backLanguage] : []) : frontLanguages
        }
        onChange={(picked) =>
          languageSheet === 'back'
            ? setBackLanguage(picked[0] ?? null)
            : setFrontLanguages(dedupeLanguages(picked))
        }
        onClose={() => setLanguageSheet(null)}
      />

      <AddFieldSheet
        visible={adding}
        askMode={false}
        onClose={() => setAdding(false)}
        onAdd={addField}
      />

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
  languages: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.two,
  },
  language: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Radius.large,
    borderWidth: StyleSheet.hairlineWidth,
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
