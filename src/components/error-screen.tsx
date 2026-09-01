import type { ErrorBoundaryProps } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * What is shown when a screen throws while rendering.
 *
 * Until this existed, any exception — a query rendering wrong SQL, a row with
 * an unexpected shape — left a white screen with nothing on it, which says
 * neither what broke nor what to do. The message is shown verbatim rather than
 * softened: it is the only clue there is, and it has to be readable from the
 * phone, where there is no console to check.
 *
 * `useTheme` reads the system colour scheme rather than a context, so this
 * still has the app's colours even though it renders in place of everything.
 */
export function ErrorScreen({ error, retry }: ErrorBoundaryProps) {
  const theme = useTheme();

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText style={styles.title}>Coś poszło nie tak</ThemedText>

        <View
          style={[
            styles.details,
            { borderColor: theme.border, backgroundColor: theme.backgroundElement },
          ]}>
          <ThemedText type="small" style={{ color: theme.danger }}>
            {error.message || String(error)}
          </ThemedText>
        </View>

        <Button title="Spróbuj ponownie" onPress={retry} style={styles.action} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
  },
  details: {
    padding: Spacing.three,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
  action: {
    alignSelf: 'stretch',
  },
});
