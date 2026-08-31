import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { ScrollViewContainer } from 'react-native-reorderable-list';

import { AddFieldSheet } from '@/components/add-field-sheet';
import { AudioButton } from '@/components/audio-button';
import { Button } from '@/components/button';
import { FieldLayoutList } from '@/components/field-layout-list';
import { ThemedText } from '@/components/themed-text';
import { TextField } from '@/components/text-field';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import {
  cardAudioPaths,
  createCard,
  deleteCard,
  getCard,
  getCardFields,
  newCardFields,
  newCardLayout,
  updateCard,
} from '@/db/queries';
import type { FieldKind, FieldSide } from '@/db/schema';
import { useTheme } from '@/hooks/use-theme';
import { formatBytes, MAX_AUDIO_BYTES } from '@/lib/audio';
import { AudioTooLargeError, deleteAudio, importAudio, pickAudio } from '@/lib/audio-files';
import type { BaseKind } from '@/lib/card-layout';
import {
  BOUNDARY,
  buildRows,
  describeRows,
  toPlacement,
  type Row,
  type RowInfo,
} from '@/lib/field-rows';

const BASE_LABELS: Record<BaseKind, string> = {
  front: 'Pytanie',
  back: 'Odpowiedź',
};

const HINT =
  'Przeciągnij dowolne pole za uchwyt: nad linią „Tył karty” jest przód, ' +
  'pod nią — tył. Strona może zostać pusta.';

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
  const [adding, setAdding] = useState(false);

  // Rows added here have no database id yet, so they need a key of their own to
  // stay put while they are being edited.
  const nextKey = useRef(0);

  // Copies imported in this session. Whatever the save does not keep is deleted
  // there, so replacing a file twice does not leave two of them behind.
  const imported = useRef<string[]>([]);

  const info = describeRows(rows, BASE_LABELS);

  const addField = ({ side, kind }: { side: FieldSide; kind: FieldKind }) => {
    nextKey.current += 1;
    const key = `new-${nextKey.current}`;
    const added: Row = { key, kind: 'extra', id: null, field: kind, value: '', audioPath: null };

    setRows((current) => {
      // A front field goes just above the boundary, a back one to the very end
      // — in both cases where the user would expect it to appear.
      const boundary = current.findIndex((row) => row.key === BOUNDARY);
      return side === 'front'
        ? [...current.slice(0, boundary), added, ...current.slice(boundary)]
        : [...current, added];
    });

    // An empty audio field is useless, so the picker opens straight away.
    if (kind === 'audio') void attachAudio(key);
  };

  const patchRow = (key: string, value: string) =>
    setRows((current) =>
      current.map((row) => (row.kind === 'extra' && row.key === key ? { ...row, value } : row))
    );

  const removeRow = (key: string) =>
    setRows((current) => current.filter((row) => row.key !== key));

  /**
   * Picks an audio file and copies it into the app's own directory. The size is
   * checked before the copy, so an oversized file never lands on the device.
   */
  const attachAudio = async (key: string) => {
    try {
      const picked = await pickAudio();
      if (!picked) return;

      const { fileName, name } = await importAudio(picked);
      imported.current = [...imported.current, fileName];

      setRows((current) =>
        current.map((row) =>
          row.kind === 'extra' && row.key === key
            ? { ...row, field: 'audio', value: name, audioPath: fileName }
            : row
        )
      );
    } catch (error) {
      const message =
        error instanceof AudioTooLargeError
          ? `Ten plik ma ${formatBytes(error.size)}, a limit to ${formatBytes(MAX_AUDIO_BYTES)}.`
          : 'Nie udało się skopiować pliku.';

      Alert.alert('Nie dodano dźwięku', message, [{ text: 'OK' }], { cancelable: true });
    }
  };

  const questionInput = useRef<TextInput>(null);
  const canSave = front.trim().length > 0 && back.trim().length > 0;

  const save = () => {
    if (!canSave) return;

    const { fields, placement } = toPlacement(rows);
    const kept = new Set(fields.map((field) => field.audioPath).filter(Boolean));

    if (cardId) {
      // Audio copies live outside the database, so files the card no longer
      // points at have to be cleared by hand — the ones it dropped and the ones
      // imported here and then replaced.
      const before = cardAudioPaths(cardId);
      updateCard(cardId, { front, back, fields, layout: placement });

      deleteAudio(
        [...before, ...imported.current].filter((path) => !kept.has(path))
      );
      router.back();
      return;
    }

    deleteAudio(imported.current.filter((path) => !kept.has(path)));
    imported.current = [];

    // Fast entry: saving a new card clears the form and keeps the editor open so
    // a whole batch can be typed in one go. Leaving is the header back arrow.
    createCard(deckId, front, back, new Date(), fields, placement);
    setFront('');
    setBack('');
    // The next card in the batch starts from the deck's default layout again.
    setRows(buildRows(newCardLayout(deckId), newCardFields(deckId)));
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
          const paths = cardAudioPaths(cardId);
          deleteCard(cardId);
          deleteAudio(paths);
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
          <ThemedText type="small" themeColor="textSecondary">
            Pole podstawowe — nie da się go usunąć.
          </ThemedText>
        </>
      );
    }

    if (row.kind === 'boundary') return null;

    if (row.field === 'audio') {
      return (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary">
            {`${rowInfo.label} — dźwięk`}
          </ThemedText>
          {row.audioPath ? <AudioButton audioPath={row.audioPath} label={row.value} /> : null}
          <View style={styles.rowActions}>
            <Pressable
              onPress={() => attachAudio(row.key)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={`${row.audioPath ? 'Zmień' : 'Wybierz'} plik: ${rowInfo.label}`}>
              <ThemedText type="small" style={{ color: theme.accent }}>
                {row.audioPath ? 'Zmień plik' : 'Wybierz plik'}
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
          placeholder="Puste pole nie pokaże się przy nauce"
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
        <FieldLayoutList
          rows={rows}
          info={info}
          onChange={setRows}
          renderRow={renderRow}
          hint={HINT}
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

      <AddFieldSheet visible={adding} onClose={() => setAdding(false)} onAdd={addField} />
    </KeyboardAvoidingView>
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
  footer: {
    padding: Spacing.three,
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
});
