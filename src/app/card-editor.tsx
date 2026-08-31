import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import {
  NestedReorderableList,
  ScrollViewContainer,
  reorderItems,
  useIsActive,
  useReorderableDrag,
  type ReorderableListReorderEvent,
} from 'react-native-reorderable-list';

import { Button } from '@/components/button';
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
  type CardLayout,
} from '@/db/queries';
import type { FieldSide } from '@/db/schema';
import { useTheme } from '@/hooks/use-theme';
import type { BaseKind, CardPlacement } from '@/lib/card-layout';

const BOUNDARY = 'boundary';

/**
 * One row of the editor's single list.
 *
 * The two mandatory fields are rows like any other and may go anywhere — the
 * question can end up on the back of the card. What decides a row's side is one
 * synthetic row: everything above `BOUNDARY` is the front, everything below it
 * the back. It is the only row without a drag handle, so it stays put while the
 * rest moves around it, and either side may end up holding nothing at all.
 */
type Row =
  | { key: string; kind: 'base'; base: BaseKind }
  | { key: typeof BOUNDARY; kind: 'boundary' }
  | { key: string; kind: 'extra'; id: number | null; value: string };

/** What a row means once the list order is read top to bottom. */
type RowInfo = { side: FieldSide; label: string };

const BASE_LABELS: Record<BaseKind, string> = {
  front: 'Pytanie',
  back: 'Odpowiedź',
};

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

  // Fields belong to the card. A new one starts from the deck's counters, an
  // existing one from whatever it carries — after that the deck has no say.
  const initialRows = useMemo(
    () =>
      toRows(existing ?? blankPlacement(), cardId ? getCardFields(cardId) : newCardFields(deckId)),
    [cardId, deckId, existing]
  );

  const [front, setFront] = useState(existing?.front ?? '');
  const [back, setBack] = useState(existing?.back ?? '');
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [savedCount, setSavedCount] = useState(0);

  // Rows added here have no database id yet, so they need a key of their own to
  // stay put while they are being edited.
  const nextKey = useRef(0);

  const info = describeRows(rows);

  const addField = (side: FieldSide) => {
    nextKey.current += 1;
    const added: Row = { key: `new-${nextKey.current}`, kind: 'extra', id: null, value: '' };

    setRows((current) => {
      // A front field goes just above the boundary, a back one to the very end
      // — in both cases where the user would expect it to appear.
      const boundary = current.findIndex((row) => row.key === BOUNDARY);
      return side === 'front'
        ? [...current.slice(0, boundary), added, ...current.slice(boundary)]
        : [...current, added];
    });
  };

  const patchRow = (key: string, value: string) =>
    setRows((current) =>
      current.map((row) => (row.kind === 'extra' && row.key === key ? { ...row, value } : row))
    );

  const removeRow = (key: string) =>
    setRows((current) => current.filter((row) => row.key !== key));

  /** Any row may go anywhere; the boundary it ends up on decides its side. */
  const reorder = (event: ReorderableListReorderEvent) =>
    setRows((current) => reorderItems(current, event.from, event.to));

  const questionInput = useRef<TextInput>(null);
  const canSave = front.trim().length > 0 && back.trim().length > 0;

  const save = () => {
    if (!canSave) return;

    const { fields, layout } = toLayout(rows);

    if (cardId) {
      updateCard(cardId, { front, back, fields, layout });
      router.back();
      return;
    }

    // Fast entry: saving a new card clears the form and keeps the editor open so
    // a whole batch can be typed in one go. Leaving is the header back arrow.
    createCard(deckId, front, back, new Date(), fields, layout);
    setFront('');
    setBack('');
    // The next card in the batch starts from the deck's counters again, blank.
    setRows(toRows(blankPlacement(), newCardFields(deckId)));
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
          deleteCard(cardId);
          router.back();
        },
      },
    ], { cancelable: true });
  };

  const renderRow = ({ item }: { item: Row }) => {
    if (item.kind === 'boundary') return <SideBoundary label="Tył karty" />;

    const { label } = info[item.key];

    if (item.kind === 'base') {
      const isQuestion = item.base === 'front';

      return (
        <RowBox label={label}>
          <TextField
            ref={isQuestion ? questionInput : undefined}
            label={label}
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
        </RowBox>
      );
    }

    return (
      <RowBox label={label}>
        <TextField
          label={label}
          value={item.value}
          onChangeText={(value) => patchRow(item.key, value)}
          placeholder="Puste pole nie pokaże się przy nauce"
          style={styles.input}
          multiline
        />
        <Pressable
          onPress={() => removeRow(item.key)}
          hitSlop={12}
          style={styles.remove}
          accessibilityRole="button"
          accessibilityLabel={`Usuń ${label}`}>
          <ThemedText type="small" style={{ color: theme.danger }}>
            Usuń pole
          </ThemedText>
        </Pressable>
      </RowBox>
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
        <NestedReorderableList
          data={rows}
          keyExtractor={(row) => row.key}
          renderItem={renderRow}
          onReorder={reorder}
          ListHeaderComponent={
            <View style={styles.listHeader}>
              <SideBoundary label="Przód karty" />
              <ThemedText type="small" themeColor="textSecondary">
                Przeciągnij dowolne pole za uchwyt: nad linią „Tył karty” jest
                przód, pod nią — tył. Strona może zostać pusta.
              </ThemedText>
            </View>
          }
          contentContainerStyle={styles.list}
          scrollEnabled={false}
        />

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
      </ScrollViewContainer>

      <View style={[styles.footer, { borderColor: theme.border }]}>
        <Button title="Zapisz" onPress={save} disabled={!canSave} />
        {cardId ? <Button title="Usuń kartę" variant="danger" onPress={confirmDelete} /> : null}
      </View>
    </KeyboardAvoidingView>
  );
}

