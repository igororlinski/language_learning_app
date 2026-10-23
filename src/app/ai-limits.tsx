import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { Button } from '@/components/button';
import { Dropdown } from '@/components/dropdown';
import { OptionPicker, type PickerOption } from '@/components/option-picker';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { budgetColor, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import {
  aiUsageQuery,
  appSettingsQuery,
  setTextSource,
  setTextTemperature,
  textSourceFrom,
  textTemperaturesFrom,
} from '@/db/queries';
import { useNow } from '@/hooks/use-now';
import { useTheme } from '@/hooks/use-theme';
import {
  cleanKeys,
  hasCloudflare,
  hasGemini,
  hasLmStudio,
  NO_KEYS,
  type AiKeys,
} from '@/lib/ai-keys';
import { saveAiKeys, useAiKeys } from '@/lib/ai-keys-store';
import {
  formatTemperature,
  LOCAL_MNEMONIC_SHAPE,
  MNEMONIC_SHAPE,
  PHONETIC_SHAPE,
  TEMPERATURE_CHOICES,
  type TextTemperatures,
} from '@/lib/ai-prompts';
import { checkLmStudio, type LmStudioStatus } from '@/lib/ai-text';
import type { TextProvider } from '@/lib/ai-transport';
import { usageFrom, type AiBudget } from '@/lib/ai-usage';

/**
 * "Ustawienia AI": the user's own keys, who writes text and at what
 * temperature, and how much of today's free allowances this phone has spent.
 *
 * A fresh install lands here with nothing filled in, and every AI action in the
 * card editor stays greyed out until it is (`src/lib/ai-keys.ts`). The keys go
 * to the phone's secure storage (`ai-keys-store.ts`), the provider choice to the
 * database, and the meters read counters the phone keeps itself — so nothing on
 * this screen waits on a network except the one check that LM Studio answers.
 *
 * The route is still `ai-limits`: the screen grew, its address did not need to
 * move.
 */
export { ErrorScreen as ErrorBoundary } from '@/components/error-screen';

/** The Dropdown's value for "whatever LM Studio offers first". */
const FIRST_MODEL = '';

/** The Dropdown's value for "the provider's own temperature". */
const DEFAULT_TEMPERATURE = '';

/**
 * The temperature list, opening on "Domyślna (0,95)". The default names its
 * number because it is the one thing a user changing it needs to know — and it
 * depends on the provider, so it is worked out here rather than written down.
 */
const temperatureOptions = (fallback: number) => [
  { value: DEFAULT_TEMPERATURE, label: `Domyślna (${formatTemperature(fallback)})` },
  ...TEMPERATURE_CHOICES.map((t) => ({ value: String(t), label: formatTemperature(t) })),
];

const temperatureValue = (temperature: number | null) =>
  temperature == null ? DEFAULT_TEMPERATURE : String(temperature);

const chooseTemperature = (kind: keyof TextTemperatures) => (value: string) =>
  setTextTemperature(kind, value === DEFAULT_TEMPERATURE ? null : Number(value));

const sameKeys = (a: AiKeys, b: AiKeys) => JSON.stringify(cleanKeys(a)) === JSON.stringify(b);

export default function AiSettingsScreen() {
  const theme = useTheme();
  const saved = useAiKeys();
  const keys = saved ?? NO_KEYS;

  // What is typed, until it is saved. Null means "nothing typed yet" and shows
  // the saved keys, so a read that lands after the screen opened fills the form.
  const [draft, setDraft] = useState<AiKeys | null>(null);
  const form = draft ?? keys;
  const dirty = draft !== null && !sameKeys(draft, keys);
  const [savingKeys, setSavingKeys] = useState(false);

  const edit = (field: keyof AiKeys) => (value: string) =>
    setDraft((current) => ({ ...(current ?? keys), [field]: value }));

  const save = async () => {
    setSavingKeys(true);

    try {
      await saveAiKeys(form);
      setDraft(null);
    } finally {
      setSavingKeys(false);
    }
  };

  const { data: settings } = useLiveQuery(appSettingsQuery());
  const source = textSourceFrom(settings);
  const temperatures = textTemperaturesFrom(settings);

  const now = useNow();
  const { data: usageRows } = useLiveQuery(aiUsageQuery());
  const usage = usageFrom(usageRows, new Date(now));

  // LM Studio's answer, tagged with the address it came from: a result for an
  // address that has since changed is "not checked yet", not a stale verdict.
  const [studio, setStudio] = useState<{ url: string; status: LmStudioStatus } | null>(null);
  const [checkRound, setCheckRound] = useState(0);

  useEffect(() => {
    if (!hasLmStudio(keys)) return;

    let alive = true;

    // setState only in the callback, never in the effect body itself.
    checkLmStudio(keys).then((status) => {
      if (alive) setStudio({ url: keys.lmStudioUrl, status });
    });

    return () => {
      alive = false;
    };
  }, [keys, checkRound]);

  const local = studio && studio.url === keys.lmStudioUrl ? studio.status : null;

  const recheck = () => {
    setStudio(null);
    setCheckRound((round) => round + 1);
  };

  const cloudReady = hasGemini(keys) || hasCloudflare(keys);

  const providers: PickerOption<TextProvider>[] = [
    {
      value: 'cloud',
      label: 'Chmura',
      hint: cloudReady
        ? hasGemini(keys)
          ? hasCloudflare(keys)
            ? 'Gemini, awaryjnie llama na Cloudflare'
            : 'Gemini'
          : 'llama na Cloudflare'
        : 'Dodaj klucz Gemini albo Cloudflare',
      disabled: !cloudReady,
    },
    {
      value: 'lmstudio',
      label: 'LM Studio',
      hint: !hasLmStudio(keys)
        ? 'Wpisz adres LM Studio'
        : !local
          ? 'Sprawdzam połączenie…'
          : local.online
            ? 'Model na Twoim komputerze · połączono'
            : 'Model na Twoim komputerze · nie odpowiada',
      // Only a missing address makes it unpickable. A computer that is merely
      // off can be chosen ahead of switching it on.
      disabled: !hasLmStudio(keys),
    },
  ];

  const chooseProvider = (provider: TextProvider) =>
    setTextSource({ provider, model: provider === 'lmstudio' ? source.model : null });

  // The saved model stays in the list even when LM Studio no longer offers it
  // (unloaded, or the computer is off), so the field never shows a blank.
  const modelIds = [
    ...(source.model && !local?.models.includes(source.model) ? [source.model] : []),
    ...(local?.models ?? []),
  ];
  const modelOptions = [
    { value: FIRST_MODEL, label: 'Pierwszy załadowany' },
    ...modelIds.map((id) => ({ value: id, label: id })),
  ];

  const field = {
    autoCapitalize: 'none',
    autoCorrect: false,
    spellCheck: false,
  } as const;

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ThemedText type="smallBold" themeColor="textSecondary">
          Klucze
        </ThemedText>

        <TextField
          label="Klucz Gemini"
          value={form.gemini}
          onChangeText={edit('gemini')}
          placeholder="z aistudio.google.com"
          secureTextEntry
          {...field}
        />
        <TextField
          label="Cloudflare — ID konta"
          value={form.cloudflareAccount}
          onChangeText={edit('cloudflareAccount')}
          {...field}
        />
        <TextField
          label="Cloudflare — token API"
          value={form.cloudflareToken}
          onChangeText={edit('cloudflareToken')}
          placeholder="z uprawnieniem Workers AI"
          secureTextEntry
          {...field}
        />
        <TextField
          label="LM Studio — adres"
          value={form.lmStudioUrl}
          onChangeText={edit('lmStudioUrl')}
          placeholder="192.168.1.20:1234"
          keyboardType="url"
          {...field}
        />
        <TextField
          label="LM Studio — token"
          value={form.lmStudioToken}
          onChangeText={edit('lmStudioToken')}
          placeholder="opcjonalnie"
          secureTextEntry
          {...field}
        />

        <Button
          title={savingKeys ? 'Zapisuję…' : 'Zapisz klucze'}
          onPress={() => void save()}
          disabled={!dirty || savingKeys}
        />

        <View style={styles.section}>
          <OptionPicker
            label="Skojarzenia i zapis fonetyczny"
            value={source.provider}
            options={providers}
            onChange={chooseProvider}
          />
        </View>

        {source.provider === 'lmstudio' && hasLmStudio(keys) ? (
          <>
            {modelIds.length > 0 ? (
              <Dropdown
                label="Model"
                value={source.model ?? FIRST_MODEL}
                options={modelOptions}
                onChange={(model) => setTextSource({ provider: 'lmstudio', model: model || null })}
              />
            ) : null}
            <Button title="Sprawdź połączenie" variant="secondary" onPress={recheck} />
          </>
        ) : null}

        {cloudReady || hasLmStudio(keys) ? (
          <View style={[styles.section, styles.cards]}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              Temperatura
            </ThemedText>
            <Dropdown
              label="Skojarzenia"
              value={temperatureValue(temperatures.mnemonic)}
              options={temperatureOptions(
                source.provider === 'lmstudio'
                  ? LOCAL_MNEMONIC_SHAPE.temperature
                  : MNEMONIC_SHAPE.temperature
              )}
              onChange={chooseTemperature('mnemonic')}
            />
            <Dropdown
              label="Zapis fonetyczny"
              value={temperatureValue(temperatures.phonetic)}
              options={temperatureOptions(PHONETIC_SHAPE.temperature)}
              onChange={chooseTemperature('phonetic')}
            />
          </View>
        ) : null}

        {hasCloudflare(keys) || hasGemini(keys) ? (
          <View style={[styles.section, styles.cards]}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              Limity dzienne
            </ThemedText>
            {hasCloudflare(keys) ? <Meter title="Obrazy" budget={usage.images} /> : null}
            {hasGemini(keys) ? <Meter title="Skojarzenia (Gemini)" budget={usage.text} /> : null}
            <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
              Liczone na tym telefonie. Zerują się codziennie.
            </ThemedText>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * A labelled bar: the fill is how much is LEFT, and its colour warns as it
 * empties. Only the percentage is shown — the raw neuron/request counts are
 * deliberately left out, a percent is the whole answer the user asked for.
 */
function Meter({ title, budget }: { title: string; budget: AiBudget }) {
  const theme = useTheme();
  const color = budgetColor(budget.pctLeft);

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <View style={styles.meterHead}>
        <ThemedText style={styles.meterTitle}>{title}</ThemedText>
        <ThemedText style={[styles.meterPct, { color }]}>{budget.pctLeft}%</ThemedText>
      </View>

      <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
        <View style={[styles.fill, { width: `${budget.pctLeft}%`, backgroundColor: color }]} />
      </View>
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
  section: {
    marginTop: Spacing.three,
  },
  cards: {
    gap: Spacing.three,
  },
  card: {
    padding: Spacing.three,
    gap: Spacing.two,
    borderRadius: Radius.large,
    borderWidth: StyleSheet.hairlineWidth,
  },
  meterHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  meterTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  meterPct: {
    fontSize: 22,
    fontWeight: '700',
  },
  track: {
    height: 10,
    borderRadius: Radius.small,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: Radius.small,
  },
  note: {
    paddingHorizontal: Spacing.one,
  },
});
