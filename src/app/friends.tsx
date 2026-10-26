import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Share, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Radius, RatingColors, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { badgeLabel } from '@/lib/badges';
import { pluralize } from '@/lib/format';
import {
  addFriend,
  createAccount,
  deleteAccount,
  fetchLeaderboard,
  FriendsError,
  recoverAccount,
  removeFriend,
  renameAccount,
  replaceFriendCode,
  type Account,
  type Person,
} from '@/lib/friends';
import { saveAccount, syncStats, useAccount } from '@/lib/friends-store';
import { formatDuration } from '@/lib/stats';

/**
 * "Znajomi": an account on our server, friends added by code, and this week's
 * ranking by days with the goal met.
 *
 * Nothing the app needs for studying waits on this screen. Without a network
 * it says so and the rest of the app carries on; the numbers go up again with
 * the next upload.
 */
export { ErrorScreen as ErrorBoundary } from '@/components/error-screen';

const failure = (error: unknown) =>
  error instanceof FriendsError ? error.message : error instanceof Error ? error.message : String(error);

const confirm = (title: string, message: string, action: string, onPress: () => void, destructive = false) =>
  Alert.alert(
    title,
    message,
    [
      { text: 'Anuluj', style: 'cancel' },
      { text: action, style: destructive ? 'destructive' : 'default', onPress },
    ],
    { cancelable: true }
  );

const tell = (title: string, message: string) => Alert.alert(title, message, [{ text: 'OK' }], { cancelable: true });

const codeFieldProps = {
  autoCapitalize: 'characters',
  autoCorrect: false,
  spellCheck: false,
} as const;

export default function FriendsScreen() {
  const theme = useTheme();
  const account = useAccount();
  // A brand-new account opens with its recovery code on show: it is the one
  // moment the user is sure to be looking.
  const [justCreated, setJustCreated] = useState(false);

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.screen, { backgroundColor: theme.background }]}>
      {account === undefined ? (
        <ActivityIndicator style={styles.spinner} />
      ) : account ? (
        <SignedIn account={account} revealCode={justCreated} />
      ) : (
        <SignIn onCreated={() => setJustCreated(true)} />
      )}
    </KeyboardAvoidingView>
  );
}

/* ---------------------------------------------------------------- sign in */