/** The line that splits the list into the card's two faces. */
function SideBoundary({ label }: { label: string }) {
  const theme = useTheme();

  return (
    <View style={styles.boundary}>
      <View style={[styles.boundaryLine, { backgroundColor: theme.border }]} />
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.boundaryLabel}>
        {label.toUpperCase()}
      </ThemedText>
      <View style={[styles.boundaryLine, { backgroundColor: theme.border }]} />
    </View>
  );
}

/** The frame every field row shares: a drag handle on the left, content right. */
function RowBox({ label, children }: { label: string; children: React.ReactNode }) {
  const theme = useTheme();
  const drag = useReorderableDrag();
  const isActive = useIsActive();

  return (
    <View
      style={[
        styles.row,
        {
          borderColor: isActive ? theme.accent : theme.border,
          backgroundColor: theme.backgroundElement,
        },
      ]}>
      <Pressable
        onLongPress={drag}
        delayLongPress={200}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Przesuń: ${label}`}
        accessibilityHint="Przytrzymaj i przeciągnij, żeby zmienić kolejność lub stronę karty"
        style={styles.handle}>
        {[0, 1, 2].map((bar) => (
          <View key={bar} style={[styles.handleBar, { backgroundColor: theme.textSecondary }]} />
        ))}
      </Pressable>

      <View style={styles.rowMain}>{children}</View>
    </View>
  );
}

/** The layout a card starts with before anything has been arranged. */
function blankPlacement(): CardPlacement {
  return {
    front: '',
    back: '',
    frontSide: 'front',
    frontPosition: 0,
    backSide: 'back',
    backPosition: 0,
  };
}

/** Builds the editor's list out of what the card carries. */
function toRows(placement: CardPlacement, fields: CardFieldInput[]): Row[] {
  type Placed = Row & { side: FieldSide; position: number };

  const placed: Placed[] = [
    {
      key: 'base-front',
      kind: 'base',
      base: 'front',
      side: placement.frontSide,
      position: placement.frontPosition,
    },
    {
      key: 'base-back',
      kind: 'base',
      base: 'back',
      side: placement.backSide,
      position: placement.backPosition,
    },
    ...fields.map<Placed>((field, index) => ({
      key: field.id === null ? `blank-${index}` : `saved-${field.id}`,
      kind: 'extra',
      id: field.id,
      value: field.value,
      side: field.side,
      position: field.position,
    })),
  ];

  const onSide = (side: FieldSide): Row[] =>
    placed
      .filter((row) => row.side === side)
      .sort((a, b) => a.position - b.position)
      .map(({ side: _side, position: _position, ...row }) => row);

  return [...onSide('front'), { key: BOUNDARY, kind: 'boundary' }, ...onSide('back')];
}

/**
 * Reads the list top to bottom: everything above the boundary row belongs to
 * the front, everything below it to the back.
 */
function describeRows(rows: Row[]): Record<string, RowInfo> {
  const info: Record<string, RowInfo> = {};
  let side: FieldSide = 'front';
  let extras = { front: 0, back: 0 };

  for (const row of rows) {
    if (row.kind === 'boundary') {
      side = 'back';
      continue;
    }

    if (row.kind === 'base') {
      info[row.key] = { side, label: BASE_LABELS[row.base] };
      continue;
    }

    extras = { ...extras, [side]: extras[side] + 1 };
    info[row.key] = {
      side,
      label: `${side === 'front' ? 'Przód' : 'Tył'} — pole ${extras[side]}`,
    };
  }

  return info;
}

/** Turns the arranged list into what the data layer stores. */
function toLayout(rows: Row[]): { fields: CardFieldInput[]; layout: CardLayout } {
  const fields: CardFieldInput[] = [];
  const layout: CardLayout = {
    frontSide: 'front',
    frontPosition: 0,
    backSide: 'back',
    backPosition: 0,
  };

  let side: FieldSide = 'front';
  const next = { front: 0, back: 0 };

  for (const row of rows) {
    if (row.kind === 'boundary') {
      side = 'back';
      continue;
    }

    const position = side === 'front' ? next.front++ : next.back++;

    if (row.kind === 'base') {
      if (row.base === 'front') {
        layout.frontSide = side;
        layout.frontPosition = position;
      } else {
        layout.backSide = side;
        layout.backPosition = position;
      }
      continue;
    }

    fields.push({ id: row.id, side, position, value: row.value });
  }

  return { fields, layout };
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
  list: {
    gap: Spacing.two,
  },
  listHeader: {
    gap: Spacing.two,
    paddingBottom: Spacing.two,
  },
  boundary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  boundaryLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  boundaryLabel: {
    letterSpacing: 1,
    fontSize: 11,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    padding: Spacing.two,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
  input: {
    // Grows with the text instead of always reserving room for four lines.
    minHeight: 44,
    paddingTop: Spacing.two,
  },
  handle: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.one,
    gap: 3,
    justifyContent: 'center',
  },
  handleBar: {
    width: 16,
    height: 2,
    borderRadius: 1,
  },
  rowMain: {
    flex: 1,
    gap: Spacing.one,
  },
  remove: {
    alignSelf: 'flex-end',
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
