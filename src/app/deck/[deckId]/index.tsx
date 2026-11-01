import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Stack, useLocalSearchParams, usePreventRemove, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { Button } from '@/components/button';
import { DueCounts } from '@/components/due-counts';
import { EmptyState } from '@/components/empty-state';
import { CheckIcon, PlusIcon, SearchIcon } from '@/components/icons';
import { ThemedText } from '@/components/themed-text';
import { useToast } from '@/components/toast';
import { CardStateColors, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import {
  cardsInDeckQuery,
  cardsMediaFiles,
  copyCards,
  deckDueBreakdownQuery,
  deckQuery,
  deckTagsQuery,
  deleteCards,
  moveCards,
  otherDecksQuery,
  resetCards,
  restoreCardStates,
} from '@/db/queries';
import { useNow } from '@/hooks/use-now';
import { useTheme } from '@/hooks/use-theme';
import { deleteMedia, duplicateMedia } from '@/lib/media-files';
import {
  CARD_ORDERS,
  CARD_ORDER_LABELS,
  DEFAULT_CARD_ORDER,
  DEFAULT_DIRECTIONS,
  DIRECTION_LABELS,
  sortCards,
  type CardOrder,
  type SortDirection,
} from '@/lib/card-sort';
import { cardsLabel, formatDate, formatDue } from '@/lib/format';
import { cappedCounts, studyDayStart, totalDue } from '@/lib/limits';
import { filterCards } from '@/lib/search';
import { filterByTags } from '@/lib/tags';
import { cardStage, type CardStage } from '@/lib/stats';

/**
 * What the "⋯" sheet is showing: the things that can be done to the selection,
 * or the list of decks to copy or move it into. One sheet swaps its contents
 * rather than opening a second modal — see `SheetAction.keepOpen`.
 */
type MenuView = 'deck' | 'actions' | 'copy' | 'move' | 'sort';

/** The orders as short as four of them side by side need. */
const SHORT_ORDER_LABELS: Record<CardOrder, string> = {
  created: 'Data',
  alpha: 'A–Z',
  due: 'Termin',
  fields: 'Pola',
  stage: 'Status',
};

const STAGE_LABELS: Record<CardStage, string> = {
  new: 'nowa',
  learning: 'w nauce',
  young: 'młoda',
  mature: 'dojrzała',
};

/** Placeholder while the aggregate is still loading, so the counters never flicker. */
const EMPTY_BREAKDOWN = {
  newCount: 0,
  learningCount: 0,
  reviewCount: 0,
  newDoneToday: 0,
  reviewsDoneToday: 0,
};

/**
 * Expo Router renders this in place of the screen when it throws, keeping the
 * navigator — and the way back — alive. See `src/components/error-screen.tsx`.
 */
export { ErrorScreen as ErrorBoundary } from '@/components/error-screen';

export default function DeckScreen() {
  const theme = useTheme();
  const router = useRouter();
  const now = useNow();
  const toast = useToast();

  const { deckId: deckIdParam } = useLocalSearchParams<{ deckId: string }>();
  const deckId = Number(deckIdParam);

  const { data: deckRows } = useLiveQuery(deckQuery(deckId), [deckId]);
  const { data: cards } = useLiveQuery(cardsInDeckQuery(deckId), [deckId]);
  const { data: otherDecks } = useLiveQuery(otherDecksQuery(deckId), [deckId]);
  const { data: deckTags } = useLiveQuery(deckTagsQuery(deckId), [deckId]);
  const dayStart = studyDayStart(new Date(now)).getTime();
  const { data: dueRows } = useLiveQuery(deckDueBreakdownQuery(deckId, now, dayStart), [
    deckId,
    now,
    dayStart,
  ]);

  const deck = deckRows?.[0];

  // Raw counters come from the query, the caps from the deck row; one helper
  // combines them so this screen shows exactly what the session will serve.
  const raw = dueRows?.[0] ?? EMPTY_BREAKDOWN;
  const counts = cappedCounts({
    ...raw,
    newPerDay: deck?.newPerDay ?? 0,
    reviewsPerDay: deck?.reviewsPerDay ?? 0,
  });
  const due = totalDue(counts);

  // What the daily cap is holding back right now — the difference between the
  // cards that are actually due and the ones the deck is allowed to serve.
  const heldBack = raw.newCount + raw.learningCount + raw.reviewCount - due;

  const [menu, setMenu] = useState<MenuView | null>(null);
  const moveTargets = otherDecks ?? [];
  const [query, setQuery] = useState('');
  const allCards = cards ?? [];
  const searching = query.trim().length > 0;
  // Depends on `cards` (stable from useLiveQuery), not on the `?? []` fallback,
  // which would be a fresh array on every render.
  // Tag ids, not names: the filter compares against what the query glued
  // together per card, and a renamed tag keeps its id.
  const [pickedTags, setPickedTags] = useState<number[]>([]);
  const tagChips = deckTags ?? [];

  const toggleTag = (tagId: number) =>
    setPickedTags((current) =>
      current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId]
    );

  // Whatever is hiding cards right now — the search box, the tag chips, or both.
  const narrowed = searching || pickedTags.length > 0;

  const [order, setOrder] = useState<CardOrder>(DEFAULT_CARD_ORDER);
  const [direction, setDirection] = useState<SortDirection>(DEFAULT_DIRECTIONS[DEFAULT_CARD_ORDER]);
  const visibleCards = useMemo(
    () => sortCards(filterByTags(filterCards(cards ?? [], query), pickedTags), order, direction),
    [cards, direction, order, pickedTags, query]
  );

  // A freshly picked order starts the way round it is usually wanted, and the
  // toggle turns it from there — otherwise choosing "alphabetically" while the
  // list happened to be descending would hand back Z to A.
  const pickOrder = (next: CardOrder) => {
    setOrder(next);
    setDirection(DEFAULT_DIRECTIONS[next]);
  };

  // `null` means the list behaves normally; a set — even an empty one — means
  // the screen is in selection mode, where a tap picks instead of opening.
  // Holding a card is what gets there, the way a photo gallery works.
  const [selected, setSelected] = useState<Set<number> | null>(null);
  const selecting = selected !== null;

  // Taken in list order rather than in the order they were tapped: the preview
  // should read the way the list does.
  const selectedIds = useMemo(
    () => (selected ? (cards ?? []).filter((card) => selected.has(card.id)).map((c) => c.id) : []),
    [cards, selected]
  );

  // Going back drops the selection instead of leaving the deck — one rule for
  // the header arrow, the phone's back button and the back gesture alike, since
  // all three come through here.
  usePreventRemove(selecting, () => setSelected(null));

  const toggle = (cardId: number) =>
    setSelected((current) => {
      const next = new Set(current ?? []);
      if (!next.delete(cardId)) next.add(cardId);
      return next;
    });

  const allVisiblePicked =
    visibleCards.length > 0 && visibleCards.every((card) => selected?.has(card.id));

  /** Applies to what the search is showing, which is what the user can see. */
  const toggleAllVisible = () =>
    setSelected((current) => {
      const next = new Set(current ?? []);
      for (const card of visibleCards) {
        if (allVisiblePicked) next.delete(card.id);
        else next.add(card.id);
      }
      return next;
    });

  /**
   * Everything picked goes at once — all of it or none, files included. Runs
   * once the sheet has closed, so no dialog is opened from inside another.
   */
  const confirmDeleteSelected = () => {
    const ids = selectedIds;
    if (ids.length === 0) return;

    Alert.alert(
      `Usunąć ${cardsLabel(ids.length)}?`,
      'Zaznaczone karty znikną razem z historią powtórek.',
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Usuń',
          style: 'destructive',
          onPress: () => {
            // Read while the rows are still there; the cascade takes the rows,
            // never the files.
            const files = cardsMediaFiles(ids);
            deleteCards(ids);
            deleteMedia(files);
            setSelected(null);
          },
        },
      ],
      { cancelable: true }
    );
  };

  const copySelectedTo = (target: { id: number; name: string }) => {
    const ids = selectedIds;
    if (ids.length === 0) return;

    const made = copyCards(ids, target.id, duplicateMedia);
    setSelected(null);

    // Copying into another deck leaves nothing to see on this screen, so the
    // only sign it worked would otherwise be no sign at all.
    toast({
      message: `Skopiowano ${cardsLabel(made.length)} → „${target.name}”`,
      action: {
        label: 'Cofnij',
        onPress: () => {
          // The copies' own files go with them, as with any deleted card.
          const files = cardsMediaFiles(made);
          deleteCards(made);
          deleteMedia(files);
        },
      },
    });
  };

  /** The card keeps its schedule and history — only the deck changes. */
  const moveSelectedTo = (target: { id: number; name: string }) => {
    const ids = selectedIds;
    if (ids.length === 0) return;

    moveCards(ids, target.id);
    setSelected(null);

    toast({
      message: `Przeniesiono ${cardsLabel(ids.length)} → „${target.name}”`,
      action: { label: 'Cofnij', onPress: () => moveCards(ids, deckId) },
    });
  };

  /**
   * Everything that can be done to what is picked. With exactly one card there
   * is one entry more — editing, which needs a single card to mean anything;
   * the rest only change their wording. Splitting this into a per-card menu and
   * a per-selection menu would be two lists saying the same thing.
   */
  const selectionActions = (): SheetAction[] => {
    const count = selectedIds.length;
    const nothing = count === 0;
    const single = count === 1 ? selectedIds[0] : null;
    const emptyHint = nothing ? 'Najpierw zaznacz karty.' : undefined;

    return [
      {
        label: 'Podgląd zaznaczonych',
        hint: emptyHint,
        disabled: nothing,
        onPress: () =>
          router.push({
            pathname: '/deck/[deckId]/preview',
            params: { deckId, ids: selectedIds.join(',') },
          }),
      },
      ...(single !== null
        ? [
            {
              label: 'Edytuj kartę',
              onPress: () =>
                router.push({ pathname: '/card-editor', params: { deckId, cardId: single } }),
            },
          ]
        : []),
      {
        label: 'Kopiuj do talii',
        hint: emptyHint,
        disabled: nothing,
        // Swaps what this sheet shows instead of opening a second one.
        keepOpen: true,
        onPress: () => setMenu('copy'),
      },
      // Stays on the list even with nowhere to move to, saying why: hiding it
      // made the whole feature look like it did not exist.
      {
        label: 'Przenieś do innej talii',
        disabled: nothing || moveTargets.length === 0,
        hint:
          emptyHint ??
          (moveTargets.length === 0 ? 'Nie masz drugiej talii, więc nie ma dokąd.' : undefined),
        keepOpen: true,
        onPress: () => setMenu('move'),
      },
      {
        label: count === 1 ? 'Zeruj postęp' : 'Zeruj postęp zaznaczonych',
        hint: emptyHint,
        disabled: nothing,
        onPress: () => {
          const replaced = resetCards(selectedIds);
          setSelected(null);

          toast({
            message: `Wyzerowano postęp: ${cardsLabel(replaced.length)}`,
            action: { label: 'Cofnij', onPress: () => restoreCardStates(replaced) },
          });
        },
      },
      {
        label: count === 1 ? 'Usuń kartę' : 'Usuń zaznaczone',
        hint: emptyHint,
        disabled: nothing,
        destructive: true,
        onPress: confirmDeleteSelected,
      },
    ];
  };

  /** The deck itself first: copying in place is how a card becomes a variant. */
  const copyActions = (): SheetAction[] => [
    {
      label: deck ? `${deck.name} (ta talia)` : 'Ta talia',
      onPress: () => copySelectedTo({ id: deckId, name: deck?.name ?? 'ta talia' }),
    },
    ...moveTargets.map((target) => ({
      label: target.name,
      onPress: () => copySelectedTo(target),
    })),
  ];

  const moveActions = (): SheetAction[] =>
    moveTargets.map((target) => ({
      label: target.name,
      onPress: () => moveSelectedTo(target),
    }));

  const deckActions = (): SheetAction[] => [
    {
      label: 'Zaznacz karty',
      disabled: allCards.length === 0,
      hint: allCards.length === 0 ? 'Talia jest pusta.' : undefined,
      onPress: () => setSelected(new Set()),
    },
    {
      label: 'Edytuj talię',
      onPress: () => router.push({ pathname: '/deck-editor', params: { deckId } }),
    },
  ];

  const MENU_TITLES: Record<MenuView, string> = {
    deck: deck?.name ?? 'Talia',
    actions: `Zaznaczono ${selectedIds.length}`,
    copy: 'Kopiuj do talii',
    move: 'Przenieś do talii',
    sort: 'Kolejność kart',
  };

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          title: selecting ? `Zaznaczono ${selectedIds.length}` : (deck?.name ?? 'Talia'),
          headerRight: () =>
            selecting ? (
              <Pressable
                onPress={() => setMenu('actions')}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Co zrobić z zaznaczonymi kartami">
                <ThemedText style={[styles.dots, { color: theme.accent }]}>⋯</ThemedText>
              </Pressable>
            ) : deck ? (
              <Pressable
                onPress={() => setMenu('deck')}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Menu talii">
                <ThemedText style={[styles.dots, { color: theme.accent }]}>⋯</ThemedText>
              </Pressable>
            ) : null,
        }}
      />

      <FlatList
        data={visibleCards}
        keyExtractor={(card) => String(card.id)}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            {deck?.description ? (
              <ThemedText type="small" themeColor="textSecondary">
                {deck.description}
              </ThemedText>
            ) : null}
            <View style={styles.summary}>
              <ThemedText type="smallBold">
                {narrowed
                  ? `${visibleCards.length} z ${cardsLabel(allCards.length)}`
                  : cardsLabel(allCards.length)}
              </ThemedText>
              <DueCounts counts={counts} showLabels />
            </View>
            {heldBack > 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                {`Wstrzymane limitem: ${cardsLabel(heldBack)}`}
              </ThemedText>
            ) : null}

            {allCards.length > 0 ? (
              <View style={styles.tools}>
                <SearchBox value={query} onChange={setQuery} />

                {tagChips.length > 0 || allCards.length > 1 ? (
                  <View style={styles.filters}>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      keyboardShouldPersistTaps="handled"
                      style={styles.tagScroll}
                      contentContainerStyle={styles.tags}>
                      {tagChips.map((tag) => {
                        const picked = pickedTags.includes(tag.id);

                        return (
                          <Pressable
                            key={tag.id}
                            onPress={() => toggleTag(tag.id)}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: picked }}
                            accessibilityLabel={`${tag.name}, ${cardsLabel(tag.cardCount)}`}
                            style={({ pressed }) => [
                              styles.tag,
                              {
                                borderColor: picked ? theme.accent : theme.border,
                                backgroundColor: picked
                                  ? theme.accent
                                  : pressed
                                    ? theme.backgroundSelected
                                    : theme.backgroundElement,
                              },
                            ]}>
                            <ThemedText
                              type="small"
                              style={{ color: picked ? theme.onAccent : theme.text }}>
                              {tag.name}{' '}
                              <ThemedText
                                type="small"
                                style={{ color: picked ? theme.onAccent : theme.textSecondary }}>
                                {tag.cardCount}
                              </ThemedText>
                            </ThemedText>
                          </Pressable>
                        );
                      })}
                    </ScrollView>

                    {allCards.length > 1 ? (
                      <Pressable
                        onPress={() => setMenu('sort')}
                        accessibilityRole="button"
                        accessibilityLabel={`Kolejność: ${CARD_ORDER_LABELS[order]}, ${DIRECTION_LABELS[order][direction]}`}
                        style={({ pressed }) => [
                          styles.sortButton,
                          {
                            borderColor: theme.border,
                            backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
                          },
                        ]}>
                        <ThemedText type="small" numberOfLines={1}>
                          {SHORT_ORDER_LABELS[order]}
                        </ThemedText>
                        <ThemedText type="smallBold" style={{ color: theme.accent }}>
                          {direction === 'asc' ? '↑' : '↓'}
                        </ThemedText>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          narrowed ? (
            <EmptyState title="Nic nie pasuje" />
          ) : (
            <EmptyState
              title="Ta talia jest pusta"
              hint="Dodaj pierwszą fiszkę — przód to pytanie, tył to odpowiedź."
            />
          )
        }
        renderItem={({ item }) => {
          const picked = Boolean(selected?.has(item.id));
          const stage = cardStage(item.state, item.scheduledDays);
          // One fact on the right, the one the list is sorted by: the date
          // for "Data dodania", the status for "Status", when it comes back
          // for everything else.
          const fact =
            order === 'created'
              ? formatDate(item.createdAt, new Date(now))
              : order === 'stage' || stage === 'new'
                ? STAGE_LABELS[stage]
                : formatDue(item.due, now);

          return (
            <Pressable
              onPress={() =>
                selecting
                  ? toggle(item.id)
                  : router.push({ pathname: '/card-editor', params: { deckId, cardId: item.id } })
              }
              // Holding a card is how selection starts, with that card already
              // picked; from then on a plain tap is enough for the rest.
              onLongPress={() => (selecting ? toggle(item.id) : setSelected(new Set([item.id])))}
              accessibilityRole={selecting ? 'checkbox' : 'button'}
              accessibilityState={selecting ? { checked: picked } : undefined}
              accessibilityLabel={`${item.front}, ${STAGE_LABELS[stage]}, ${fact}`}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: picked ? theme.backgroundSelected : theme.backgroundElement,
                  borderColor: picked ? theme.accent : theme.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}>
              {selecting ? (
                <View
                  style={[
                    styles.tick,
                    {
                      borderColor: picked ? theme.accent : theme.border,
                      backgroundColor: picked ? theme.accent : 'transparent',
                    },
                  ]}>
                  {picked ? <CheckIcon size={14} color={theme.onAccent} /> : null}
                </View>
              ) : null}

              {/* Where the card is on its way, in the colours of "Statystyki". */}
              <View style={[styles.stripe, { backgroundColor: CardStateColors[stage] }]} />

              {/* The question only. The list is for finding a card, and the
                  answer is the one thing worth not being reminded of. */}
              <ThemedText numberOfLines={2} style={styles.front}>
                {item.front}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.fact}>
                {fact}
              </ThemedText>
            </Pressable>
          );
        }}
      />

      <View style={[styles.footer, { borderColor: theme.border }]}>
        {selecting ? (
          // The verbs all live under "⋯" in the header; what stays down here is
          // only what helps with picking.
          <View style={styles.selectionBar}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.selectionHint}>
              {selectedIds.length === 0
                ? 'Nic nie zaznaczono'
                : cardsLabel(selectedIds.length)}
            </ThemedText>
            {visibleCards.length > 0 ? (
              <Pressable onPress={toggleAllVisible} hitSlop={12} accessibilityRole="button">
                <ThemedText type="small" style={{ color: theme.accent }}>
                  {allVisiblePicked ? 'Odznacz wszystkie' : 'Zaznacz wszystkie'}
                </ThemedText>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View style={styles.footerRow}>
            <Button
              title={
                due > 0
                  ? `Ucz się (${due})`
                  : heldBack > 0
                    ? 'Limit na dziś wyczerpany'
                    : 'Nic do powtórki'
              }
              disabled={due === 0}
              style={styles.grow}
              onPress={() => router.push({ pathname: '/deck/[deckId]/review', params: { deckId } })}
            />
            <Pressable
              onPress={() => router.push({ pathname: '/card-editor', params: { deckId } })}
              accessibilityRole="button"
              accessibilityLabel="Dodaj kartę"
              style={({ pressed }) => [
                styles.add,
                { backgroundColor: theme.backgroundSelected, opacity: pressed ? 0.75 : 1 },
              ]}>
              <PlusIcon size={20} color={theme.text} />
            </Pressable>
          </View>
        )}
      </View>

      {menu ? (
        <ActionSheet
          visible
          title={MENU_TITLES[menu]}
          subtitle={
            menu === 'copy' || menu === 'move' ? cardsLabel(selectedIds.length) : undefined
          }
          settings={
            menu === 'sort'
              ? [
                  {
                    kind: 'segment',
                    label: 'Według',
                    value: order,
                    options: CARD_ORDERS.map((value) => ({
                      value,
                      label: SHORT_ORDER_LABELS[value],
                    })),
                    onChange: (value) => pickOrder(value as CardOrder),
                  },
                  {
                    kind: 'segment',
                    label: 'Kierunek',
                    value: direction,
                    options: (['asc', 'desc'] as const).map((value) => ({
                      value,
                      label: DIRECTION_LABELS[order][value],
                    })),
                    onChange: (value) => setDirection(value as SortDirection),
                  },
                ]
              : undefined
          }
          actions={
            menu === 'deck'
              ? deckActions()
              : menu === 'copy'
                ? copyActions()
                : menu === 'move'
                  ? moveActions()
                  : menu === 'sort'
                    ? []
                    : selectionActions()
          }
          onClose={() => setMenu(null)}
        />
      ) : null}
    </View>
  );
}

