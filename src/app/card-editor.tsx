import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  getCardFields,
  getCardTagNames,
  newCardFields,
  newCardLayout,
  setCardTagNames,
  updateCard,
} from '@/db/queries';
import type { FieldKind, FieldSide } from '@/db/schema';
import { useTheme } from '@/hooks/use-theme';
import {
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
import { AiError } from '@/lib/ai-worker';
import { generateImage, generatePicture as pictureFromScene } from '@/lib/ai-image';
import { requestMnemonics } from '@/lib/ai-mnemonic';
import {
  buildScenePrompt,
  mnemonicJson,
  parseMnemonicColumn,
  type Mnemonic,
} from '@/lib/mnemonic';
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
 * What the choice sheet is showing, when it is showing anything.
 *
 * The two steps are one flow but not one state: between them the files do
 * not exist yet, and after them three of them do and two have to go. Keeping
 * them apart is what makes "dismiss" mean the same thing in both places.
 */
type Choosing =
  | { step: 'association'; key: string; options: Mnemonic[] }
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
   * What the open options sheet offers, or null when it is closed.
   *
   * Built when the gear is pressed rather than on every render: the entries
   * close over the generating flow, which touches the list of files imported
   * this session, and that is a ref — reading it while rendering is exactly
   * what React tells you not to do.
   */
  const [options, setOptions] = useState<SheetAction[] | null>(null);

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

  const info = describeRows(rows, BASE_LABELS);

  // The preview runs through the very same functions the session uses, so what
  // it shows is what the card will read like — including the empty fields it
  // leaves out and the order dragging produced.
  const preview = useMemo(() => {
    const { fields, placement } = toPlacement(rows);
    const pieces = cardPieces({ front, back, ...placement }, fields);

    return { front: sideLines(pieces, 'front'), back: sideLines(pieces, 'back') };
  }, [rows, front, back]);

  const addField = ({
    side,
    kind,
    withPicture: wantsPicture,
    asWord,
  }: {
    side: FieldSide;
    kind: FieldKind;
    withPicture: boolean;
    asWord: boolean;
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
    };

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

      // Straight into picking, for the same reason the file picker opens by
      // itself: an empty field is not a result, and the choice the user came
      // for is one step further on. It needs both texts to work from, so a
      // field added before the card has any waits for its button instead —
      // which is exactly when that button is disabled anyway.
      if (front.trim() && back.trim()) void proposeMnemonic(key);
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

  const removeRow = (key: string) =>
    setRows((current) => current.filter((row) => row.key !== key));

  /**
   * Picks a file and copies it into the app's own directory. The size is checked
   * before the copy, so an oversized file never lands on the device.
   */
  const attachMedia = async (key: string, kind: MediaKind) => {
    try {
      const picked = await pickMedia(kind);
      if (!picked) return;

      const { fileName, name } = await importMedia(kind, picked);
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
  const proposeMnemonic = async (key: string) => {
    try {
      setGenerating({ key, label: 'Szukam skojarzeń…' });

      const options = await requestMnemonics({
        term: back,
        termLanguages: languages.back,
        meaning: front,
        meaningLanguages: languages.front,
      });

      setChoosing({ step: 'association', key, options });
    } catch (error) {
      failedMnemonic(error);
    } finally {
      setGenerating(null);
    }
  };

  /**
   * Three drawings of one association, saved and ready to be compared.
   *
   * They are drawn in parallel because they are independent and the wait is
   * otherwise three times as long. All three land on disk before any is
   * chosen — the two that lose are deleted the moment one wins, and deleted
   * just the same when the sheet is dismissed, so a discarded round leaves
   * nothing behind.
   */
  const drawMnemonic = async (key: string, association: Mnemonic) => {
    const kind = 'mnemonic' as const;

    try {
      setGenerating({ key, label: 'Rysuję trzy obrazy…' });

      const drawn = await Promise.all(
        [0, 1, 2].map(async () => {
          const base64 = await pictureFromScene(buildScenePrompt(association.prompt));
          return saveGeneratedImage(kind, base64);
        })
      );

      imported.current = [...imported.current, ...drawn.map((fileName) => ({ kind, fileName }))];

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

    const { key, options } = choosing;
    const association = options[index];

    if (!association) return;

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
    if (choosing?.step === 'picture') discardDrawings(choosing.files);
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
    ];
  };

  /** Thrown from a handler, where the error boundary cannot reach it. */
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
   * Comparing what the form says now against what it said when it was last
   * saved is what tells an abandoned edit from an untouched form — a flag set
   * by each `onChange` would also fire for typing a letter and deleting it.
   */
  const signature = useMemo(
    () => draftSignature(front, back, rows, cardTags),
    [back, cardTags, front, rows]
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
      updateCard(cardId, { front, back, fields, layout: placement });
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
    const card = createCard(deckId, front, back, new Date(), fields, placement);
    setCardTagNames(card.id, cardTags);

    setFront('');
    setBack('');
    // The tags stay on for the next card: a batch typed in one go is usually
    // one batch of tags too, and taking them off is one tap.
    // The next card in the batch starts from the deck's default layout again.
    const nextRows = buildRows(newCardLayout(deckId), newCardFields(deckId));
    setRows(nextRows);

    // The form the next card starts from is what "saved" means from here on —
    // it is empty, but the tags kept for the batch would otherwise read as an
    // unsaved edit the moment the back arrow was touched.
    saved.current = draftSignature('', '', nextRows, cardTags);

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
        </>
      );
    }

    if (row.kind === 'boundary') return null;

    if (row.field === 'mnemonic') {
      const busy = generating?.key === row.key;
      const ready = front.trim().length > 0 && back.trim().length > 0;
      const made = Boolean(row.value.trim() || row.mediaPath);

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
            {/* Everything this field can be told to do, behind one control.
                Making it again and drawing it again are rare next to reading
                what came out, and as two standing links they read like part
                of the association itself. */}
            <Pressable
              onPress={() => setOptions(mnemonicOptions(row.key))}
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

            {/* Only until there is one. Afterwards making another is one of
                the options, not the thing the field is for. */}
            {made ? null : (
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
        <View style={styles.rowActions}>
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

      <AddFieldSheet visible={adding} onClose={() => setAdding(false)} onAdd={addField} />

      <ActionSheet
        visible={options !== null}
        title="Skojarzenie"
        actions={options ?? []}
        onClose={() => setOptions(null)}
      />

      <ChoiceSheet
        visible={choosing !== null}
        title={choosing?.step === 'picture' ? 'Wybierz obraz' : 'Wybierz skojarzenie'}
        // The sentence is what the three drawings have in common, so it is
        // shown once above them rather than repeated under each.
        subtitle={choosing?.step === 'picture' ? choosing.association.sentence : undefined}
        choices={
          choosing?.step === 'association'
            ? choosing.options.map((option, index) => ({
                key: String(index),
                // What the field will hold, so the choice is between the three
                // things you are choosing between and not their explanations.
                label: showsWord(choosing.key) ? option.keyword : option.sentence,
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
    gap: Spacing.three,
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
