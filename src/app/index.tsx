import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { Button } from '@/components/button';
import { DueCounts } from '@/components/due-counts';
import { EmptyState } from '@/components/empty-state';
import { GoalBar } from '@/components/goal-bar';
import { MenuIcon } from '@/components/icons';
import { SideMenu } from '@/components/side-menu';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, RatingColors, Spacing } from '@/constants/theme';
import { deckMediaFiles, decksWithStatsQuery, deleteDeck } from '@/db/queries';
import { useNow } from '@/hooks/use-now';
import { useStreak } from '@/hooks/use-streak';
import { useTheme } from '@/hooks/use-theme';
import { deleteMedia } from '@/lib/media-files';
import { cardsLabel } from '@/lib/format';
import { cappedCounts, studyDayStart, totalDue } from '@/lib/limits';

type DeckMenuTarget = { id: number; name: string; cardCount: number; due: number; heldBack: number };

/**
 * Expo Router renders this in place of the screen when it throws, keeping the
 * navigator — and the way back — alive. See `src/components/error-screen.tsx`.
 */
export { ErrorScreen as ErrorBoundary } from '@/components/error-screen';

export default function DecksScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const now = useNow();
  const dayStart = studyDayStart(new Date(now)).getTime();
  const { data: decks } = useLiveQuery(decksWithStatsQuery(now, dayStart), [now, dayStart]);
  const { streak } = useStreak(now);

  const [menuDeck, setMenuDeck] = useState<DeckMenuTarget | null>(null);
  const [appMenuOpen, setAppMenuOpen] = useState(false);

  const openCards = (deckId: number) =>
    router.push({ pathname: '/deck/[deckId]', params: { deckId } });

  const startStudy = (deckId: number) =>
    router.push({ pathname: '/deck/[deckId]/review', params: { deckId } });

  /** Runs once the sheet has closed, so no dialog is opened from inside another. */
  const confirmDelete = (deck: DeckMenuTarget) => {
    Alert.alert(
      'Usunąć talię?',
      `„${deck.name}” zniknie razem ze wszystkimi kartami i historią powtórek.`,
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Usuń',
          style: 'destructive',
          onPress: () => {
            // The media copies are files, not rows, so the cascade misses them.
            const files = deckMediaFiles(deck.id);
            deleteDeck(deck.id);
            deleteMedia(files);
          },
        },
      ],
      { cancelable: true }
    );
  };

  const menuActions = (deck: DeckMenuTarget): SheetAction[] => [
    {
      label: deck.due > 0 ? `Ucz się (${deck.due})` : 'Ucz się',
      disabled: deck.due === 0,
      hint: deck.due > 0 ? undefined : deck.heldBack > 0 ? 'Limit na dziś wyczerpany.' : 'Nic do powtórki.',
      onPress: () => startStudy(deck.id),
    },
    { label: 'Karty w talii', onPress: () => openCards(deck.id) },
    {
      label: 'Edytuj talię',
      onPress: () => router.push({ pathname: '/deck-editor', params: { deckId: deck.id } }),
    },
    { label: 'Usuń talię', destructive: true, onPress: () => confirmDelete(deck) },
  ];

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/*
        Custom header instead of the native one: it applies the status-bar inset
        exactly once (the native header doubled it in edge-to-edge mode), and it
        sits above the drawer so the hamburger stays tappable — which is what
        lets a second tap toggle the menu shut.
      */}
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + Spacing.two, backgroundColor: theme.background, borderBottomColor: theme.border },
        ]}>
        <Pressable
          onPress={() => setAppMenuOpen((open) => !open)}
          hitSlop={Spacing.two}
          accessibilityRole="button"
          accessibilityState={{ expanded: appMenuOpen }}
          accessibilityLabel="Menu"
          style={styles.menuButton}>
          {({ pressed }) => (
            <MenuIcon size={20} color={theme.text} style={{ opacity: pressed ? 0.5 : 1 }} />
          )}
        </Pressable>
        <ThemedText style={styles.headerTitle}>Talie</ThemedText>

        {decks.length > 0 ? (
          <Pressable
            onPress={() => router.push('/stats')}
            hitSlop={Spacing.two}
            accessibilityRole="button"
            accessibilityLabel={`Seria ${streak.current}, dziś ${streak.today.answers} z ${streak.today.goal}`}
            style={({ pressed }) => [styles.goal, { opacity: pressed ? 0.5 : 1 }]}>
            <ThemedText
              type="smallBold"
              style={streak.today.met ? { color: RatingColors.good } : undefined}>
              Seria {streak.current}
            </ThemedText>
            <View style={styles.goalProgress}>
              <GoalBar today={streak.today} />
              <ThemedText type="small" themeColor="textSecondary" style={styles.goalCount}>
                {streak.today.answers}/{streak.today.goal}
              </ThemedText>
            </View>
          </Pressable>
        ) : null}
      </View>

      {/* The drawer overlays only this body, so it never covers the header. */}
      <View style={styles.body}>
        <FlatList
          data={decks}
          keyExtractor={(deck) => String(deck.id)}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <>
              <EmptyState
                title="Nie masz jeszcze żadnej talii"
                hint={'Talia to zbiór fiszek na jeden temat — np. „Angielski B2” albo „Anatomia”.'}
              />
              <Button title="O tej aplikacji" variant="ghost" onPress={() => router.push('/about')} />
            </>
          }
          renderItem={({ item }) => {
            // Counters and the tap target both read the capped numbers, so the
            // badge can never promise more than "Ucz się" will hand out.
            const counts = cappedCounts(item);
            const due = totalDue(counts);
            const heldBack = item.newCount + item.learningCount + item.reviewCount - due;

            return (
              <Pressable
                onPress={() => openCards(item.id)}
                onLongPress={() => setMenuDeck({ ...item, due, heldBack })}
                accessibilityRole="button"
                accessibilityLabel={`${item.name}, ${cardsLabel(item.cardCount)}`}
                accessibilityHint="Przytrzymaj, żeby otworzyć menu talii"
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.border,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}>
                <View style={styles.rowMain}>
                  <ThemedText style={styles.deckName}>{item.name}</ThemedText>
                  {item.description ? (
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                      {item.description}
                    </ThemedText>
                  ) : null}
                  <ThemedText type="small" themeColor="textSecondary">
                    {cardsLabel(item.cardCount)}
                  </ThemedText>
                </View>

                {/* Its own target, so the row itself always does one thing:
                    open the deck. Gone when there is nothing to study — the
                    deck screen and the long-press menu say why. */}
                {due > 0 ? (
                  <Pressable
                    onPress={() => startStudy(item.id)}
                    hitSlop={Spacing.two}
                    accessibilityRole="button"
                    accessibilityLabel={`Ucz się, ${cardsLabel(due)} do powtórki`}
                    style={({ pressed }) => [
                      styles.study,
                      {
                        borderColor: theme.accent,
                        backgroundColor: pressed ? theme.backgroundSelected : 'transparent',
                      },
                    ]}>
                    <ThemedText type="smallBold" style={{ color: theme.accent }}>
                      Ucz się
                    </ThemedText>
                    <DueCounts counts={counts} style={styles.studyCounts} />
                  </Pressable>
                ) : null}
              </Pressable>
            );
          }}
        />

        <View style={[styles.footer, { borderColor: theme.border }]}>
          <Button title="Nowa talia" onPress={() => router.push('/deck-editor')} />
        </View>

        <SideMenu
          visible={appMenuOpen}
          onClose={() => setAppMenuOpen(false)}
          items={[
            { label: 'Ustawienia AI', onPress: () => router.push('/ai-limits') },
            { label: 'Statystyki', onPress: () => router.push('/stats') },
            { label: 'Znajomi', onPress: () => router.push('/friends') },
            { label: 'Import i eksport', onPress: () => router.push('/backup') },
            { label: 'O tej aplikacji', onPress: () => router.push('/about') },
          ]}
        />
      </View>

      {menuDeck ? (
        <ActionSheet
          visible
          title={menuDeck.name}
          subtitle={`${cardsLabel(menuDeck.cardCount)} · ${menuDeck.due} do powtórki`}
          actions={menuActions(menuDeck)}
          onClose={() => setMenuDeck(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  menuButton: {
    paddingVertical: Spacing.two,
    paddingRight: Spacing.three,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
  },
  goal: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  goalProgress: {
    width: 64,
    gap: Spacing.half,
  },
  goalCount: {
    textAlign: 'center',
  },
  body: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: Spacing.three,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.large,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowMain: {
    flex: 1,
    gap: Spacing.half,
  },
  deckName: {
    fontSize: 17,
    fontWeight: '600',
  },
  study: {
    alignItems: 'center',
    gap: Spacing.half,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.medium,
    borderWidth: 1,
  },
  studyCounts: {
    gap: Spacing.two,
  },
  footer: {
    padding: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
});
