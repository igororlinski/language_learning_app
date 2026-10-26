import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import migrations from '@drizzle/migrations';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { db } from '@/db/client';
import { addAiUsage } from '@/db/queries';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { setSpendSink } from '@/lib/ai-usage';
import { syncStats } from '@/lib/friends-store';
import { useDataGeneration } from '@/lib/data-generation';

// What the AI modules spend lands in the database, where the meters read it.
// Set at load rather than in an effect: nothing can spend before a screen has
// rendered, and by then the migrations below have run.
setSpendSink(addAiUsage);

/**
 * The catch-all: anything thrown outside a screen that has its own boundary
 * lands here instead of on a white screen. Every route exports the same one, so
 * a failure inside a screen keeps the navigator — and the way back — alive.
 */
export { ErrorScreen as ErrorBoundary } from '@/components/error-screen';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { success, error } = useMigrations(db, migrations);
  // Bumped by a restore: a new key remounts every screen on the restored data.
  const generation = useDataGeneration();

  // Friends see today's numbers from the moment the app opens; without an
  // account or a network this does nothing, and nothing waits on it.
  useEffect(() => {
    if (success) void syncStats();
  }, [success]);

  if (error) {
    return <Bootstrap message={`Nie udało się przygotować bazy: ${error.message}`} />;
  }

  if (!success) {
    return <Bootstrap message="Przygotowywanie bazy…" busy />;
  }

  return (
    // Both providers wrap everything: KeyboardProvider for the editors'
    // KeyboardAvoidingView, GestureHandlerRootView for the drag-to-reorder
    // gestures in the card editor.
    <GestureHandlerRootView style={styles.root}>
      <KeyboardProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <StatusBar style="auto" />
          <Stack key={generation} screenOptions={{ headerBackTitle: 'Wstecz' }}>
            {/*
              The main screen draws its own header (see index.tsx): the native
              one doubled the status-bar inset in edge-to-edge mode, leaving a
              big gap above the title, and `headerStatusBarHeight` is not exposed
              on this Stack's options to correct it.
            */}
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="ai-limits" options={{ title: 'Ustawienia AI' }} />
            <Stack.Screen name="stats" options={{ title: 'Statystyki' }} />
            <Stack.Screen name="backup" options={{ title: 'Import i eksport' }} />
            <Stack.Screen name="friends" options={{ title: 'Znajomi' }} />
            <Stack.Screen name="ranking" options={{ title: 'Ranking' }} />
            <Stack.Screen name="deck/[deckId]/index" options={{ title: 'Talia' }} />
            <Stack.Screen
              name="deck/[deckId]/review"
              options={{ headerShown: false, animation: 'fade' }}
            />
            <Stack.Screen
              name="deck/[deckId]/preview"
              options={{ headerShown: false, animation: 'fade' }}
            />
            <Stack.Screen name="deck-editor" options={{ presentation: 'modal' }} />
            <Stack.Screen name="card-editor" options={{ presentation: 'modal' }} />
            {/* Opened from the card editor, which is itself a modal — so this
                goes over it as one, or iOS would push it underneath. */}
            <Stack.Screen
              name="card-preview"
              options={{ headerShown: false, presentation: 'fullScreenModal', animation: 'fade' }}
            />
          </Stack>
        </ThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

function Bootstrap({ message, busy = false }: { message: string; busy?: boolean }) {
  return (
    <View style={styles.bootstrap}>
      {busy ? <ActivityIndicator /> : null}
      <ThemedText style={styles.bootstrapText}>{message}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  bootstrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  bootstrapText: {
    textAlign: 'center',
  },
});
