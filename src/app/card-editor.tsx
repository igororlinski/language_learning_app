import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { ScrollViewContainer } from 'react-native-reorderable-list';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { AddFieldSheet } from '@/components/add-field-sheet';
import { ChoiceSheet } from '@/components/choice-sheet';
import { NameSheet } from '@/components/name-sheet';
import { CardFaces } from '@/components/card-faces';
import { MediaView } from '@/components/media-view';
import { Button } from '@/components/button';
import { FieldLayoutList } from '@/components/field-layout-list';
import { SpeakerIcon } from '@/components/icons';
import { speechMenu } from '@/components/speech-menu';
import { ThemedText } from '@/components/themed-text';
import { TextField } from '@/components/text-field';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import {
  allTagsQuery,
  cardMediaFiles,
  createCard,
  deleteCard,
  getCard,
  deckLanguages,
  deckPictureQuality,
  getCardFields,
  getCardTagNames,
  newCardFields,
  newCardLayout,
  newCardSpeech,
  setCardTagNames,
  updateCard,
} from '@/db/queries';
import type { FieldKind, FieldSide, PictureQuality } from '@/db/schema';
import { useTheme } from '@/hooks/use-theme';
import { useVoices } from '@/hooks/use-voices';
import {
  FIELD_NOUNS,
  formatBytes,
  isGeneratedKind,
  isMediaKind,
  MEDIA_LIMITS,
  MEDIA_NOUNS,
  MEDIA_NOUNS_GENITIVE,
  type MediaKind,
} from '@/lib/media';
import {
  deleteMedia,
  importMedia,
  MediaTooLargeError,
  pickMedia,
  saveGeneratedImage,
} from '@/lib/media-files';
import * as Speech from 'expo-speech';
import { AiError } from '@/lib/ai-worker';
import { generateImage, generatePicture as pictureFromScene } from '@/lib/ai-image';
import { requestMnemonics } from '@/lib/ai-mnemonic';
import {
  buildScenePrompt,
  mnemonicJson,
  parseMnemonicColumn,
  type Mnemonic,
} from '@/lib/mnemonic';
import { languageByEnglish, languageEnglish, languageLabel } from '@/lib/languages';
import { matchVoice, speechText, speechVoice, type SpeechScope } from '@/lib/speech';
import { dedupeTags, tagName, tagSlug } from '@/lib/tags';
import { cardPieces, sideLines, type BaseKind } from '@/lib/card-layout';
import { draftSignature } from '@/lib/card-draft';
import {
  BOUNDARY,
  buildRows,
  describeRows,
  toPlacement,
  type Row,
  type RowInfo,
} from '@/lib/field-rows';

/**
 * One round of proposals, and what it was asked for.
 *
 * `language` is the one the model was restricted to, or null when it was left
 * to work down the deck's whole ranking. Kept beside the options because the
 * sheet says which round you are looking at — three sound-alikes mean something
 * different when you asked for English than when the model chose English by
 * itself.
 */
type Proposals = { options: Mnemonic[]; language: string | null };

/**
 * What the choice sheet is showing, when it is showing anything.
 *
 * The two steps are one flow but not one state: between them the files do
 * not exist yet, and after them three of them do and two have to go. Keeping
 * them apart is what makes "dismiss" mean the same thing in both places.
 */
type Choosing =
  | {
      step: 'association';
      key: string;
      /**
       * Every round asked for in this run, oldest first, with `at` pointing at
       * the one on screen — a browser history, not a stack.
       *
       * Asking again is cheap and the answer is random, so the round you just
       * threw away may well have been the good one. Going back has to be
       * possible, and going forward again after that, or "regenerate" is a
       * button that quietly destroys work. Asking for a new round from the
       * middle of the history drops what was ahead, exactly as a browser does.
       */
      history: Proposals[];
      at: number;
    }
  | { step: 'picture'; key: string; association: Mnemonic; files: string[] };

const BASE_LABELS: Record<BaseKind, string> = {
  front: 'Pytanie',
  back: 'Odpowiedź',
};

/**
 * Expo Router renders this in place of the screen when it throws, keeping the
 * navigator — and the way back — alive. See `src/components/error-screen.tsx`.
 */
