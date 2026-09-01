import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { Button } from '@/components/button';
import { DueCounts } from '@/components/due-counts';
import { Dropdown, type DropdownOption } from '@/components/dropdown';
import { EmptyState } from '@/components/empty-state';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
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
import { STATE_LABELS, State } from '@/lib/scheduler';

/**
 * What the "⋯" sheet is showing: the things that can be done to the selection,
 * or the list of decks to copy or move it into. One sheet swaps its contents
 * rather than opening a second modal — see `SheetAction.keepOpen`.
 */
type MenuView = 'actions' | 'copy' | 'move';

const SORT_OPTIONS: DropdownOption<CardOrder>[] = CARD_ORDERS.map((value) => ({
  value,
  label: CARD_ORDER_LABELS[value],
}));

/** Placeholder while the aggregate is still loading, so the counters never flicker. */
const EMPTY_BREAKDOWN = {
  newCount: 0,
  learningCount: 0,
  reviewCount: 0,
  newDoneToday: 0,
  reviewsDoneToday: 0,
};

export default function DeckScreen() {
  const theme = useTheme();
  const router = useRouter();
  const now = useNow();

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

  const navigation = useNavigation();

  // Going back drops the selection instead of leaving the deck — one rule for
  // the header arrow, the phone's back button and the back gesture alike, since
  // all three come through here. `expo-router` (SDK 57) exports no
  // `usePreventRemove`, so the navigation event is listened to directly.
  useEffect(() => {
    if (!selecting) return;

    return navigation.addListener('beforeRemove', (event) => {
      event.preventDefault();
      setSelected(null);
    });
  }, [navigation, selecting]);

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
    Alert.alert(
      'Skopiowano',
      `${cardsLabel(made.length)} → „${target.name}”. Kopie zaczynają jako nowe karty.`,
      [{ text: 'OK' }],
      { cancelable: true }
    );
  };

  /** The card keeps its schedule and history — only the deck changes. */
  const moveSelectedTo = (target: { id: number; name: string }) => {
    const ids = selectedIds;
    if (ids.length === 0) return;

    moveCards(ids, target.id);
    setSelected(null);
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
          resetCards(selectedIds);
          setSelected(null);
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

  const MENU_TITLES: Record<MenuView, string> = {
    actions: `Zaznaczono ${selectedIds.length}`,
    copy: 'Kopiuj do talii',
    move: 'Przenieś do talii',
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
                onPress={() => router.push({ pathname: '/deck-editor', params: { deckId } })}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Edytuj talię">
                <ThemedText type="small" style={{ color: theme.accent }}>
                  Edytuj
                </ThemedText>
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
            <ThemedText type="small" themeColor="textSecondary">
              {narrowed
                ? `${visibleCards.length} z ${cardsLabel(allCards.length)}`
                : cardsLabel(allCards.length)}
            </ThemedText>
            <DueCounts counts={counts} showLabels />
            {heldBack > 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                {`Wstrzymane limitem: ${cardsLabel(heldBack)}`}
              </ThemedText>
            ) : null}

            {allCards.length > 0 ? (
              <View style={styles.search}>
                <TextField
                  label="Szukaj w talii"
                  value={query}
                  onChangeText={setQuery}
                  placeholder="np. break, łamać, /breɪk/"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                />
                {searching ? (
                  <Pressable onPress={() => setQuery('')} hitSlop={12} style={styles.clear}>
                    <ThemedText type="small" style={{ color: theme.accent }}>
                      Wyczyść
                    </ThemedText>
                  </Pressable>
                ) : null}

                {tagChips.length > 0 ? (
                  <View style={styles.tags}>
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
                                ? theme.backgroundSelected
                                : pressed
                                  ? theme.backgroundSelected
                                  : 'transparent',
                            },
                          ]}>
                          <ThemedText
                            type={picked ? 'smallBold' : 'small'}
                            style={picked ? { color: theme.accent } : undefined}>
                            {`${tag.name} ${tag.cardCount}`}
                          </ThemedText>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}

                {allCards.length > 1 ? (
                  <View style={styles.sort}>
                    <Dropdown
                      value={order}
                      options={SORT_OPTIONS}
                      onChange={pickOrder}
                      accessibilityLabel="Kolejność kart"
                      style={styles.sortField}
                    />
                    <Pressable
                      onPress={() => setDirection(direction === 'asc' ? 'desc' : 'asc')}
                      accessibilityRole="button"
                      accessibilityLabel={DIRECTION_LABELS[order][direction]}
                      style={({ pressed }) => [
                        styles.direction,
                        {
                          borderColor: theme.border,
                          backgroundColor: pressed
                            ? theme.backgroundSelected
                            : theme.backgroundElement,
                        },
                      ]}>
                      <ThemedText type="small" style={{ color: theme.accent }}>
                        {direction === 'asc' ? '↑' : '↓'}
                      </ThemedText>
                    </Pressable>
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
              accessibilityLabel={item.front}
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
                  {picked ? (
                    <ThemedText type="smallBold" style={{ color: theme.onAccent }}>
                      ✓
                    </ThemedText>
                  ) : null}
                </View>
              ) : null}

              <View style={styles.rowMain}>
                <ThemedText numberOfLines={2} style={styles.front}>
                  {item.front}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                  {item.back}
                </ThemedText>
              </View>
              <View style={styles.rowMeta}>
                <ThemedText type="small" themeColor="textSecondary">
                  {STATE_LABELS[(item.state ?? State.New) as State]}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {formatDue(item.due, now)}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.added}>
                  {formatDate(item.createdAt, new Date(now))}
                </ThemedText>
              </View>
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
          <>
            <Button
              title={
                due > 0
                  ? `Ucz się (${due})`
                  : heldBack > 0
                    ? 'Limit na dziś wyczerpany'
                    : 'Nic do powtórki'
              }
              disabled={due === 0}
              onPress={() => router.push({ pathname: '/deck/[deckId]/review', params: { deckId } })}
            />
            <Button
              title="Dodaj kartę"
              variant="secondary"
              onPress={() => router.push({ pathname: '/card-editor', params: { deckId } })}
            />
          </>
        )}
      </View>

      {menu ? (
        <ActionSheet
          visible
          title={MENU_TITLES[menu]}
          subtitle={
            menu === 'copy' || menu === 'move' ? cardsLabel(selectedIds.length) : undefined
          }
          actions={
            menu === 'copy' ? copyActions() : menu === 'move' ? moveActions() : selectionActions()
          }
          onClose={() => setMenu(null)}
        />
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
  search: {
    paddingTop: Spacing.two,
    gap: Spacing.one,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  tag: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Radius.large,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sort: {
    flexDirection: 'row',
    // Top-aligned so the toggle stays put while the list unfolds downwards.
    alignItems: 'flex-start',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  sortField: {
    flex: 1,
  },
  direction: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
  clear: {
    alignSelf: 'flex-end',
  },
  header: {
    gap: Spacing.one,
    paddingBottom: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.large,
    borderWidth: StyleSheet.hairlineWidth,
  },
  /** Dimmer than the rest of the meta column — it is the least urgent number. */
  added: {
    opacity: 0.7,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
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
  selectionActions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  selectionAction: {
    flex: 1,
  },
  rowMain: {
    flex: 1,
    gap: Spacing.half,
  },
  rowMeta: {
    alignItems: 'flex-end',
    gap: Spacing.half,
  },
  front: {
    fontWeight: '600',
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
