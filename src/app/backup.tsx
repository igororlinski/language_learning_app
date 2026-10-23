import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import type { File } from 'expo-file-system';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { appSettingsQuery, backupFolderFrom, lastBackupFrom } from '@/db/queries';
import { useTheme } from '@/hooks/use-theme';
import type { BackupManifest, BackupProblem } from '@/lib/archive';
import {
  BackupError,
  hasSafetyBackup,
  pickBackup,
  readBackupManifest,
  restoreBackup,
  safetyBackup,
  saveBackupToFolder,
  shareBackup,
} from '@/lib/backup-files';
import { cardsLabel, formatDate, pluralize } from '@/lib/format';
import { useReviewStore } from '@/stores/review-store';

/**
 * "Kopia zapasowa": save one into a folder, send one out of the app, or put
 * one back. Only the folder counts as „Ostatnia kopia" — it is the one way of
 * saving the app can see succeed (`backup-files.ts`).
 *
 * Restoring **replaces everything**, so it asks first and says what the file
 * holds and from when — and it keeps the state from just before as a backup of
 * its own, behind "Cofnij ostatnie przywracanie". The keys are not in a backup
 * (`backup-files.ts`), so a restored phone asks for them again.
 */
export { ErrorScreen as ErrorBoundary } from '@/components/error-screen';

const PROBLEMS: Record<BackupProblem, string> = {
  'not-backup': 'To nie jest kopia zapasowa tej aplikacji.',
  newer: 'Kopia pochodzi z nowszej wersji aplikacji. Zaktualizuj aplikację i spróbuj ponownie.',
  damaged: 'Plik kopii jest uszkodzony albo niekompletny.',
};

const failure = (error: unknown) =>
  error instanceof BackupError
    ? PROBLEMS[error.problem]
    : error instanceof Error
      ? error.message
      : 'Coś poszło nie tak.';

const at = (date: Date) =>
  `${formatDate(date)}, ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

/** „3 talie, 420 kart, 1200 powtórek" — what the question before a restore names. */
const holds = ({ counts }: BackupManifest) =>
  [
    `${counts.decks} ${pluralize(counts.decks, 'talia', 'talie', 'talii')}`,
    cardsLabel(counts.cards),
    `${counts.reviews} ${pluralize(counts.reviews, 'powtórka', 'powtórki', 'powtórek')}`,
  ].join(', ');

export default function BackupScreen() {
  const theme = useTheme();
  const { data: settings } = useLiveQuery(appSettingsQuery());
  const last = lastBackupFrom(settings);
  const folder = backupFolderFrom(settings);

  const [busy, setBusy] = useState<'save' | 'share' | 'restore' | null>(null);
  // Read at render: the file appears during a restore, and the screen is
  // remounted right after one anyway.
  const canUndo = hasSafetyBackup();

  const create = async (how: 'save' | 'share') => {
    setBusy(how);

    try {
      if (how === 'save') await saveBackupToFolder(folder ?? undefined);
      else await shareBackup();
    } catch (error) {
      Alert.alert('Nie utworzono kopii', failure(error), [{ text: 'OK' }], { cancelable: true });
    } finally {
      setBusy(null);
    }
  };

  const restore = async (file: File) => {
    setBusy('restore');

    try {
      const manifest = await restoreBackup(file);
      // The navigator remounts on the new data (`databaseReplaced`); the review
      // session is the one piece of state that lives outside it.
      useReviewStore.getState().reset();
      Alert.alert('Przywrócono', `Kopia z ${at(new Date(manifest.createdAt))}: ${holds(manifest)}.`, [{ text: 'OK' }], {
        cancelable: true,
      });
    } catch (error) {
      Alert.alert('Nie przywrócono', failure(error), [{ text: 'OK' }], { cancelable: true });
    } finally {
      setBusy(null);
    }
  };

  /** Shows what the file holds and asks — a restore cannot be taken back except by another. */
  const confirm = async (file: File, title: string) => {
    let manifest: BackupManifest;

    try {
      manifest = await readBackupManifest(file);
    } catch (error) {
      Alert.alert('Nie przywrócono', failure(error), [{ text: 'OK' }], { cancelable: true });
      return;
    }

    Alert.alert(
      title,
      `Kopia z ${at(new Date(manifest.createdAt))}: ${holds(manifest)}. Wszystkie obecne dane zostaną nią zastąpione.`,
      [
        { text: 'Anuluj', style: 'cancel' },
        { text: 'Przywróć', style: 'destructive', onPress: () => void restore(file) },
      ],
      { cancelable: true }
    );
  };

  const pickAndRestore = async () => {
    const file = await pickBackup();
    if (file) await confirm(file, 'Przywrócić kopię?');
  };

  const card = [styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }];

  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
      <View style={card}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          Ostatnia kopia
        </ThemedText>
        <ThemedText style={styles.big}>{last ? at(last) : 'Jeszcze nie było'}</ThemedText>
      </View>

      <Button
        title={busy === 'save' ? 'Zapisuję kopię…' : 'Zapisz kopię w folderze…'}
        loading={busy === 'save'}
        disabled={busy !== null}
        onPress={() => void create('save')}
      />
      <Button
        title={busy === 'share' ? 'Tworzę kopię…' : 'Udostępnij kopię…'}
        variant="secondary"
        loading={busy === 'share'}
        disabled={busy !== null}
        onPress={() => void create('share')}
      />

      <View style={styles.section}>
        <Button
          title={busy === 'restore' ? 'Przywracam…' : 'Przywróć z pliku…'}
          variant="secondary"
          loading={busy === 'restore'}
          disabled={busy !== null}
          onPress={() => void pickAndRestore()}
        />
        {canUndo ? (
          <Button
            title="Cofnij ostatnie przywracanie"
            variant="secondary"
            disabled={busy !== null}
            onPress={() => void confirm(safetyBackup(), 'Cofnąć przywracanie?')}
          />
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    padding: Spacing.three,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  card: { padding: Spacing.three, gap: Spacing.one, borderRadius: Radius.large, borderWidth: StyleSheet.hairlineWidth },
  big: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  section: { marginTop: Spacing.three, gap: Spacing.three },
});
