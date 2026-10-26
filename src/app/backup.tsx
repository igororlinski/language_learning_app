import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import type { File } from 'expo-file-system';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { ActionSheet } from '@/components/action-sheet';
import { Button } from '@/components/button';
import { Dropdown } from '@/components/dropdown';
import { SegmentedControl } from '@/components/segmented-control';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { appSettingsQuery, backupFolderFrom, deckNamesQuery, lastBackupFrom } from '@/db/queries';
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
import type { CsvCard } from '@/lib/csv-import';
import {
  importCsv,
  importDeckFile,
  ImportError,
  inspectImportFile,
  pickImportFile,
  saveDeckToFolder,
  shareDeck,
} from '@/lib/deck-files';
import { cardsLabel, formatDate, pluralize } from '@/lib/format';
import { useReviewStore } from '@/stores/review-store';

/**
 * "Import i eksport": the whole collection as a backup, one deck as a file,
 * and a deck or a spreadsheet brought in.
 *
 * Only saving a backup into a folder counts as „Ostatnia kopia" — it is the
 * one way of saving the app can see succeed (`backup-files.ts`).
 *
 * Restoring **replaces everything**, so it asks first and says what the file
 * holds and from when — and it keeps the state from just before as a backup of
 * its own, behind "Cofnij ostatnie przywracanie". The keys are not in a backup
 * (`backup-files.ts`), so a restored phone asks for them again.
 *
 * Importing **joins**: a deck file adds the cards that are not here and
 * leaves the ones that are (`importDeckPackage`), a spreadsheet adds the rows
 * a deck does not have yet (`importCsvCards`). Neither asks to replace
 * anything, so neither needs a way back.
 */
export { ErrorScreen as ErrorBoundary } from '@/components/error-screen';

const PROBLEMS: Record<BackupProblem, string> = {
  'not-backup': 'To nie jest kopia zapasowa tej aplikacji.',
  newer: 'Kopia pochodzi z nowszej wersji aplikacji. Zaktualizuj aplikację i spróbuj ponownie.',
  damaged: 'Plik kopii jest uszkodzony albo niekompletny.',
};

const IMPORT_PROBLEMS: Record<ImportError['problem'], string> = {
  unknown: 'Nie znam tego pliku. Talię z Anki wyeksportuj jako „Notatki w zwykłym tekście”.',
  damaged: 'Plik jest uszkodzony albo niekompletny.',
  newer: 'Plik pochodzi z nowszej wersji aplikacji. Zaktualizuj aplikację i spróbuj ponownie.',
  empty: 'W pliku nie ma żadnej karty.',
  'too-large': 'Plik jest za duży jak na arkusz (ponad 20 MB).',
};

const failure = (error: unknown) =>
  error instanceof BackupError
    ? PROBLEMS[error.problem]
    : error instanceof ImportError
      ? IMPORT_PROBLEMS[error.problem]
      : error instanceof Error
        ? error.message
        : 'Coś poszło nie tak.';

const tell = (title: string, message: string) => Alert.alert(title, message, [{ text: 'OK' }], { cancelable: true });

