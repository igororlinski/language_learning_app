import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { TextField } from '@/components/text-field';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { createCard, deleteCard, getCard, updateCard } from '@/db/queries';
import { useTheme } from '@/hooks/use-theme';

export default function CardEditorScreen() {
  const theme = useTheme();
  const router = useRouter();

  const { deckId: deckIdParam, cardId: cardIdParam } = useLocalSearchParams<{
    deckId: string;
    cardId?: string;
  }>();
  const deckId = Number(deckIdParam);
  const cardId = cardIdParam ? Number(cardIdParam) : null;

  const existing = useMemo(() => (cardId ? getCard(cardId) : undefined), [cardId]);

  const [front, setFront] = useState(existing?.front ?? '');
  const [back, setBack] = useState(existing?.back ?? '');
  const [savedCount, setSavedCount] = useState(0);

  const frontInput = useRef<TextInput>(null);
  const canSave = front.trim().length > 0 && back.trim().length > 0;

  const save = () => {
    if (!canSave) return;

    if (cardId) {
      updateCard(cardId, { front, back });
      router.back();
      return;
    }

    // Fast entry: saving a new card clears the form and keeps the editor open so
    // a whole batch can be typed in one go. Leaving is the header back arrow.
    createCard(deckId, front, back);
    setFront('');
    setBack('');
    setSavedCount((count) => count + 1);
    frontInput.current?.focus();
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

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: theme.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: cardId ? 'Edytuj kartę' : 'Nowa karta' }} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextField
          ref={frontInput}
          label="Przód (pytanie)"
          value={front}
          onChangeText={setFront}
          placeholder="np. to break"
          autoFocus={!cardId}
          multiline
        />
        <TextField
          label="Tył (odpowiedź)"
          value={back}
          onChangeText={setBack}
          placeholder="np. broke / broken — łamać"
          multiline
        />

        {savedCount > 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            Dodano w tej sesji: {savedCount}
          </ThemedText>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { borderColor: theme.border }]}>
        <Button title="Zapisz" onPress={save} disabled={!canSave} />
        {cardId ? <Button title="Usuń kartę" variant="danger" onPress={confirmDelete} /> : null}
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
