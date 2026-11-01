import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { Fragment, useCallback, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { Avatar } from '@/components/avatar';
import { Button } from '@/components/button';
import { HelpButton } from '@/components/help-button';
import { CheckIcon, FlameIcon, PencilIcon, PlusIcon, PodiumIcon } from '@/components/icons';
import { PersonDetails } from '@/components/person-details';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { FlameColors, Fonts, MaxContentWidth, Radius, RatingColors, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
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

/**
 * "Znajomi": an account on our server and friends added by code. Their
 * ranking is its own screen, opened from "Statystyki" (`ranking.tsx`) and
 * from the podium in this screen's header.
 *
 * Signed in, it reads top to bottom as: you and the code you hand out, the
 * people you added, and the account's housekeeping last — the recovery code,
 * signing out, deleting.
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

const shareFriendCode = (account: Account) =>
  void Share.share({ message: `Mój kod znajomego w fiszkach: ${account.friendCode}` });

export default function FriendsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const account = useAccount();
  // A brand-new account opens with its recovery code on show: it is the one
  // moment the user is sure to be looking.
  const [justCreated, setJustCreated] = useState(false);

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.screen, { backgroundColor: theme.background }]}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/ranking')}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Ranking ze znajomymi">
              <PodiumIcon size={22} color={theme.accent} />
            </Pressable>
          ),
        }}
      />
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

/** A card with a heading, and maybe something on the heading's right. */
function Card({ title, accessory, children }: { title?: string; accessory?: ReactNode; children: ReactNode }) {
  const theme = useTheme();

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      {title ? (
        <View style={styles.cardHeader}>
          <ThemedText style={styles.cardTitle}>{title}</ThemedText>
          {accessory}
        </View>
      ) : null}
      {children}
    </View>
  );
}

type Face = { id: string; name: string };

/** Two faces side by side — the picture for "you and someone else", drawn from the avatars. */
function Pair({ faces, size = 52 }: { faces: [Face, Face]; size?: number }) {
  const theme = useTheme();

  return (
    <View style={styles.pair}>
      <Avatar id={faces[0].id} name={faces[0].name} size={size} />
      <View style={[styles.pairSecond, { marginLeft: -size * 0.28, borderColor: theme.backgroundElement }]}>
        <Avatar id={faces[1].id} name={faces[1].name} size={size} />
      </View>
    </View>
  );
}

/** Someone not added yet: a question mark in a colour of its own. */
const SOMEONE: Face = { id: 'someone', name: '?' };

/* ---------------------------------------------------------------- sign in */

function SignIn({ onCreated }: { onCreated: () => void }) {
  const theme = useTheme();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'recover' | null>(null);
  const [errors, setErrors] = useState<{ create?: string; recover?: string }>({});

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
      <View style={[styles.welcome, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <Pair faces={[{ id: 'you', name: '?' }, SOMEONE]} size={56} />
        <View style={styles.welcomeTitle}>
          <ThemedText style={styles.welcomeText}>Ucz się razem ze znajomymi</ThemedText>
          <HelpButton topic="friends.about" />
        </View>
      </View>

      <Card title="Nowe konto">
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
      </Card>

      <Card title="Mam już konto">
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
      </Card>
    </ScrollView>
  );
}

/* -------------------------------------------------------------- signed in */

function SignedIn({ account, revealCode }: { account: Account; revealCode: boolean }) {
  const theme = useTheme();

  const [friends, setFriends] = useState<Person[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [friendCode, setFriendCode] = useState('');
  const [sending, setSending] = useState(false);
  const [addError, setAddError] = useState<string | undefined>();

  const [newName, setNewName] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | undefined>();
  const [revealed, setRevealed] = useState(revealCode);
  const [busy, setBusy] = useState(false);

  // The ranking is the one list of friends the server gives — this week's,
  // so the points beside a friend are this week's too. Ours go up first.
  const load = useCallback(async () => {
    await syncStats();

    try {
      const people = await fetchLeaderboard(account, Date.now());
      setFriends(
        people.filter((person) => !person.me).sort((a, b) => a.name.localeCompare(b.name, 'pl'))
      );
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
    setSending(true);
    setAddError(undefined);

    try {
      await addFriend(account, friendCode);
      setFriendCode('');
      setAdding(false);
      await load();
    } catch (error) {
      setAddError(failure(error));
    } finally {
      setSending(false);
    }
  };

  const closeAdding = () => {
    setAdding(false);
    setFriendCode('');
    setAddError(undefined);
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

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
      {/* You: who friends see, and the code you give them. */}
      <Card>
        {newName == null ? (
          <View style={styles.me}>
            <Avatar id={account.id} name={account.name} size={52} />
            <ThemedText style={styles.myName} numberOfLines={1}>
              {account.name}
            </ThemedText>
            <Pressable
              onPress={() => setNewName(account.name)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Zmień nazwę"
              style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.5 : 1 }]}>
              <PencilIcon size={18} color={theme.textSecondary} />
            </Pressable>
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

        <View style={[styles.codeBox, { backgroundColor: theme.backgroundTile }]}>
          <ThemedText type="small" themeColor="textSecondary">
            Twój kod dla znajomych
          </ThemedText>
          <ThemedText style={styles.code} selectable>
            {account.friendCode}
          </ThemedText>
        </View>
        <View style={styles.buttons}>
          <Button title="Udostępnij kod" style={styles.grow} onPress={() => shareFriendCode(account)} />
          <Button
            title="Nowy kod"
            variant="ghost"
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
      </Card>

      <Card
        title={`Znajomi${friends && friends.length > 0 ? ` · ${friends.length}` : ''}`}
        accessory={
          <Pressable
            onPress={() => (adding ? closeAdding() : setAdding(true))}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Dodaj znajomego"
            accessibilityState={{ expanded: adding }}
            style={({ pressed }) => [
              styles.addButton,
              { backgroundColor: adding ? theme.accent : theme.backgroundTile, opacity: pressed ? 0.6 : 1 },
            ]}>
            <PlusIcon
              size={16}
              color={adding ? theme.onAccent : theme.accent}
              style={adding ? styles.turned : undefined}
            />
          </Pressable>
        }>
        {adding ? (
          <View style={styles.addRow}>
            <View style={styles.grow}>
              <TextField
                label="Kod znajomego"
                placeholder="XXXX-XXXX"
                value={friendCode}
                onChangeText={setFriendCode}
                error={addError}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => (friendCode.trim() ? void add() : undefined)}
                {...codeFieldProps}
              />
            </View>
            <Button
              title="Dodaj"
              style={styles.addSend}
              onPress={() => void add()}
              loading={sending}
              disabled={sending || !friendCode.trim()}
            />
          </View>
        ) : null}

        {friends == null ? (
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

            {friends.map((person, index) => (
              <Fragment key={person.id}>
                {index > 0 ? <View style={[styles.rule, { backgroundColor: theme.border }]} /> : null}
                <FriendRow
                  person={person}
                  open={expanded === person.id}
                  onToggle={() => setExpanded(expanded === person.id ? null : person.id)}
                  onRemove={() => unfriend(person)}
                  busy={busy}
                />
              </Fragment>
            ))}

            {friends.length === 0 && !adding ? (
              <View style={styles.empty}>
                <Pair faces={[account, SOMEONE]} />
                <ThemedText style={styles.emptyTitle}>Dodaj pierwszą osobę</ThemedText>
                <View style={[styles.buttons, styles.stretch]}>
                  <Button title="Udostępnij kod" style={styles.grow} onPress={() => shareFriendCode(account)} />
                  <Button
                    title="Wpisz kod"
                    variant="secondary"
                    style={styles.grow}
                    onPress={() => setAdding(true)}
                  />
                </View>
              </View>
            ) : null}
          </>
        )}
      </Card>

      <Card title="Konto" accessory={<HelpButton topic="friends.about" />}>
        {revealed ? (
          <View style={[styles.secret, { backgroundColor: theme.backgroundHighlight }]}>
            <ThemedText type="small" themeColor="textSecondary">
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
          <View style={styles.settingRow}>
            <ThemedText style={styles.grow}>Kod odzyskiwania</ThemedText>
            <Button title="Pokaż" variant="secondary" onPress={() => setRevealed(true)} />
          </View>
        )}

        <View style={[styles.rule, { backgroundColor: theme.border }]} />

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
      </Card>
    </ScrollView>
  );
}

const daysLabel = (count: number) => `${count} ${pluralize(count, 'dzień', 'dni', 'dni')}`;

/**
 * One friend: their initial, their name, under it their streak and whether
 * today's goal is met, and this week's points on the right. Tapped, it opens
 * the same details as in the ranking, with removing them at the bottom — one
 * deliberate step away rather than a button on every row.
 */
function FriendRow({
  person,
  open,
  onToggle,
  onRemove,
  busy,
}: {
  person: Person;
  open: boolean;
  onToggle: () => void;
  onRemove: () => void;
  busy: boolean;
}) {
  return (
    <View style={styles.friend}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${person.name}, ${person.points} pkt w tym tygodniu`}
        style={({ pressed }) => [styles.friendMain, { opacity: pressed ? 0.6 : 1 }]}>
        <Avatar id={person.id} name={person.name} size={40} />
        <View style={styles.grow}>
          <ThemedText style={styles.friendName} numberOfLines={1}>
            {person.name}
          </ThemedText>
          <View style={styles.badges}>
            {person.streak > 0 ? (
              <View style={styles.badge}>
                <FlameIcon size={14} color={FlameColors.outer} core={FlameColors.inner} />
                <ThemedText type="small" themeColor="textSecondary">
                  {daysLabel(person.streak)}
                </ThemedText>
              </View>
            ) : null}
            {person.todayMet ? (
              <View style={styles.badge}>
                <CheckIcon size={14} color={RatingColors.good} />
                <ThemedText type="small" themeColor="textSecondary">
                  cel dziś
                </ThemedText>
              </View>
            ) : null}
            {person.streak === 0 && !person.todayMet ? (
              <ThemedText type="small" themeColor="textSecondary">
                bez serii
              </ThemedText>
            ) : null}
          </View>
        </View>
        <View style={styles.points}>
          <ThemedText style={styles.pointsValue}>{person.points}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            pkt w tyg.
          </ThemedText>
        </View>
      </Pressable>

      {open ? (
        <PersonDetails
          person={person}
          actions={
            <Button title="Usuń ze znajomych" variant="danger" disabled={busy} onPress={onRemove} />
          }
        />
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
    gap: Spacing.three,
    borderRadius: Radius.large,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 28,
  },
  cardTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
  welcome: {
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.four,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.large,
    borderWidth: StyleSheet.hairlineWidth,
  },
  welcomeTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  welcomeText: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    textAlign: 'center',
    flexShrink: 1,
  },
  pair: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // The card's colour round the second face, so the two read as two.
  pairSecond: {
    borderWidth: 3,
    borderRadius: 999,
  },
  me: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  myName: {
    flex: 1,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
  },
  iconButton: {
    padding: Spacing.one,
  },
  codeBox: {
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.three,
    borderRadius: Radius.medium,
  },
  code: {
    fontFamily: Fonts.mono,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    letterSpacing: 2,
    textAlign: 'center',
  },
  buttons: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  grow: {
    flex: 1,
  },
  addButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The plus turned into a cross while the field is open.
  turned: {
    transform: [{ rotate: '45deg' }],
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  // Level with the field under its label.
  addSend: {
    marginTop: 28,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
  },
  friend: {
    gap: Spacing.two,
  },
  friendMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  friendName: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
  },
  badges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginTop: Spacing.half,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  points: {
    alignItems: 'flex-end',
  },
  pointsValue: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  emptyTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
  },
  stretch: {
    alignSelf: 'stretch',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  secret: {
    padding: Spacing.three,
    gap: Spacing.two,
    borderRadius: Radius.medium,
  },
});
