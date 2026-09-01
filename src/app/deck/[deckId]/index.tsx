import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { Button } from '@/components/button';
import { DueCounts } from '@/components/due-counts';
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
  deleteCards,
  moveCards,
  otherDecksQuery,
  resetCards,
} from '@/db/queries';
import { useNow } from '@/hooks/use-now';
import { useTheme } from '@/hooks/use-theme';
import { deleteMedia, duplicateMedia } from '@/lib/media-files';
import { cardsLabel, formatDue } from '@/lib/format';
import { cappedCounts, studyDayStart, totalDue } from '@/lib/limits';
import { filterCards } from '@/lib/search';
import { STATE_LABELS, State } from '@/lib/scheduler';

/**
 * What the "⋯" sheet is showing: the things that can be done to the selection,
 * or the list of decks to copy or move it into. One sheet swaps its contents
 * rather than opening a second modal — see `SheetAction.keepOpen`.
 */
type MenuView = 'actions' | 'copy' | 'move';

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
  const visibleCards = useMemo(() => filterCards(cards ?? [], query), [cards, query]);

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
   * Everything that can be done to what is picked. One card selected gets two
   * extra entries — editing and resetting make sense for exactly one card, and
   * hiding the rest behind a second menu would only split the same list in two.
   */
  const selectionActions = (): SheetAction[] => {
    const count = selectedIds.length;
    const nothing = count === 0;
    const single = count === 1 ? selectedIds[0] : null;
    const emptyHint = nothing ? 'Najpierw zaznacz karty.' : undefined;

    return [
      {
        label: 'Podgląd zaznaczonych',
        hint: emptyHint ?? 'Przejrzyj je tak, jak zobaczy je uczący się. Nic nie zapisuje.',
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
        hint: emptyHint ?? 'Oryginały zostają na miejscu.',
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
      hint: 'Kopie wylądują tutaj, obok oryginałów.',
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
              <View style={styles.headerActions}>
                <Pressable
                  onPress={() => setMenu('actions')}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="Co zrobić z zaznaczonymi kartami">
                  <ThemedText style={[styles.dots, { color: theme.accent }]}>⋯</ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => setSelected(null)}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="Zakończ zaznaczanie">
                  <ThemedText type="small" style={{ color: theme.accent }}>
                    Gotowe
                  </ThemedText>
                </Pressable>
              </View>
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
              {searching
                ? `${visibleCards.length} z ${cardsLabel(allCards.length)}`
                : cardsLabel(allCards.length)}
            </ThemedText>
            <DueCounts counts={counts} showLabels />
            {heldBack > 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                {`Dzienny limit wstrzymuje ${cardsLabel(heldBack)} — wrócą jutro.`}
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
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          searching ? (
            <EmptyState
              title="Nic nie pasuje"
              hint={`Żadna karta w tej talii nie zawiera „${query.trim()}”.`}
            />
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
            <ThemedText type="small" themeColor="textSecondary">
              {selectedIds.length === 0
                ? 'Dotknij kart, żeby je zaznaczyć'
                : `Zaznaczono ${cardsLabel(selectedIds.length)} — akcje pod ⋯`}
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
            menu === 'actions'
              ? undefined
              : `${cardsLabel(selectedIds.length)}${menu === 'copy' ? ' — oryginały zostają na miejscu' : ''}`
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