function SignIn({ onCreated }: { onCreated: () => void }) {
  const theme = useTheme();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'recover' | null>(null);
  const [errors, setErrors] = useState<{ create?: string; recover?: string }>({});

  const card = [styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }];

  const create = async () => {
    setBusy('create');
    setErrors({});

    try {
      const account = await createAccount(name);
      onCreated();
      await saveAccount(account);
      void syncStats();
    } catch (error) {
      setErrors({ create: failure(error) });
    } finally {
      setBusy(null);
    }
  };

  const recover = async () => {
    setBusy('recover');
    setErrors({});

    try {
      await saveAccount(await recoverAccount(code));
      void syncStats();
    } catch (error) {
      setErrors({ recover: failure(error) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={card}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          Nowe konto
        </ThemedText>
        <TextField
          label="Nazwa widoczna dla znajomych"
          value={name}
          onChangeText={setName}
          maxLength={30}
          error={errors.create}
        />
        <Button
          title="Załóż konto"
          onPress={() => void create()}
          loading={busy === 'create'}
          disabled={busy != null || !name.trim()}
        />
      </View>

      <View style={card}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          Mam już konto
        </ThemedText>
        <TextField
          label="Kod odzyskiwania"
          placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
          value={code}
          onChangeText={setCode}
          error={errors.recover}
          {...codeFieldProps}
        />
        <Button
          title="Odzyskaj konto"
          variant="secondary"
          onPress={() => void recover()}
          loading={busy === 'recover'}
          disabled={busy != null || !code.trim()}
        />
      </View>
    </ScrollView>
  );
}

/* -------------------------------------------------------------- signed in */

function SignedIn({ account, revealCode }: { account: Account; revealCode: boolean }) {
  const theme = useTheme();

  const [people, setPeople] = useState<Person[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [friendCode, setFriendCode] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | undefined>();

  const [newName, setNewName] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | undefined>();
  const [revealed, setRevealed] = useState(revealCode);
  const [busy, setBusy] = useState(false);

  // Our own numbers go up first, so the row marked "ty" is today's.
  const load = useCallback(async () => {
    await syncStats();

    try {
      setPeople(await fetchLeaderboard(account, Date.now()));
      setLoadError(null);
    } catch (error) {
      setLoadError(failure(error));
    }
  }, [account]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const add = async () => {
    setAdding(true);
    setAddError(undefined);

    try {
      await addFriend(account, friendCode);
      setFriendCode('');
      await load();
    } catch (error) {
      setAddError(failure(error));
    } finally {
      setAdding(false);
    }
  };

  /** Runs one account action, saving what it returns; an error goes to an alert. */
  const act = async (title: string, run: () => Promise<Account | null | void>) => {
    setBusy(true);

    try {
      const next = await run();
      if (next !== undefined) await saveAccount(next);
    } catch (error) {
      tell(title, failure(error));
    } finally {
      setBusy(false);
    }
  };

  const unfriend = (person: Person) =>
    confirm(
      'Usunąć ze znajomych?',
      `${person.name} zniknie z twojego rankingu, a ty z rankingu tej osoby.`,
      'Usuń',
      () =>
        void act('Nie usunięto', async () => {
          await removeFriend(account, person.id);
          setExpanded(null);
          await load();
        }),
      true
    );

  const saveName = () =>
    void (async () => {
      setNameError(undefined);

      try {
        await saveAccount(await renameAccount(account, newName ?? ''));
        setNewName(null);
      } catch (error) {
        setNameError(failure(error));
      }
    })();

  const card = [styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }];

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
      <View style={card}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          Ranking · ten tydzień
        </ThemedText>

        {people == null ? (
          loadError ? (
            <>
              <ThemedText type="small" style={{ color: theme.danger }}>
                {loadError}
              </ThemedText>
              <Button title="Spróbuj ponownie" variant="secondary" onPress={() => void refresh()} />
            </>
          ) : (
            <ActivityIndicator style={styles.spinner} />
          )
        ) : (
          <>
            {loadError ? (
              <ThemedText type="small" style={{ color: theme.danger }}>
                {loadError}
              </ThemedText>
            ) : null}
            {people.map((person, index) => (
              <Row
                key={person.id}
                place={index + 1}
                person={person}
                open={expanded === person.id}
                onToggle={() => setExpanded(expanded === person.id ? null : person.id)}
                onRemove={() => unfriend(person)}
              />
            ))}
            {people.length <= 1 ? (
              <ThemedText type="small" themeColor="textSecondary">
                Jeszcze nikogo tu nie ma.
              </ThemedText>
            ) : null}
          </>
        )}
      </View>

      <View style={card}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          Dodaj znajomego
        </ThemedText>
        <TextField
          label="Kod znajomego"
          placeholder="XXXX-XXXX"
          value={friendCode}
          onChangeText={setFriendCode}
          error={addError}
          {...codeFieldProps}
        />
        <Button
          title="Dodaj"
          onPress={() => void add()}
          loading={adding}
          disabled={adding || !friendCode.trim()}
        />
      </View>

      <View style={card}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          Twój kod dla znajomych
        </ThemedText>
        <ThemedText style={styles.code} selectable>
          {account.friendCode}
        </ThemedText>
        <View style={styles.buttons}>
          <Button
            title="Udostępnij"
            variant="secondary"
            style={styles.grow}
            onPress={() => void Share.share({ message: `Mój kod znajomego w fiszkach: ${account.friendCode}` })}
          />
          <Button
            title="Nowy kod"
            variant="ghost"
            style={styles.grow}
            disabled={busy}
            onPress={() =>
              confirm(
                'Wygenerować nowy kod?',
                'Stary kod przestanie działać. Znajomi, których już masz, zostają.',
                'Nowy kod',
                () => void act('Nie zmieniono kodu', () => replaceFriendCode(account))
              )
            }
          />
        </View>
      </View>

      <View style={card}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          Konto
        </ThemedText>

        {newName == null ? (
          <View style={styles.nameRow}>
            <ThemedText style={styles.name}>{account.name}</ThemedText>
            <Button title="Zmień nazwę" variant="ghost" onPress={() => setNewName(account.name)} />
          </View>
        ) : (
          <>
            <TextField label="Nazwa" value={newName} onChangeText={setNewName} maxLength={30} error={nameError} />
            <View style={styles.buttons}>
              <Button title="Zapisz" style={styles.grow} disabled={!newName.trim()} onPress={saveName} />
              <Button
                title="Anuluj"
                variant="ghost"
                style={styles.grow}
                onPress={() => {
                  setNewName(null);
                  setNameError(undefined);
                }}
              />
            </View>
          </>
        )}

        {revealed ? (
          <View style={[styles.secret, { backgroundColor: theme.backgroundHighlight }]}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              Kod odzyskiwania
            </ThemedText>
            <ThemedText style={styles.code} selectable>
              {account.recoveryCode}
            </ThemedText>
            {/* The one line of explanation on this screen, on purpose: a lost
                code is a lost account, and nothing else on the screen says so. */}
            <ThemedText type="small" themeColor="textSecondary">
              Zapisz go — tylko nim odzyskasz konto.
            </ThemedText>
            <View style={styles.buttons}>
              <Button
                title="Udostępnij"
                variant="secondary"
                style={styles.grow}
                onPress={() => void Share.share({ message: account.recoveryCode })}
              />
              <Button title="Ukryj" variant="ghost" style={styles.grow} onPress={() => setRevealed(false)} />
            </View>
          </View>
        ) : (
          <Button title="Pokaż kod odzyskiwania" variant="secondary" onPress={() => setRevealed(true)} />
        )}

        <Button
          title="Wyloguj z tego telefonu"
          variant="ghost"
          disabled={busy}
          onPress={() =>
            confirm(
              'Wylogować?',
              'Konto zostaje na serwerze. Wrócisz do niego tylko kodem odzyskiwania.',
              'Wyloguj',
              () => void act('Nie wylogowano', async () => null)
            )
          }
        />
        <Button
          title="Usuń konto"
          variant="danger"
          disabled={busy}
          onPress={() =>
            confirm(
              'Usunąć konto?',
              'Konto, twoje dni i znajomości znikną z serwera. Nauka na tym telefonie zostaje.',
              'Usuń',
              () =>
                void act('Nie usunięto konta', async () => {
                  try {
                    await deleteAccount(account);
                  } catch (error) {
                    // Already gone from the server: forgetting it here is all that is left.
                    if (!(error instanceof FriendsError && error.failure === 'unauthorized')) throw error;
                  }
                  return null;
                }),
              true
            )
          }
        />
      </View>
    </ScrollView>
  );
}

/* -------------------------------------------------------------------- row */

const daysLabel = (count: number) => `${count} ${pluralize(count, 'dzień', 'dni', 'dni')}`;

/** One person in the ranking; tapped, it opens their badges (and, for a friend, removal). */
function Row({
  place,
  person,
  open,
  onToggle,
  onRemove,
}: {
  place: number;
  person: Person;
  open: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const theme = useTheme();

  const details = [
    person.streak > 0 ? `seria ${daysLabel(person.streak)}` : null,
    person.todayMet ? 'cel dziś ✓' : null,
    person.studyMs > 0 ? formatDuration(person.studyMs) : null,
    person.badges.length > 0 ? `odznaki ${person.badges.length}` : null,
  ].filter(Boolean);

  const labels = person.badges.map(badgeLabel).filter((label): label is string => label != null);

  return (
    <View style={[styles.row, { borderTopColor: theme.border }]}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={`${place}. ${person.name}, ${person.goalDays} z 7 dni z celem`}
        style={({ pressed }) => [styles.rowMain, { opacity: pressed ? 0.6 : 1 }]}>
        <ThemedText style={styles.place} themeColor="textSecondary">
          {place}.
        </ThemedText>
        <View style={styles.grow}>
          <ThemedText style={[styles.personName, person.me ? { color: theme.accent } : null]}>
            {person.me ? `${person.name} (ty)` : person.name}
          </ThemedText>
          {details.length > 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              {details.join(' · ')}
            </ThemedText>
          ) : null}
        </View>
        <ThemedText style={[styles.score, person.goalDays > 0 ? { color: RatingColors.good } : null]}>
          {person.goalDays}/7
        </ThemedText>
      </Pressable>

      {open ? (
        <View style={styles.rowDetails}>
          {labels.length > 0 ? (
            <View style={styles.chips}>
              {labels.map((label) => (
                <View key={label} style={[styles.chip, { backgroundColor: theme.backgroundSelected }]}>
                  <ThemedText type="small">{label}</ThemedText>
                </View>
              ))}
            </View>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              Bez odznak
            </ThemedText>
          )}
          {person.me ? null : <Button title="Usuń ze znajomych" variant="danger" onPress={onRemove} />}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    padding: Spacing.three,
    gap: Spacing.three,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  spinner: {
    marginVertical: Spacing.four,
  },
  card: {
    padding: Spacing.three,
    gap: Spacing.two,
    borderRadius: Radius.large,
    borderWidth: StyleSheet.hairlineWidth,
  },
  code: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    letterSpacing: 1,
  },
  buttons: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  grow: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  name: {
    fontSize: 18,
    fontWeight: '600',
    flexShrink: 1,
  },
  secret: {
    padding: Spacing.three,
    gap: Spacing.two,
    borderRadius: Radius.medium,
  },
  row: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.two,
    gap: Spacing.two,
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  place: {
    width: 28,
    fontWeight: '600',
  },
  personName: {
    fontWeight: '600',
  },
  score: {
    fontSize: 20,
    fontWeight: '700',
  },
  rowDetails: {
    paddingLeft: 28 + Spacing.two,
    gap: Spacing.two,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  chip: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Radius.small,
  },
});