const at = (date: Date) =>
  `${formatDate(date)}, ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

/** „3 talie, 420 kart, 1200 powtórek" — what the question before a restore names. */
const holds = ({ counts }: BackupManifest) =>
  [
    `${counts.decks} ${pluralize(counts.decks, 'talia', 'talie', 'talii')}`,
    cardsLabel(counts.cards),
    `${counts.reviews} ${pluralize(counts.reviews, 'powtórka', 'powtórki', 'powtórek')}`,
  ].join(', ');

/** „Dodano 12 kart. Pominięte, bo już były: 3." */
const imported = (added: number, skipped: number) =>
  `Dodano ${cardsLabel(added)}.` + (skipped > 0 ? ` Pominięte, bo już były: ${skipped}.` : '');

type Busy = 'save' | 'share' | 'restore' | 'deck-save' | 'deck-share' | 'import';
type Progress = 'with' | 'without';

export default function BackupScreen() {
  const theme = useTheme();
  const { data: settings } = useLiveQuery(appSettingsQuery());
  const { data: deckList } = useLiveQuery(deckNamesQuery());
  const last = lastBackupFrom(settings);
  const folder = backupFolderFrom(settings) ?? undefined;

  const [busy, setBusy] = useState<Busy | null>(null);
  // Read at render: the file appears during a restore, and the screen is
  // remounted right after one anyway.
  const canUndo = hasSafetyBackup();

  const [exportDeckId, setExportDeckId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress>('with');
  const exportDeck = deckList.find((deck) => String(deck.id) === exportDeckId) ?? deckList[0] ?? null;

  /** A spreadsheet read and waiting for the deck it goes into. */
  const [csv, setCsv] = useState<{ rows: CsvCard[]; name: string } | null>(null);

  const create = async (how: 'save' | 'share') => {
    setBusy(how);

    try {
      if (how === 'save') await saveBackupToFolder(folder);
      else await shareBackup();
    } catch (error) {
      tell('Nie utworzono kopii', failure(error));
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
      tell('Przywrócono', `Kopia z ${at(new Date(manifest.createdAt))}: ${holds(manifest)}.`);
    } catch (error) {
      tell('Nie przywrócono', failure(error));
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
      tell('Nie przywrócono', failure(error));
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

  const writeDeck = async (how: 'save' | 'share') => {
    if (!exportDeck) return;

    setBusy(how === 'save' ? 'deck-save' : 'deck-share');

    try {
      const withProgress = progress === 'with';

      if (how === 'save') await saveDeckToFolder(exportDeck.id, exportDeck.name, withProgress, folder);
      else await shareDeck(exportDeck.id, exportDeck.name, withProgress);
    } catch (error) {
      tell('Nie wyeksportowano talii', failure(error));
    } finally {
      setBusy(null);
    }
  };

  const importDeck = async (file: File) => {
    setBusy('import');

    try {
      const result = await importDeckFile(file);
      tell('Zaimportowano', imported(result.added, result.skipped));
    } catch (error) {
      tell('Nie zaimportowano', failure(error));
    } finally {
      setBusy(null);
    }
  };

  const pickAndImport = async () => {
    const file = await pickImportFile();
    if (!file) return;

    setBusy('import');

    let found: Awaited<ReturnType<typeof inspectImportFile>>;

    try {
      found = await inspectImportFile(file);
    } catch (error) {
      tell('Nie zaimportowano', failure(error));
      return;
    } finally {
      setBusy(null);
    }

    if (found.kind === 'backup') {
      tell('To jest kopia zapasowa', 'Całą kolekcję przywraca „Przywróć z pliku…”.');
      return;
    }

    if (found.kind === 'csv') {
      setCsv({ rows: found.rows, name: found.name });
      return;
    }

    const { manifest, file: deckFile } = found;

    Alert.alert(
      'Zaimportować talię?',
      `„${manifest.name}”: ${cardsLabel(manifest.cards)}` +
        (manifest.withProgress ? ', z postępem nauki' : '') +
        '. Karty, które już masz, zostaną pominięte.',
      [
        { text: 'Anuluj', style: 'cancel' },
        { text: 'Importuj', onPress: () => void importDeck(deckFile) },
      ],
      { cancelable: true }
    );
  };

  const importRows = (rows: CsvCard[], target: { deckId: number } | { newDeckName: string }) => {
    try {
      const result = importCsv(rows, target);
      tell('Zaimportowano', imported(result.added, result.skipped));
    } catch (error) {
      tell('Nie zaimportowano', failure(error));
    }
  };

  const card = [styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }];

  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        Kopia zapasowa
      </ThemedText>

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

      {exportDeck ? (
        <View style={styles.section}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            Eksport talii
          </ThemedText>

          {/* Shown with a single deck too: what goes into the file is named. */}
          <Dropdown
            label="Talia"
            value={String(exportDeck.id)}
            options={deckList.map((deck) => ({ value: String(deck.id), label: deck.name }))}
            onChange={setExportDeckId}
          />

          <SegmentedControl<Progress>
            value={progress}
            options={[
              { value: 'with', label: 'Z postępem nauki' },
              { value: 'without', label: 'Bez postępu' },
            ]}
            onChange={setProgress}
            accessibilityLabel="Postęp nauki w pliku"
          />

          <Button
            title={busy === 'deck-save' ? 'Zapisuję talię…' : 'Zapisz talię w folderze…'}
            variant="secondary"
            loading={busy === 'deck-save'}
            disabled={busy !== null}
            onPress={() => void writeDeck('save')}
          />
          <Button
            title={busy === 'deck-share' ? 'Tworzę plik…' : 'Udostępnij talię…'}
            variant="secondary"
            loading={busy === 'deck-share'}
            disabled={busy !== null}
            onPress={() => void writeDeck('share')}
          />
        </View>
      ) : null}

      <View style={styles.section}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          Import
        </ThemedText>

        <Button
          title={busy === 'import' ? 'Importuję…' : 'Importuj talię lub CSV…'}
          variant="secondary"
          loading={busy === 'import'}
          disabled={busy !== null}
          onPress={() => void pickAndImport()}
        />
      </View>

      {csv ? (
        <ActionSheet
          visible
          title="Do której talii?"
          subtitle={`${csv.name} · ${cardsLabel(csv.rows.length)}`}
          actions={[
            {
              label: `Nowa talia: ${csv.name}`,
              onPress: () => importRows(csv.rows, { newDeckName: csv.name }),
            },
            ...deckList.map((deck) => ({
              label: deck.name,
              onPress: () => importRows(csv.rows, { deckId: deck.id }),
            })),
          ]}
          onClose={() => setCsv(null)}
        />
      ) : null}
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
  section: { marginTop: Spacing.four, gap: Spacing.three },
});