/**
 * The search field without a label over it: a magnifier says what it is, and
 * a cross inside clears it — one line instead of three.
 */
function SearchBox({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const theme = useTheme();

  return (
    <View style={[styles.searchBox, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <SearchIcon size={16} color={theme.textSecondary} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="Szukaj w talii"
        placeholderTextColor={theme.textSecondary}
        accessibilityLabel="Szukaj w talii"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={[styles.searchInput, { color: theme.text }]}
      />
      {value ? (
        <Pressable
          onPress={() => onChange('')}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Wyczyść wyszukiwanie"
          style={[styles.clear, { backgroundColor: theme.backgroundSelected }]}>
          <PlusIcon size={12} color={theme.textSecondary} style={styles.cross} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  list: {
    padding: Spacing.three,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    gap: Spacing.two,
    paddingBottom: Spacing.two,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  tools: {
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: Spacing.two,
  },
  clear: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cross: {
    transform: [{ rotate: '45deg' }],
  },
  filters: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  tagScroll: {
    flex: 1,
  },
  tags: {
    gap: Spacing.two,
  },
  tag: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Radius.large,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sortButton: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Radius.large,
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingLeft: Spacing.two,
    paddingRight: Spacing.three,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
  /** Where the card is on its way — new, learning, young, mature. */
  stripe: {
    width: 4,
    alignSelf: 'stretch',
    borderRadius: 2,
  },
  front: {
    flex: 1,
    fontWeight: '600',
  },
  fact: {
    fontVariant: ['tabular-nums'],
  },
  /** The checkbox that only exists while the list is picking. */
  tick: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingBottom: Spacing.one,
  },
  dots: {
    fontSize: 22,
    lineHeight: 24,
  },
  selectionHint: {
    flexShrink: 1,
  },
  footer: {
    padding: Spacing.three,
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  footerRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  grow: {
    flex: 1,
  },
  add: {
    width: 48,
    height: 48,
    borderRadius: Radius.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
