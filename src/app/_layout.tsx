import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import migrations from '@drizzle/migrations';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { db } from '@/db/client';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { success, error } = useMigrations(db, migrations);

  if (error) {
    return <Bootstrap message={`Nie udało się przygotować bazy: ${error.message}`} />;
  }

  if (!success) {
    return <Bootstrap message="Przygotowywanie bazy…" busy />;
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerBackTitle: 'Wstecz' }}>
        <Stack.Screen name="index" options={{ title: 'Talie' }} />
        <Stack.Screen name="deck/[deckId]/index" options={{ title: 'Talia' }} />
        <Stack.Screen
          name="deck/[deckId]/review"
          options={{ headerShown: false, animation: 'fade' }}
        />
        <Stack.Screen name="deck-editor" options={{ presentation: 'modal' }} />
        <Stack.Screen name="card-editor" options={{ presentation: 'modal' }} />
      </Stack>
    </ThemeProvider>
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