export { ErrorScreen as ErrorBoundary } from '@/components/error-screen';

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

  // Fields belong to the card. A new one starts from the deck's default layout,
  // an existing one from its own — after that the deck has no say.
  const initialRows = useMemo(
    () =>
      cardId && existing
        ? buildRows(existing, getCardFields(cardId))
        : buildRows(newCardLayout(deckId), newCardFields(deckId)),
    [cardId, deckId, existing]
  );

  const [front, setFront] = useState(existing?.front ?? '');
  const [back, setBack] = useState(existing?.back ?? '');

  /**
   * Which language each mandatory field is read out loud in, or null for one
   * that stays silent.
   *
   * Screen state rather than part of the row model, for the same reason the two
   * texts above are: a row carries where a mandatory field sits, never what it
   * holds. `card_fields` keeps its own on the row, because an extra field is a
   * row all the way down.
   */
  const [frontSpeech, setFrontSpeech] = useState<string | null>(
    () => (cardId && existing ? existing.frontSpeech : newCardSpeech(deckId).frontSpeech)
  );
  const [backSpeech, setBackSpeech] = useState<string | null>(
    () => (cardId && existing ? existing.backSpeech : newCardSpeech(deckId).backSpeech)
  );
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [savedCount, setSavedCount] = useState(0);

  // Names, not ids: a tag typed here has no row until the card is saved, so a
  // card that is never saved leaves nothing behind.
  const [cardTags, setCardTags] = useState<string[]>(() =>
    cardId ? getCardTagNames(cardId) : []
  );
  const [taggingOpen, setTaggingOpen] = useState(false);
  const { data: knownTags } = useLiveQuery(allTagsQuery(), []);
  const [adding, setAdding] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Rows added here have no database id yet, so they need a key of their own to
  // stay put while they are being edited.
  const nextKey = useRef(0);

  // Copies imported in this session. Whatever the save does not keep is deleted
  // there, so replacing a file twice does not leave two of them behind. A
  // generated picture is a copy like any other, so an abandoned edit clears it
  // too — which matters more here, because that one was paid for.
  const imported = useRef<{ kind: MediaKind; fileName: string }[]>([]);

  // The row whose picture is being generated, if any. One at a time: the
  // request takes seconds and the free allowance is worth spending on purpose.
  const [generating, setGenerating] = useState<{ key: string; label: string } | null>(null);

  const [choosing, setChoosing] = useState<Choosing | null>(null);

  /** Whether the "regenerate in…" list under the caret is open. */
  const [pickingLanguage, setPickingLanguage] = useState(false);

  /**
   * Which mnemonic fields draw a picture, by row key. Absent means yes: the
   * picture is what most people come here for, and the field that only holds
   * a sentence is the deliberate exception. It lives in the screen rather
   * than in the row because it decides how the next association is *made*,
   * not what the field currently holds — a field with a picture already in
   * it says so by having one.
   */
  const [pictureMode, setPictureMode] = useState<Record<string, boolean>>({});

  /**
   * How this deck draws unless told otherwise — its standing preference, set in
   * the deck editor. Read once, like the languages: it is what the "+" sheet
   * opens on and what a field falls back to.
   */
  const deckQuality = useMemo(() => deckPictureQuality(deckId), [deckId]);

  /**
   * Which mnemonic fields depart from that preference, by row key.
   *
   * The user's call, because the two are worth different things at different
   * moments: a careful picture fills the frame and takes about five times as
   * long. Absent means the deck's answer, so the usual case costs no taps at
   * all and only the exception is a decision.
   *
   * It lives in the screen rather than in the row, and is never written back to
   * the deck, for the same reason `pictureMode` is not stored: it decides how
   * the *next* picture is made, not what the field is holding now. "Quickly,
   * just this once" must not become tomorrow's default.
   */
  const [drawQuality, setDrawQuality] = useState<Record<string, PictureQuality>>({});

  const qualityOf = (key: string): PictureQuality => drawQuality[key] ?? deckQuality;

  /**
   * What the open options sheet offers and what it calls itself, or null when it
   * is closed.
   *
   * Built when the gear is pressed rather than on every render: the entries
   * close over the generating flow, which touches the list of files imported
   * this session, and that is a ref — reading it while rendering is exactly
   * what React tells you not to do.
   *
   * The heading travels with the entries because the same sheet is now opened
   * by every text field on the card, not just an association — and one that
   * says „Skojarzenie" over the question's options would simply be wrong.
   */
  const [options, setOptions] = useState<{ title: string; actions: SheetAction[] } | null>(null);

  const withPicture = (key: string) => pictureMode[key] ?? true;

  /**
   * Which mnemonic fields show the sound-alike word alone rather than the whole
   * sentence, by row key. Set when the field is made and switchable afterwards.
   *
   * A field already holding something answers for itself: what it shows *is*
   * the setting, so a card opened from the database needs no remembered state
   * to know which way round it is.
   */
  const [wordModes, setWordModes] = useState<Record<string, boolean>>({});

  const showsWord = (key: string, row?: Row): boolean => {
    if (key in wordModes) return wordModes[key];

    const stored = row?.kind === 'extra' ? parseMnemonicColumn(row.mnemonic) : null;

    return Boolean(stored?.sentence) && row?.kind === 'extra' && row.value.trim() === stored?.keyword;
  };

  /**
   * What this deck says its questions and answers are written in. Read once:
   * it is what makes a sound-alike possible at all — the keyword has to be a
   * word in the language the learner already speaks, and no model can tell
   * which that is by looking at two words.
   */
  const languages = useMemo(() => deckLanguages(deckId), [deckId]);

  /**
   * Which voice a speech field reads in — the deck's answer language, because
   * the answer is the word being learned. Null when the deck declares none, and
   * the field says so rather than letting the phone read Portuguese in Polish.
   */
  const voice = useMemo(() => speechVoice(languages), [languages]);

  /**
   * Whether this phone can say anything in that language. Checked here and not
   * on the card: this is where a speech field is made, and a field that will be
   * silent is worth knowing about before it is saved onto fifty cards.
   */
  const voices = useVoices();
  const voiceMatch = useMemo(() => matchVoice(voice, voices), [voice, voices]);

  /** Says a piece of the card out loud, exactly as the card itself will. */
  const readOut = (text: string, language: string | null) => {
    // Stopping first makes a second tap mean "say it again" rather than "queue
    // it up", which is what anybody drilling a word wants.
    Speech.stop();
    Speech.speak(speechText(text, ''), language ? { language } : undefined);
  };

  /**
   * What is wrong with a voice, in one line, or nothing when it is fine.
   *
   * Said here and not on the card: this is where a field is given a voice, and
   * a field that will come out silent — or in a Brazilian accent where the deck
   * asked for a European one — is worth knowing about before it is saved onto
   * fifty cards. The review screen stays quiet; it has nobody to teach.
   */
  const voiceProblem = (code: string): string | null => {
    const match = matchVoice(code, voices);

    if (match.status === 'missing') {
      return `Telefon nie ma głosu dla ${languageLabel(code)}. Doinstaluj go w ustawieniach Androida (Zamiana tekstu na mowę).`;
    }

    if (match.status === 'variant') {
      return `Telefon ma tylko ${languageLabel(match.tag ?? '')} — przeczyta, ale innym akcentem.`;
    }

    return null;
  };

  /**
   * Giving a piece of text a voice, or taking it away. The rule itself lives in
   * `src/components/speech-menu.ts`, shared with the deck editor: what a card
   * can be set to and what a new card starts as must not be able to disagree.
   */
  const speechActions = (
    scope: SpeechScope,
    current: string | null,
    set: (code: string | null) => void
  ): SheetAction[] => speechMenu({ scope, languages, current, set, show: setOptions });

  /**
   * The language a proposal leaned on, when it is not the first one the deck
   * lists — and an empty string when it is, because naming the obvious is
   * noise. The model answers in English names, so this comes back through the
   * catalogue to be shown in Polish.
   */
  const borrowedFrom = (option: Mnemonic): string => {
    const primary = languages.front[0];

    if (!option.language || !primary) return '';

    const code = languageByEnglish(option.language);

    return !code || code === primary ? '' : languageLabel(code);
  };

  const info = describeRows(rows, BASE_LABELS);

  // The preview runs through the very same functions the session uses, so what
  // it shows is what the card will read like — including the empty fields it
  // leaves out and the order dragging produced.
  const preview = useMemo(() => {
    const { fields, placement } = toPlacement(rows);
    const pieces = cardPieces({ front, back, frontSpeech, backSpeech, ...placement }, fields);

    return { front: sideLines(pieces, 'front'), back: sideLines(pieces, 'back') };
  }, [rows, front, back, frontSpeech, backSpeech]);

  const addField = ({
    side,
    kind,
    withPicture: wantsPicture,
    asWord,
    quality,
  }: {
    side: FieldSide;
    kind: FieldKind;
    withPicture: boolean;
    asWord: boolean;
    quality: PictureQuality;
  }) => {
    nextKey.current += 1;
    const key = `new-${nextKey.current}`;
    const added: Row = {
      key,
      kind: 'extra',
      id: null,
      field: kind,
      value: '',
      mediaPath: null,
      mnemonic: null,
      hideValue: false,
      hideMedia: false,
      speech: null,
    };

    // A field whose content arrives from somewhere else stays on probation
    // until it does — but only while that somewhere else is actually being
    // asked. A text field needs nothing and is real at once.
    if (isMediaKind(kind) && !isGeneratedKind(kind)) unconfirmed.current = key;

    setRows((current) => {
      // A front field goes just above the boundary, a back one to the very end
      // — in both cases where the user would expect it to appear.
      const boundary = current.findIndex((row) => row.key === BOUNDARY);
      return side === 'front'
        ? [...current.slice(0, boundary), added, ...current.slice(boundary)]
        : [...current, added];
    });

    if (kind === 'mnemonic') {
      // Answered in the sheet that made the field, so the run starting below
      // already knows whether it is drawing anything. The gear in the field
      // changes it afterwards.
      setPictureMode((current) => ({ ...current, [key]: wantsPicture }));
      setWordModes((current) => ({ ...current, [key]: asWord }));
      setDrawQuality((current) => ({ ...current, [key]: quality }));

      // Straight into picking, for the same reason the file picker opens by
      // itself: an empty field is not a result, and the choice the user came
      // for is one step further on. It needs both texts to work from, so a
      // field added before the card has any waits for its button instead —
      // which is exactly when that button is disabled anyway.
      if (front.trim() && back.trim()) {
        unconfirmed.current = key;
        void proposeMnemonic(key);
      }
    }

    // An empty media field is useless, so the picker opens straight away — but
    // a generated one has nothing to pick: it waits for the user to say which
    // of the card's two texts the picture should come from.
    if (isMediaKind(kind) && !isGeneratedKind(kind)) void attachMedia(key, kind);
  };

  const patchRow = (key: string, value: string) =>
    setRows((current) =>
      current.map((row) => (row.kind === 'extra' && row.key === key ? { ...row, value } : row))
    );

  /** Gives one extra field a voice, or takes it away. */
  const setRowSpeech = (key: string, speech: string | null) =>
    setRows((current) =>
      current.map((row) => (row.kind === 'extra' && row.key === key ? { ...row, speech } : row))
    );

  const removeRow = (key: string) =>
    setRows((current) => current.filter((row) => row.key !== key));

  /**
   * A field added a moment ago that has nothing in it yet.
   *
   * Adding one of these kinds is not really "add a field" — it is "add a
   * picture", "add an association". The field is only the container the answer
   * arrives in, so backing out of choosing that answer has to leave the card as
   * it was, not leave an empty box the user now has to delete by hand.
   *
   * It holds a key rather than a flag, so only the row that is actually waiting
   * can be withdrawn: cancelling a *replacement* on a field that already has
   * something keeps that something, which is the opposite outcome from the
   * same button.
   */
  const unconfirmed = useRef<string | null>(null);

  /** Takes back a field nothing ever arrived in. */
  const withdrawUnconfirmed = (key: string) => {
    if (unconfirmed.current !== key) return;

    unconfirmed.current = null;
    removeRow(key);
  };

  /**
   * Picks a file and copies it into the app's own directory. The size is checked
   * before the copy, so an oversized file never lands on the device.
   */
  const attachMedia = async (key: string, kind: MediaKind) => {
    try {
      const picked = await pickMedia(kind);

      if (!picked) {
        withdrawUnconfirmed(key);
        return;
      }

      const { fileName, name } = await importMedia(kind, picked);

      unconfirmed.current = null;
      imported.current = [...imported.current, { kind, fileName }];

      setRows((current) =>
        current.map((row) =>
          row.kind === 'extra' && row.key === key
            ? { ...row, value: name, mediaPath: fileName }
            : row
        )
      );
    } catch (error) {
      const message =
        error instanceof MediaTooLargeError
          ? `Ten plik ma ${formatBytes(error.size)}, a limit to ${formatBytes(MEDIA_LIMITS[kind])}.`
          : 'Nie udało się skopiować pliku.';

      Alert.alert(
        `Nie dodano ${MEDIA_NOUNS_GENITIVE[kind]}`,
        message,
        [{ text: 'OK' }],
        { cancelable: true }
      );

      withdrawUnconfirmed(key);
    }
  };

  /**
   * Makes the picture for one field out of one of the card's own texts.
   *
   * The text is read from the **form**, not from the database: the card may
   * never have been saved, and the word just typed is the whole point. What
   * gets stored in the field is that same text — it is the field's label, its
   * search material, and the record of what the picture was made from. The
   * decoration around it (`buildPrompt`) is the same for every card and would
   * only be noise in the database.
   *
   * Pressing this again on a field that already has a picture replaces it. The
   * old file is cleared by the save, through the same rule that clears a
   * replaced attachment — see `save`.
   */
  const generatePicture = async (key: string, kind: MediaKind, source: 'front' | 'back') => {
    const term = source === 'front' ? front : back;

    setGenerating({ key, label: 'Robię obraz…' });

    try {
      const base64 = await generateImage(term);
      const fileName = await saveGeneratedImage(kind, base64);

      imported.current = [...imported.current, { kind, fileName }];

      setRows((current) =>
        current.map((row) =>
          row.kind === 'extra' && row.key === key
            ? { ...row, value: term.trim(), mediaPath: fileName }
            : row
        )
      );
    } catch (error) {
      // Thrown from a handler, where the error boundary cannot reach it, so
      // every failure has to end up in a sentence here — on a phone this alert
      // is the only diagnosis there is.
      const message =
        error instanceof MediaTooLargeError
          ? `Obraz ma ${formatBytes(error.size)}, a limit to ${formatBytes(MEDIA_LIMITS[kind])}.`
          : error instanceof AiError
            ? error.message
            : 'Coś poszło nie tak.';

      Alert.alert('Nie zrobiono obrazu', message, [{ text: 'OK' }], { cancelable: true });
    } finally {
      setGenerating(null);
    }
  };

  /**
   * The keyword method, end to end.
   *
   * The answer is the word being learned and the question is what it means,
   * so a language model is asked for a word in the **question's** language
   * that *sounds* like the answer, plus a scene putting that thing together
   * with the meaning. Portuguese `comer` sounds like Polish `komar`; a
   * mosquito eating is the picture, and "Komar je" is the sentence that
   * survives in the learner's head.
   *
   * Both texts come from the **form**, not the database: the card may never
   * have been saved, and the words just typed are the whole point.
   *
   * It runs as a choice, not as a result. The model is asked for three
   * associations and the user takes one; if the field is set to carry a
   * picture, that one is then drawn three times and the user takes one of
   * those too. Two rounds of picking rather than one because they fail
   * differently: a weak association is a different problem from a good
   * association drawn badly, and merging them into a single "try again" is
   * what made the old two reroll buttons necessary in the first place.
   */
  /**
   * Thrown from a handler, where the error boundary cannot reach it.
   *
   * Declared above everything that calls it: under the React Compiler's rules a
   * value used before its declaration is an error, not a hoisting nicety.
   */
  const failedMnemonic = (error: unknown) => {
    const message =
      error instanceof MediaTooLargeError
        ? `Obraz ma ${formatBytes(error.size)}, a limit to ${formatBytes(MEDIA_LIMITS.mnemonic)}.`
        : error instanceof AiError
          ? error.message
          : 'Coś poszło nie tak.';

    Alert.alert('Nie zrobiono skojarzenia', message, [{ text: 'OK' }], { cancelable: true });
  };

  /**
   * One round of proposals, optionally restricted to a single language the
   * learner has.
   *
   * Restricting is done by sending that language as the whole ranking rather
   * than by a new instruction: the prompt already works down the list it is
   * given, so a list of one is a list it cannot leave. Nothing in the Worker
   * had to learn about this.
   */
  const askForOptions = (language: string | null): Promise<Mnemonic[]> =>
    requestMnemonics({
      term: back,
      // English names, not codes and not the Polish labels: the prompt in the
      // Worker is written in English, and "Portuguese (European)" is worth
      // more to the model than „portugalski" or `pt-PT`.
      termLanguage: languages.back ? languageEnglish(languages.back) : '',
      meaning: front,
      // In the deck's order, which is the learner's ranking of how readily
      // each language comes to mind — the model works down it.
      meaningLanguages: (language ? [language] : languages.front).map(languageEnglish),
    });

  const proposeMnemonic = async (key: string) => {
    try {
      setGenerating({ key, label: 'Szukam skojarzeń…' });

      const options = await askForOptions(null);

      setChoosing({ step: 'association', key, history: [{ options, language: null }], at: 0 });
    } catch (error) {
      failedMnemonic(error);
      withdrawUnconfirmed(key);
    } finally {
      setGenerating(null);
    }
  };

  /**
   * Another round, for the same field, without leaving the sheet.
   *
   * The failure is deliberately quiet about the field: a round that does not
   * arrive leaves the previous one on screen and the user where they were.
   * Withdrawing the field here — as a first, failed run does — would throw away
   * three perfectly good proposals because a fourth did not come.
   */
  const regenerate = async (language: string | null) => {
    if (choosing?.step !== 'association') return;

    const { key } = choosing;

    try {
      setGenerating({ key, label: 'Szukam skojarzeń…' });

      const options = await askForOptions(language);

      setChoosing((current) =>
        current?.step === 'association' && current.key === key
          ? {
              ...current,
              // Whatever was ahead in the history is dropped, the way a browser
              // drops it: the user went back and then chose a different road.
              history: [...current.history.slice(0, current.at + 1), { options, language }],
              at: current.at + 1,
            }
          : current
      );
    } catch (error) {
      failedMnemonic(error);
    } finally {
      setGenerating(null);
    }
  };

  /** Steps through the rounds already asked for; nothing is requested again. */
  const stepHistory = (by: -1 | 1) =>
    setChoosing((current) =>
      current?.step === 'association' &&
      current.at + by >= 0 &&
      current.at + by < current.history.length
        ? { ...current, at: current.at + by }
        : current
    );

  /** The round on screen, when a round is on screen. */
  const round = choosing?.step === 'association' ? choosing.history[choosing.at] : null;

  /**
   * Asking again, and walking back through what was asked before.
   *
   * The arrows come first and the verb after, because the arrows are about what
   * is already here and the verb spends a call. The caret exists only when the
   * deck lists more than one language the learner has: with one, "ask again in
   * Polish" and "ask again" are the same sentence.
   */
  const busyHere = choosing?.step === 'association' && generating?.key === choosing.key;

  const associationToolbar =
    choosing?.step !== 'association' ? null : (
      <View style={styles.regenerate}>
        <View style={styles.rowActions}>
          <Pressable
            onPress={() => stepHistory(-1)}
            disabled={choosing.at === 0 || busyHere}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityState={{ disabled: choosing.at === 0 || busyHere }}
            accessibilityLabel="Poprzednie propozycje">
            <ThemedText
              style={{ color: theme.accent, opacity: choosing.at === 0 || busyHere ? 0.3 : 1 }}>
              ←
            </ThemedText>
          </Pressable>

          <Pressable
            onPress={() => stepHistory(1)}
            disabled={choosing.at >= choosing.history.length - 1 || busyHere}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityState={{
              disabled: choosing.at >= choosing.history.length - 1 || busyHere,
            }}
            accessibilityLabel="Następne propozycje">
            <ThemedText
              style={{
                color: theme.accent,
                opacity: choosing.at >= choosing.history.length - 1 || busyHere ? 0.3 : 1,
              }}>
              →
            </ThemedText>
          </Pressable>

          <Pressable
            onPress={() => {
              setPickingLanguage(false);
              void regenerate(null);
            }}
            disabled={busyHere}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityState={{ disabled: busyHere }}
            accessibilityLabel="Przegeneruj propozycje">
            <ThemedText type="small" style={{ color: theme.accent, opacity: busyHere ? 0.4 : 1 }}>
              {busyHere ? 'Szukam…' : 'Przegeneruj'}
            </ThemedText>
          </Pressable>

          {languages.front.length > 1 ? (
            <Pressable
              onPress={() => setPickingLanguage((open) => !open)}
              disabled={busyHere}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityState={{ expanded: pickingLanguage, disabled: busyHere }}
              accessibilityLabel="Przegeneruj w wybranym języku">
              <ThemedText style={{ color: theme.accent, opacity: busyHere ? 0.4 : 1 }}>
                {pickingLanguage ? '▴' : '▾'}
              </ThemedText>
            </Pressable>
          ) : null}
        </View>

        {/* Pushes the sheet open rather than floating over it — the same
            decision `Dropdown` makes, and for the same reason: a panel laid
            over three cards would cover the very things being compared. */}
        {pickingLanguage ? (
          <View style={styles.regenerateLanguages}>
            {languages.front.map((code) => (
              <Pressable
                key={code}
                onPress={() => {
                  setPickingLanguage(false);
                  void regenerate(code);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Przegeneruj w: ${languageLabel(code)}`}
                style={({ pressed }) => [
                  styles.regenerateLanguage,
                  { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' },
                ]}>
                <ThemedText type="small">{`Przegeneruj w: ${languageLabel(code)}`}</ThemedText>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    );

  /**
   * Three drawings of one association, saved and ready to be compared.
   *
   * They are drawn in parallel because they are independent and the wait is
   * otherwise three times as long. All of them land on disk before any is
   * chosen — the ones that lose are deleted the moment one wins, and deleted
   * just the same when the sheet is dismissed, so a discarded round leaves
   * nothing behind.
   *
   * Each file is written into `imported` the instant it exists rather than
   * once the batch is done, and the round survives a drawing that fails.
   * Those two go together: waiting for all three meant that one refusal left
   * whichever siblings had already been saved on the disk with nothing
   * pointing at them — not the row, not the cleanup that runs when the edit is
   * abandoned, nothing. They were paid for and then leaked.
   */
  const drawMnemonic = async (key: string, association: Mnemonic) => {
    const kind = 'mnemonic' as const;

    try {
      setGenerating({ key, label: 'Rysuję trzy obrazy…' });

      const drawings = await Promise.allSettled(
        [0, 1, 2].map(async () => {
          const base64 = await pictureFromScene(
            buildScenePrompt(association.prompt),
            qualityOf(key)
          );
          const fileName = await saveGeneratedImage(kind, base64);

          imported.current = [...imported.current, { kind, fileName }];

          return fileName;
        })
      );

      const drawn = drawings
        .filter((drawing) => drawing.status === 'fulfilled')
        .map((drawing) => drawing.value);

      // Two pictures beat an error message, for the same reason two
      // associations do (`parseMnemonicList`). Only a round that drew nothing
      // at all has failed, and then the first refusal is what explains it.
      if (drawn.length === 0) {
        const refused = drawings.find((drawing) => drawing.status === 'rejected');

        throw refused ? refused.reason : new AiError('provider');
      }

      setChoosing({ step: 'picture', key, association, files: drawn });
    } catch (error) {
      failedMnemonic(error);
    } finally {
      setGenerating(null);
    }
  };

  /** Writes a finished association into its row. */
  const applyMnemonic = (key: string, association: Mnemonic, fileName: string | null) => {
    const word = showsWord(key);

    unconfirmed.current = null;

    setRows((current) =>
      current.map((item) =>
        item.kind === 'extra' && item.key === key
          ? {
              ...item,
              // Whichever half the learner asked for is the field's value, like
              // every other field's label and search material — it is what they
              // read, on the card and in the list. The other half is not lost:
              // the whole association goes into the column below.
              value: word ? association.keyword : association.sentence,
              mediaPath: fileName,
              mnemonic: mnemonicJson(association),
            }
          : item
      )
    );
  };

  /** Turns one of a field's two halves on or off for the learner. */
  const toggleHidden = (key: string, half: 'value' | 'media') => {
    setRows((current) =>
      current.map((item) =>
        item.kind === 'extra' && item.key === key
          ? half === 'value'
            ? { ...item, hideValue: !item.hideValue }
            : { ...item, hideMedia: !item.hideMedia }
          : item
      )
    );
  };

  /**
   * Throws the picture away for good, unlike hiding it.
   *
   * The scene it was drawn from stays in the row, so "Inne obrazy" can still
   * put one back — what is gone is this particular file, which is the part
   * that cost neurons and the part taking up room on the phone.
   */
  const removePicture = (key: string, fileName: string) => {
    discardDrawings([fileName]);
    setRows((current) =>
      current.map((item) =>
        item.kind === 'extra' && item.key === key ? { ...item, mediaPath: null } : item
      )
    );
    setPictureMode((current) => ({ ...current, [key]: false }));
  };

  /** Throws away drawings nobody picked, on disk and in the undo list. */
  const discardDrawings = (files: string[]) => {
    if (files.length === 0) return;

    deleteMedia(files.map((fileName) => ({ kind: 'mnemonic' as const, fileName })));
    imported.current = imported.current.filter((entry) => !files.includes(entry.fileName));
  };

  const pickAssociation = (index: number) => {
    if (choosing?.step !== 'association') return;

    const { key } = choosing;
    const association = choosing.history[choosing.at]?.options[index];

    if (!association) return;

    setPickingLanguage(false);
    setChoosing(null);

    // A field set to "same associations only" is finished here: the sentence
    // is the whole field, and `mnemonic` is the one kind that shows without a
    // file precisely because its text is worth reading on its own.
    if (withPicture(key)) void drawMnemonic(key, association);
    else applyMnemonic(key, association, null);
  };

  const pickDrawing = (index: number) => {
    if (choosing?.step !== 'picture') return;

    const { key, association, files } = choosing;
    const kept = files[index];

    if (!kept) return;

    setChoosing(null);
    discardDrawings(files.filter((fileName) => fileName !== kept));
    applyMnemonic(key, association, kept);
  };

  /**
   * Dismissing leaves the field exactly as it was.
   *
   * Keeping the association without its picture would be a third outcome
   * nobody asked for, and one the user cannot tell from a failed drawing.
   */
  const cancelChoosing = () => {
    if (!choosing) return;

    if (choosing.step === 'picture') discardDrawings(choosing.files);

    // A field added for this run and never filled goes with it: it was only
    // ever the container for the answer being declined. One that already held
    // something keeps it — dismissing a replacement is not a deletion.
    withdrawUnconfirmed(choosing.key);
    setPickingLanguage(false);
    setChoosing(null);
  };

  /**
   * Everything a mnemonic field can be told to do.
   *
   * Gathered behind the gear rather than standing in the row: making another
   * association and drawing it again are things you reach for occasionally,
   * and as permanent links beside the sentence they competed with the
   * sentence for attention — which is the one thing there worth reading.
   *
   * The mode appears as the state it would move to, so the entry names an
   * outcome rather than describing the current setting.
   */
  const mnemonicOptions = (key: string): SheetAction[] => {
    const row = rows.find((item) => item.kind === 'extra' && item.key === key);

    if (row?.kind !== 'extra') return [];

    const ready = front.trim().length > 0 && back.trim().length > 0;
    const stored = parseMnemonicColumn(row.mnemonic);
    const made = Boolean(row.value.trim() || row.mediaPath);

    return [
      {
        label: made ? 'Inne skojarzenie' : 'Zrób skojarzenie',
        onPress: () => {
          // A card opened from the database has no remembered setting, so what
          // the field shows right now becomes the setting before anything is
          // asked for. Without this, replacing an association on a field that
          // shows the word alone would quietly hand back a sentence.
          setWordModes((current) => ({ ...current, [key]: showsWord(key, row) }));
          void proposeMnemonic(key);
        },
        disabled: !ready,
        hint: ready ? undefined : 'Najpierw wpisz pytanie i odpowiedź.',
      },
      // Redrawing skips the model call, so a good idea badly drawn costs
      // three pictures to fix instead of being replaced by another idea. It is
      // offered without a picture too — that is how a field made as text alone
      // gains one.
      ...(stored
        ? [
            {
              label: row.mediaPath ? 'Inne obrazy' : 'Dorysuj obraz',
              onPress: () => void drawMnemonic(key, { ...stored, sentence: row.value }),
            },
          ]
        : []),
      // Named for the state it would move to, like every other switch here. It
      // decides how the *next* picture is drawn, so it stands whether or not
      // the field already has one — changing your mind about a drawn picture is
      // what "Inne obrazy" is for, and this says what those would be.
      {
        label: qualityOf(key) === 'accurate' ? 'Rysuj szybciej' : 'Rysuj dokładniej',
        onPress: () =>
          setDrawQuality((current) => ({
            ...current,
            [key]: qualityOf(key) === 'accurate' ? 'fast' : 'accurate',
          })),
      },
      // Hiding and removing are different answers to different problems, so
      // they are different entries: one is reversible and keeps the row's
      // content, the other frees the file and cannot be undone.
      // Both halves were invented in the same breath and both are kept, so
      // changing your mind costs a re-read rather than another association.
      ...(stored?.sentence && row.value.trim()
        ? [
            {
              label: showsWord(key, row) ? 'Pokaż całe zdanie' : 'Pokaż sam wyraz',
              onPress: () => {
                const word = !showsWord(key, row);

                setWordModes((current) => ({ ...current, [key]: word }));
                setRows((current) =>
                  current.map((item) =>
                    item.kind === 'extra' && item.key === key
                      ? { ...item, value: word ? stored.keyword : stored.sentence }
                      : item
                  )
                );
              },
            },
          ]
        : []),
      ...(row.value.trim()
        ? [
            {
              label: row.hideValue ? 'Pokaż skojarzenie przy nauce' : 'Schowaj skojarzenie',
              onPress: () => toggleHidden(key, 'value'),
            },
          ]
        : []),
      ...(row.mediaPath
        ? [
            {
              label: row.hideMedia ? 'Pokaż obraz przy nauce' : 'Schowaj obraz',
              onPress: () => toggleHidden(key, 'media'),
            },
            {
              label: 'Usuń obraz',
              onPress: () => removePicture(key, row.mediaPath as string),
              destructive: true,
            },
          ]
        : []),
      // An association is written in one of the learner's own languages, so it
      // asks the same question the card's question does. Worth having: hearing
      // „Komar je kanapkę" said aloud is how you find out the phone will mangle
      // it before fifty cards carry the same mistake.
      ...speechActions('mnemonic', row.speech, (code) => setRowSpeech(key, code)),
    ];
  };

  /**
   * Comparing what the form says now against what it said when it was last
   * saved is what tells an abandoned edit from an untouched form — a flag set
   * by each `onChange` would also fire for typing a letter and deleting it.
   */
  const signature = useMemo(
    () => draftSignature(front, back, rows, cardTags, { front: frontSpeech, back: backSpeech }),
    [back, backSpeech, cardTags, front, frontSpeech, rows]
  );

  const saved = useRef(signature);
  const navigation = useNavigation();

  useEffect(
    () =>
      // The same navigation event the deck screen uses to end its selection: it
      // covers the header arrow, the phone's back button and the swipe alike.
      navigation.addListener('beforeRemove', (event) => {
        if (signature === saved.current) return;

        event.preventDefault();

        Alert.alert(
          'Porzucić zmiany?',
          'Wpisana treść i wybrane pliki przepadną.',
          [
            { text: 'Wróć do edycji', style: 'cancel' },
            {
              text: 'Porzuć',
              style: 'destructive',
              onPress: () => {
                // Files copied here point at no row in the database, so leaving
                // without saving is exactly what makes them rubbish.
                deleteMedia(imported.current);
                imported.current = [];

                navigation.dispatch(event.data.action);
              },
            },
          ],
          { cancelable: true }
        );
      }),
    [navigation, signature]
  );

  const questionInput = useRef<TextInput>(null);
  // Only the question is required: plenty of cards are a prompt with a picture
  // or a recording for an answer, and some are a prompt with nothing at all.
  const canSave = front.trim().length > 0;

  const save = () => {
    if (!canSave) return;

    const { fields, placement } = toPlacement(rows);
    const kept = new Set(fields.map((field) => field.mediaPath).filter(Boolean));

    if (cardId) {
      // The copies live outside the database, so files the card no longer points
      // at have to be cleared by hand — the ones it dropped and the ones
      // imported here and then replaced.
      const before = cardMediaFiles(cardId);
      updateCard(cardId, {
        front,
        back,
        fields,
        layout: placement,
        speech: { frontSpeech, backSpeech },
      });
      setCardTagNames(cardId, cardTags);

      deleteMedia(
        [...before, ...imported.current].filter((file) => !kept.has(file.fileName))
      );

      // Saved, so leaving is not abandoning anything.
      saved.current = signature;
      router.back();
      return;
    }

    deleteMedia(imported.current.filter((file) => !kept.has(file.fileName)));
    imported.current = [];

    // Fast entry: saving a new card clears the form and keeps the editor open so
    // a whole batch can be typed in one go. Leaving is the header back arrow.
    const card = createCard(deckId, front, back, new Date(), fields, placement, {
      frontSpeech,
      backSpeech,
    });
    setCardTagNames(card.id, cardTags);

    setFront('');
    setBack('');
    // Back to the deck's template, exactly as the rows below are.
    //
    // Until the deck could carry voices, this was kept for the batch the way
    // the tags are — there was nowhere else to say "every card here reads its
    // answer aloud". Now there is, and the deck saying it is better in every
    // way: it survives leaving the screen, and it means the two mandatory
    // fields and the empty slots reset together instead of one of them
    // quietly keeping a setting the other had dropped.
    const template = newCardSpeech(deckId);

    setFrontSpeech(template.frontSpeech);
    setBackSpeech(template.backSpeech);
    // The tags stay on for the next card: a batch typed in one go is usually
    // one batch of tags too, and taking them off is one tap.
    // The next card in the batch starts from the deck's default layout again.
    const nextRows = buildRows(newCardLayout(deckId), newCardFields(deckId));
    setRows(nextRows);

    // The form the next card starts from is what "saved" means from here on —
    // it is empty, but the tags kept for the batch would otherwise read as an
    // unsaved edit the moment the back arrow was touched.
    saved.current = draftSignature('', '', nextRows, cardTags, {
      front: template.frontSpeech,
      back: template.backSpeech,
    });

    setSavedCount((count) => count + 1);
    questionInput.current?.focus();
  };

  const confirmDelete = () => {
    if (!cardId) return;
    Alert.alert('Usunąć kartę?', 'Historia powtórek tej karty też zniknie.', [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Usuń',
        style: 'destructive',
        onPress: () => {
          const files = cardMediaFiles(cardId);
          deleteCard(cardId);
          deleteMedia([...files, ...imported.current]);

          // The card is gone; there is nothing left to abandon.
          saved.current = signature;
          router.back();
        },
      },
    ], { cancelable: true });
  };

  /**
   * The strip under a text field: hear it, open its options, and whatever else
   * that particular row can do.
   *
   * Every text on the card gets the same one — the question, the answer, an
   * extra field, an association — because reading aloud is a thing a text
   * *does*, not a kind of field. The loudspeaker appears only once the field
   * has a voice, and it names the language: that is the one place where which
   * language this is has to be visible, and it is a label on a control rather
   * than a sentence explaining a setting.
   */
  const textActions = (
    label: string,
    scope: SpeechScope,
    text: string,
    speech: string | null,
    setSpeech: (code: string | null) => void,
    extra?: ReactNode
  ) => {
    const problem = speech ? voiceProblem(speech) : null;

    return (
      <>
        <View style={styles.rowActions}>
          {speech ? (
            <Pressable
              onPress={() => readOut(text, speech)}
              disabled={!text.trim()}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityState={{ disabled: !text.trim() }}
              accessibilityLabel={`Posłuchaj: ${label}`}
              style={[styles.speakLink, { opacity: text.trim() ? 1 : 0.4 }]}>
              <SpeakerIcon size={13} color={theme.accent} />
              <ThemedText type="small" style={{ color: theme.accent }}>
                {languageLabel(speech)}
              </ThemedText>
            </Pressable>
          ) : null}

          <Pressable
            onPress={() =>
              setOptions({ title: label, actions: speechActions(scope, speech, setSpeech) })
            }
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={`Opcje pola: ${label}`}
            style={({ pressed }) => [
              styles.gear,
              {
                borderColor: theme.border,
                backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
              },
            ]}>
            <ThemedText style={[styles.gearGlyph, { color: theme.accent }]}>⚙</ThemedText>
          </Pressable>

          {extra}
        </View>

        {problem ? (
          <ThemedText type="small" themeColor="textSecondary">
            {problem}
          </ThemedText>
        ) : null}
      </>
    );
  };

  /** The one thing an extra field can do that a mandatory one cannot. */
  const removeAction = (label: string, key: string) => (
    <Pressable
      onPress={() => removeRow(key)}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={`Usuń ${label}`}>
      <ThemedText type="small" style={{ color: theme.danger }}>
        Usuń pole
      </ThemedText>
    </Pressable>
  );

  const renderRow = (row: Row, rowInfo: RowInfo) => {
    if (row.kind === 'base') {
      const isQuestion = row.base === 'front';

      return (
        <>
          <TextField
            ref={isQuestion ? questionInput : undefined}
            label={rowInfo.label}
            value={isQuestion ? front : back}
            onChangeText={isQuestion ? setFront : setBack}
            placeholder={isQuestion ? 'np. to break' : 'np. broke / broken — łamać'}
            autoFocus={isQuestion && !cardId}
            style={styles.input}
            multiline
          />
          {/* The question and the answer are different questions about
              language, and the deck answers them differently: the answer is the
              one word being learned, the question is whichever of the learner's
              own languages this deck is written in. */}
          {textActions(
            rowInfo.label,
            isQuestion ? 'question' : 'answer',
            isQuestion ? front : back,
            isQuestion ? frontSpeech : backSpeech,
            isQuestion ? setFrontSpeech : setBackSpeech
          )}
        </>
      );
    }

    if (row.kind === 'boundary') return null;

    if (row.field === 'mnemonic') {
      const busy = generating?.key === row.key;
      const ready = front.trim().length > 0 && back.trim().length > 0;
      const made = Boolean(row.value.trim() || row.mediaPath);

      // A run is under way whether the model is working or the user is picking
      // from what it sent. The row sits behind the choice sheet the whole time,
      // and an invitation to start over showing through it — for the very run
      // being decided — reads as if nothing had happened yet.
      const running = busy || choosing?.key === row.key;
      const problem = row.speech ? voiceProblem(row.speech) : null;

      return (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary">
            {`${rowInfo.label} — ${MEDIA_NOUNS.mnemonic}`}
          </ThemedText>

          {/* Hidden halves stay visible here and say so. The editor is where
              you decide what a card shows, so it has to show what the card is
              made of — dimmed and labelled, rather than gone, which would be
              indistinguishable from having deleted it. */}
          {row.mediaPath ? (
            <View style={row.hideMedia ? styles.hidden : null}>
              <MediaView kind="mnemonic" fileName={row.mediaPath} />
            </View>
          ) : null}

          {row.mediaPath && row.hideMedia ? (
            <ThemedText type="small" themeColor="textSecondary">
              Obraz schowany przy nauce
            </ThemedText>
          ) : null}

          {/* The sentence is the association. It shows here as it will show
              on the card, because judging it is the whole point. */}
          {row.value.trim() ? (
            <ThemedText style={row.hideValue ? styles.hidden : null}>{row.value}</ThemedText>
          ) : null}

          {row.value.trim() && row.hideValue ? (
            <ThemedText type="small" themeColor="textSecondary">
              Skojarzenie schowane przy nauce
            </ThemedText>
          ) : null}

          <View style={styles.rowActions}>
            {/* The same loudspeaker every other spoken text carries, in the
                same place, saying which language it will use. */}
            {row.speech ? (
              <Pressable
                onPress={() => readOut(row.value, row.speech)}
                disabled={!row.value.trim()}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityState={{ disabled: !row.value.trim() }}
                accessibilityLabel={`Posłuchaj: ${rowInfo.label}`}
                style={[styles.speakLink, { opacity: row.value.trim() ? 1 : 0.4 }]}>
                <SpeakerIcon size={13} color={theme.accent} />
                <ThemedText type="small" style={{ color: theme.accent }}>
                  {languageLabel(row.speech)}
                </ThemedText>
              </Pressable>
            ) : null}

            {/* Everything this field can be told to do, behind one control.
                Making it again and drawing it again are rare next to reading
                what came out, and as two standing links they read like part
                of the association itself. */}
            <Pressable
              onPress={() =>
                setOptions({ title: MEDIA_NOUNS.mnemonic, actions: mnemonicOptions(row.key) })
              }
              disabled={busy}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              accessibilityLabel={`Opcje skojarzenia: ${rowInfo.label}`}
              style={({ pressed }) => [
                styles.gear,
                {
                  borderColor: theme.border,
                  backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
                  opacity: busy ? 0.4 : 1,
                },
              ]}>
              <ThemedText style={[styles.gearGlyph, { color: theme.accent }]}>⚙</ThemedText>
            </Pressable>

            {/* Only until there is one, and never during a run. Afterwards
                making another is one of the options, not the thing the field
                is for. */}
            {made || running ? null : (
              <Pressable
                onPress={() => void proposeMnemonic(row.key)}
                disabled={busy || !ready}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityState={{ disabled: busy || !ready }}
                accessibilityLabel={`Zrób skojarzenie: ${rowInfo.label}`}>
                <ThemedText type="small" style={{ color: theme.accent, opacity: ready ? 1 : 0.4 }}>
                  Zrób skojarzenie
                </ThemedText>
              </Pressable>
            )}

            <Pressable
              onPress={() => removeRow(row.key)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={`Usuń ${rowInfo.label}`}>
              <ThemedText type="small" style={{ color: theme.danger }}>
                Usuń pole
              </ThemedText>
            </Pressable>
          </View>

          {problem ? (
            <ThemedText type="small" themeColor="textSecondary">
              {problem}
            </ThemedText>
          ) : null}

          {busy && generating ? (
            <View style={styles.generating}>
              <ActivityIndicator />
              <ThemedText type="small" themeColor="textSecondary">
                {generating.label}
              </ThemedText>
            </View>
          ) : null}
        </>
      );
    }

    if (row.field === 'speech') {
      // What the button will actually say, worked out exactly as the card will
      // work it out — the field's own text, or the answer when it has none.
      const said = speechText(row.value, back);
      const silent = said.length === 0 || voiceMatch.status === 'missing';

      return (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary">
            {`${rowInfo.label} — ${FIELD_NOUNS.speech}${voice ? ` (${languageLabel(voice)})` : ''}`}
          </ThemedText>

          <TextField
            label=""
            value={row.value}
            onChangeText={(text) => patchRow(row.key, text)}
            placeholder="Domyślnie czyta odpowiedź"
            style={styles.input}
            multiline
          />

          <View style={styles.rowActions}>
            {/* Hearing it here is the whole check: a wrong voice or a word the
                engine mangles is obvious in a second and invisible on paper. */}
            <Pressable
              onPress={() => {
                Speech.stop();
                Speech.speak(said, voice ? { language: voice } : undefined);
              }}
              disabled={silent}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityState={{ disabled: silent }}
              accessibilityLabel={`Posłuchaj: ${rowInfo.label}`}>
              <ThemedText type="small" style={{ color: theme.accent, opacity: silent ? 0.4 : 1 }}>
                Posłuchaj
              </ThemedText>
            </Pressable>

            <Pressable
              onPress={() => removeRow(row.key)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={`Usuń ${rowInfo.label}`}>
              <ThemedText type="small" style={{ color: theme.danger }}>
                Usuń pole
              </ThemedText>
            </Pressable>
          </View>

          {/* Everything that stops this field working, said here rather than
              discovered as silence in the middle of a review. Only one line
              shows: the deck's own gap first, then the phone's. */}
          {voice === null ? (
            <ThemedText type="small" themeColor="textSecondary">
              Talia nie ma języka odpowiedzi — telefon przeczyta swoim własnym.
            </ThemedText>
          ) : voiceMatch.status === 'missing' ? (
            <ThemedText type="small" themeColor="textSecondary">
              {`Telefon nie ma głosu dla ${languageLabel(voice)}. Doinstaluj go w ustawieniach Androida (Zamiana tekstu na mowę).`}
            </ThemedText>
          ) : voiceMatch.status === 'variant' ? (
            <ThemedText type="small" themeColor="textSecondary">
              {`Telefon ma tylko ${languageLabel(voiceMatch.tag ?? '')} — przeczyta, ale innym akcentem.`}
            </ThemedText>
          ) : null}
        </>
      );
    }

    if (isGeneratedKind(row.field)) {
      const kind = row.field;
      const busy = generating?.key === row.key;

      return (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary">
            {`${rowInfo.label} — ${MEDIA_NOUNS[kind]}`}
          </ThemedText>
          {row.mediaPath ? (
            <MediaView kind={kind} fileName={row.mediaPath} label={row.value} />
          ) : null}
          <View style={styles.rowActions}>
            {/* Which of the card's two texts the picture comes from is the whole
                choice here, so it is the button rather than a setting. Pressing
                one again replaces the picture. */}
            <Pressable
              onPress={() => void generatePicture(row.key, kind, 'front')}
              disabled={busy || front.trim().length === 0}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy || front.trim().length === 0 }}
              accessibilityLabel={`Zrób obraz z pytania: ${rowInfo.label}`}>
              <ThemedText
                type="small"
                style={{ color: theme.accent, opacity: front.trim() ? 1 : 0.4 }}>
                {row.mediaPath ? 'Znowu z pytania' : 'Z pytania'}
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={() => void generatePicture(row.key, kind, 'back')}
              disabled={busy || back.trim().length === 0}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityState={{ disabled: busy || back.trim().length === 0 }}
              accessibilityLabel={`Zrób obraz z odpowiedzi: ${rowInfo.label}`}>
              <ThemedText
                type="small"
                style={{ color: theme.accent, opacity: back.trim() ? 1 : 0.4 }}>
                {row.mediaPath ? 'Znowu z odpowiedzi' : 'Z odpowiedzi'}
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={() => removeRow(row.key)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={`Usuń ${rowInfo.label}`}>
              <ThemedText type="small" style={{ color: theme.danger }}>
                Usuń pole
              </ThemedText>
            </Pressable>
          </View>
          {busy ? (
            <View style={styles.generating}>
              <ActivityIndicator />
              <ThemedText type="small" themeColor="textSecondary">
                {generating.label}
              </ThemedText>
            </View>
          ) : null}
        </>
      );
    }

    if (isMediaKind(row.field)) {
      const kind = row.field;

      return (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary">
            {`${rowInfo.label} — ${MEDIA_NOUNS[kind]}`}
          </ThemedText>
          {row.mediaPath ? (
            <MediaView kind={kind} fileName={row.mediaPath} label={row.value} />
          ) : null}
          <View style={styles.rowActions}>
            <Pressable
              onPress={() => attachMedia(row.key, kind)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={`${row.mediaPath ? 'Zmień' : 'Wybierz'} plik: ${rowInfo.label}`}>
              <ThemedText type="small" style={{ color: theme.accent }}>
                {row.mediaPath ? 'Zmień plik' : 'Wybierz plik'}
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={() => removeRow(row.key)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={`Usuń ${rowInfo.label}`}>
              <ThemedText type="small" style={{ color: theme.danger }}>
                Usuń pole
              </ThemedText>
            </Pressable>
          </View>
        </>
      );
    }

    return (
      <>
        <TextField
          label={rowInfo.label}
          value={row.value}
          onChangeText={(value) => patchRow(row.key, value)}
          style={styles.input}
          multiline
        />
        {/* An extra field is the one text the deck says nothing about: it is as
            likely to be an example in the language being learned as a note in
            the learner's own, so both sides' languages are on offer. */}
        {textActions(
          rowInfo.label,
          'free',
          row.value,
          row.speech,
          (code) => setRowSpeech(row.key, code),
          removeAction(rowInfo.label, row.key)
        )}
      </>
    );
  };

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: theme.background }]}
      behavior="padding"
      automaticOffset>
      <Stack.Screen options={{ title: cardId ? 'Edytuj kartę' : 'Nowa karta' }} />

      {/* ScrollViewContainer is the scroll parent the nested list needs to drag. */}
      <ScrollViewContainer
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled">
        <View style={styles.tags}>
          {cardTags.map((name) => (
            <Pressable
              key={tagSlug(name)}
              onPress={() => setCardTags((own) => own.filter((tag) => tag !== name))}
              accessibilityRole="button"
              accessibilityLabel={`Zdejmij tag ${name}`}
              style={({ pressed }) => [
                styles.tag,
                {
                  borderColor: theme.accent,
                  backgroundColor: pressed ? theme.backgroundSelected : 'transparent',
                  opacity: pressed ? 0.7 : 1,
                },
              ]}>
              <ThemedText type="small" style={{ color: theme.accent }}>
                {`${name}  ×`}
              </ThemedText>
            </Pressable>
          ))}
          <Pressable
            onPress={() => setTaggingOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Tagi karty"
            style={({ pressed }) => [
              styles.tag,
              {
                borderColor: theme.border,
                backgroundColor: pressed ? theme.backgroundSelected : 'transparent',
              },
            ]}>
            <ThemedText type="small" themeColor="textSecondary">
              {cardTags.length > 0 ? '+ tag' : '+ tagi'}
            </ThemedText>
          </Pressable>
        </View>

        <View
          style={[
            styles.preview,
            { borderColor: theme.border, backgroundColor: theme.backgroundElement },
          ]}>
          <Pressable
            onPress={() => setShowPreview((shown) => !shown)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showPreview }}
            accessibilityLabel="Podgląd karty"
            style={styles.previewHeader}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              PODGLĄD KARTY
            </ThemedText>
            <ThemedText type="small" style={{ color: theme.accent }}>
              {showPreview ? 'Ukryj' : 'Pokaż'}
            </ThemedText>
          </Pressable>

          {showPreview ? (
            <View style={styles.previewCard}>
              <CardFaces
                frontLines={preview.front}
                backLines={preview.back}
                revealed
                compact
                voice={voice}
              />
            </View>
          ) : null}
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

        {savedCount > 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            Dodano w tej sesji: {savedCount}
          </ThemedText>
        ) : null}
      </ScrollViewContainer>

      <View style={[styles.footer, { borderColor: theme.border }]}>
        <Button title="Zapisz" onPress={save} disabled={!canSave} />
        {cardId ? <Button title="Usuń kartę" variant="danger" onPress={confirmDelete} /> : null}
      </View>

      <NameSheet
        visible={taggingOpen}
        title="Tagi karty"
        inputLabel="Nowy tag"
        placeholder="np. czasownik"
        picked={cardTags}
        known={(knownTags ?? []).map((tag) => tag.name)}
        normalize={tagName}
        identity={tagSlug}
        onChange={(picked) => setCardTags(dedupeTags(picked))}
        onClose={() => setTaggingOpen(false)}
      />

      <AddFieldSheet
        visible={adding}
        onClose={() => setAdding(false)}
        onAdd={addField}
        defaultQuality={deckQuality}
      />

      <ActionSheet
        visible={options !== null}
        title={options?.title ?? ''}
        actions={options?.actions ?? []}
        onClose={() => setOptions(null)}
      />

      <ChoiceSheet
        visible={choosing !== null}
        title={choosing?.step === 'picture' ? 'Wybierz obraz' : 'Wybierz skojarzenie'}
        // The sentence is what the three drawings have in common, so it is
        // shown once above them rather than repeated under each. On the
        // association step the same line says which language this round was
        // asked for — but only when it was asked for one, because "the deck's
        // usual order" is not news.
        subtitle={
          choosing?.step === 'picture'
            ? choosing.association.sentence
            : round?.language
              ? `Szukane w: ${languageLabel(round.language)}`
              : undefined
        }
        toolbar={associationToolbar}
        choices={
          choosing?.step === 'association'
            ? (round?.options ?? []).map((option, index) => ({
                key: String(index),
                // What the field will hold, so the choice is between the three
                // things you are choosing between and not their explanations —
                // plus the language, but **only** when the model reached past
                // the first one the deck lists. A keyword from the language you
                // think in needs no label; one borrowed from your second is a
                // different kind of hint and you are entitled to know.
                label: `${showsWord(choosing.key) ? option.keyword : option.sentence}${
                  borrowedFrom(option) ? ` · ${borrowedFrom(option)}` : ''
                }`,
              }))
            : choosing?.step === 'picture'
              ? choosing.files.map((fileName, index) => ({ key: String(index), fileName }))
              : []
        }
        onPick={(key) => {
          const index = Number(key);

          if (choosing?.step === 'association') pickAssociation(index);
          else pickDrawing(index);
        }}
        onCancel={cancelChoosing}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  generating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.two,
  },
  tag: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Radius.large,
    borderWidth: StyleSheet.hairlineWidth,
  },
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
  preview: {
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  previewCard: {
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  input: {
    // Grows with the text instead of always reserving room for four lines.
    minHeight: 44,
    paddingTop: Spacing.two,
  },
  rowActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: Spacing.three,
  },
  /** The icon and the language it will read in, as one link. */
  speakLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  /** The strip under the three candidates: history arrows, then the verb. */
  regenerate: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    gap: Spacing.two,
  },
  regenerateLanguages: {
    gap: Spacing.half,
  },
  regenerateLanguage: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.medium,
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
  /** Dimmed rather than removed: still part of the card, just not shown. */
  hidden: {
    opacity: 0.35,
  },
  /**
   * A control, not a decoration. As a small grey glyph it read as a label and
   * went unseen — and it is now the only way to reach half of what the field
   * can do.
   */
  gear: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gearGlyph: {
    fontSize: 17,
    lineHeight: 21,
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
