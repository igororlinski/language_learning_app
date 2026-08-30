import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { createDeck, deleteDeck, getDeck, updateDeck } from '@/db/queries';
import { useTheme } from '@/hooks/use-theme';

export default function DeckEditorScreen() {
  const theme = useTheme();
  const router = useRouter();

  const { deckId: deckIdParam } = useLocalSearchParams<{ deckId?: string }>();
  const deckId = deckIdParam ? Number(deckIdParam) : null;

  const existing = useMemo(() => (deckId ? getDeck(deckId) : undefined), [deckId]);

  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');

  const canSave = name.trim().length > 0;

  const save = () => {
    if (!canSave) return;
    if (deckId) {
      updateDeck(deckId, { name, description });
      router.back();
    } else {
      const deck = createDeck(name, description);
      router.replace({ pathname: '/deck/[deckId]', params: { deckId: deck.id } });
    }
  };

  const confirmDelete = () => {
    if (!deckId) return;
    Alert.alert('Usunąć talię?', 'Znikną też wszystkie karty i historia powtórek.', [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Usuń',
        style: 'destructive',
        onPress: () => {
          deleteDeck(deckId);
          router.dismissTo('/');
        },
      },
    ], { cancelable: true });
  };

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: deckId ? 'Edytuj talię' : 'Nowa talia' }} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextField
          label="Nazwa"
          value={name}
          onChangeText={setName}
          placeholder="np. Angielski — czasowniki nieregularne"
          autoFocus={!deckId}
        />
        <TextField
          label="Opis (opcjonalny)"
          value={description}
          onChangeText={setDescription}
          placeholder="Do czego służy ta talia?"
          multiline
        />
      </ScrollView>

      <View style={[styles.footer, { borderColor: theme.border }]}>
        <Button title="Zapisz" onPress={save} disabled={!canSave} />
        {deckId ? <Button title="Usuń talię" variant="danger" onPress={confirmDelete} /> : null}
      </View>
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
  footer: {
    padding: Spacing.three,
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
});
