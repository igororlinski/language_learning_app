/**
 * Reading what a language model said, and refusing what it did not say.
 *
 * The prompt that produces these answers lives in `src/lib/ai-prompts.ts`.
 * What is pinned down here is everything that has to
 * hold no matter which model is behind it or how it decides to wrap its JSON.
 */
import { requestMnemonics } from '@/lib/ai-mnemonic';
import { NO_KEYS } from '@/lib/ai-keys';
import { CLOUD_TEXT } from '@/lib/ai-transport';
import {
  buildScenePrompt,
  mnemonicJson,
  parseMnemonicColumn,
  parseMnemonicList,
  parseMnemonicText,
} from '@/lib/mnemonic';

import { bodyOf, withStub } from './ai-transport.test';
import { check, group } from './harness';

group('Odczyt skojarzenia od modelu');

const good = '{"keyword":"komar","sentence":"Komar je kanapkę.","prompt":"a mosquito eating"}';

check('czyste JSON-owe skojarzenie', parseMnemonicText(good)?.keyword, 'komar');
check('ze zdaniem', parseMnemonicText(good)?.sentence, 'Komar je kanapkę.');
check('i scena po angielsku', parseMnemonicText(good)?.prompt, 'a mosquito eating');

// A model told to answer with JSON will sooner or later wrap it in a code fence
// or clear its throat first. None of that is worth failing over.
check(
  'JSON w plotku kodu',
  parseMnemonicText('```json\n' + good + '\n```')?.keyword,
  'komar'
);
check(
  'JSON po zdaniu wstepu',
  parseMnemonicText('Oczywiscie! Oto skojarzenie:\n' + good)?.keyword,
  'komar'
);
check('bialy szum wokol', parseMnemonicText(`\n\n  ${good}  \n`)?.sentence, 'Komar je kanapkę.');

// Asked for one object, a model sometimes answers with a run of them until it
// runs out of tokens — ten of them for `queso` on 2026-09-07. Cutting to the
// last brace fed `JSON.parse` the whole pile and lost a usable first answer.
const second = '{"keyword":"koza","sentence":"Koza je ser.","prompt":"a goat"}';

check('pierwszy z kilku obiektow', parseMnemonicText(`${good}\n${second}`)?.keyword, 'komar');
check(
  'dziesiec obiektow pod rzad',
  parseMnemonicText(Array(10).fill(second).join('\n'))?.keyword,
  'koza'
);
check(
  'obiekt uciety w polowie nie jest odpowiedzia',
  parseMnemonicText(`${good}\n{"keyword":"koza","sentence":`)?.keyword,
  'komar'
);
check('gadanie po JSON-ie', parseMnemonicText(`${good}\nMam nadzieje, ze pomoglem!`)?.keyword, 'komar');

// The prompt asks the model to spell the foreign word out phonetically before
// it picks a keyword. That working-out arrives as a field nothing here reads.
check(
  'nieznane pola sa ignorowane',
  parseMnemonicText('{"sounds":"komer","keyword":"komar","sentence":"Komar je.","prompt":"a mosquito"}')?.keyword,
  'komar'
);

// A brace inside a sentence must not end the object early.
check(
  'klamra w zdaniu nie konczy obiektu',
  parseMnemonicText('{"keyword":"komar","sentence":"Komar je { kanapkę.","prompt":"a mosquito"}')?.sentence,
  'Komar je { kanapkę.'
);

group('Trzy propozycje do wyboru');

const three =
  '[' +
  '{"keyword":"komar","sentence":"Komar je kanapkę.","prompt":"a mosquito eating"},' +
  '{"keyword":"komin","sentence":"Komin je węgiel.","prompt":"a chimney"},' +
  '{"keyword":"komoda","sentence":"Komoda je talerze.","prompt":"a chest of drawers"}' +
  ']';

check('tablica trzech daje trzy', parseMnemonicList(three).length, 3);
check('w kolejności modelu', parseMnemonicList(three)[0]?.keyword, 'komar');
check('do ostatniej', parseMnemonicList(three)[2]?.keyword, 'komoda');

// The fallback path has no schema holding it to an array, so three objects
// back to back have to read the same as three inside brackets.
const looseThree = [good, second, '{"keyword":"kosa","sentence":"Kosa tnie ser.","prompt":"a scythe"}'].join('\n');

check('trzy obiekty bez tablicy tez', parseMnemonicList(looseThree).length, 3);
check('i w tej samej kolejności', parseMnemonicList(looseThree)[1]?.keyword, 'koza');

// Fewer than three is not a failure worth throwing away: two good options
// still beat an error message.
check('dwa to nadal odpowiedź', parseMnemonicList(`${good}\n${second}`).length, 2);
check('jeden też', parseMnemonicList(good).length, 1);
check('zero, gdy nie ma czego czytać', parseMnemonicList('nie wiem').length, 0);

// A broken object in the middle costs its own slot, not the ones after it.
check(
  'zepsuty w środku nie zabiera reszty',
  parseMnemonicList(`${good}\n{"keyword":"bez zdania"}\n${second}`).length,
  2
);

check('więcej niż proszono nie wraca', parseMnemonicList(Array(9).fill(second).join('\n')).length, 3);
check('a limit da się zawęzić', parseMnemonicList(three, 2).length, 2);

/** What `parseMnemonicText` gives back when the answer is not usable. */
const refused = (label: string, raw: string) => check(label, parseMnemonicText(raw), null);

// Two out of three is a field that looks filled in and cannot be rerolled,
// which is worse than one that plainly failed.
refused('bez slowa-klucza', '{"sentence":"Komar je.","prompt":"a mosquito"}');
refused('bez zdania', '{"keyword":"komar","prompt":"a mosquito"}');
refused('bez sceny po angielsku', '{"keyword":"komar","sentence":"Komar je."}');
refused('puste pola nie licza sie', '{"keyword":"  ","sentence":"Komar je.","prompt":"a mosquito"}');
refused('tablica zamiast obiektu', '["komar"]');
refused('niedomkniety obiekt', '{"keyword":"komar","sentence":');
refused('smieci', 'nie wiem, o co chodzi');
refused('pusty tekst', '');

group('Prompt sceny');

const scene = buildScenePrompt('a giant mosquito eating a sandwich');

check('scena trafia do promptu', scene.includes('a giant mosquito eating a sandwich'), true);
check('i zakaz tekstu na obrazie', scene.includes('No text'), true);

// The single-subject rule from `ai-image` is exactly wrong here: the whole
// point is two things meeting, and asking for one would drop half of every
// mnemonic.
check('scena NIE prosi o jeden obiekt', scene.includes('Single subject'), false);

group('Kolumna ze skojarzeniem');

const whole = { keyword: 'komar', prompt: 'a mosquito eating', sentence: 'Komar je kanapkę.' };

check('zapis i odczyt wracaja tym samym', parseMnemonicColumn(mnemonicJson(whole))?.keyword, 'komar');
check('razem ze scena', parseMnemonicColumn(mnemonicJson(whole))?.prompt, 'a mosquito eating');

// The sentence is kept here as well as in `value` so that a field can be
// switched between showing it and showing the word alone without asking the
// model for a second association.
check(
  'i ze zdaniem, zeby dalo sie wrocic',
  parseMnemonicColumn(mnemonicJson(whole))?.sentence,
  'Komar je kanapkę.'
);

// Rows written before a field could show the word alone have no sentence, and
// still redraw.
check(
  'stary wiersz bez zdania nadal sie czyta',
  parseMnemonicColumn('{"keyword":"komar","prompt":"a mosquito"}')?.keyword,
  'komar'
);
check(
  'a zdanie jest wtedy puste',
  parseMnemonicColumn('{"keyword":"komar","prompt":"a mosquito"}')?.sentence,
  ''
);

check('brak skojarzenia to null w kolumnie', mnemonicJson(null), null);
check('polowa skojarzenia tez', mnemonicJson({ ...whole, prompt: '  ' }), null);

// A row written by some future version must not be able to break the editor.
check('smieci w kolumnie czytaja sie jako brak', parseMnemonicColumn('{{{'), null);
check('null tez', parseMnemonicColumn(null), null);

group('Zadanie o skojarzenie');

const KEYS = { ...NO_KEYS, gemini: 'GKEY' };

/** What Gemini answers: the model's text inside its candidate. */
const geminiSays = (text: string) => ({
  status: 200,
  body: { candidates: [{ content: { parts: [{ text }] } }] },
});

const asked = await withStub(geminiSays(good), () =>
  requestMnemonics(
    {
      term: ' comer ',
      termLanguage: 'Portuguese (European)',
      meaning: 'jeść',
      meaningLanguages: ['Polish', '  ', 'English'],
    },
    CLOUD_TEXT,
    KEYS
  ).then((mnemonics) => mnemonics[0]?.keyword)
);

check('idzie do Gemini', asked.sent?.url.includes('generativelanguage.googleapis.com'), true);
check('i wraca skojarzeniem', asked.outcome, 'komar');

const contents = (bodyOf(asked.sent) as { contents?: { parts?: { text?: string }[] }[] }).contents ?? [];
const question = contents[contents.length - 1]?.parts?.[0]?.text;

// The languages are what make the trick possible: a sound-alike has to be a
// word in the language the learner already speaks, and the model cannot know
// which that is by looking at two words. The ranking is an instruction, not a
// set: the model works down it, so blanks drop out and the order stays.
check(
  'ostatnie pytanie niesie slowo, znaczenie i ranking jezykow',
  question,
  'FOREIGN (Portuguese (European)): comer\nMEANING: jeść\nKNOWN:\n1. Polish\n2. English'
);

// LM Studio gets the very same prompt — one set of words, never two copies.
const local = await withStub(
  { status: 200, body: { choices: [{ message: { content: good } }] } },
  () =>
    requestMnemonics(
      { term: 'comer', termLanguage: '', meaning: 'jeść', meaningLanguages: [] },
      { provider: 'lmstudio', model: 'qwen3-14b' },
      { ...NO_KEYS, lmStudioUrl: 'http://pc:1234' }
    ).then((mnemonics) => mnemonics[0]?.keyword)
);

check('LM Studio pytane wprost', local.sent?.url, 'http://pc:1234/v1/chat/completions');
check('a odpowiedz czyta sie tak samo', local.outcome, 'komar');

group('Skojarzenie z LM Studio: jeden jezyk i brzmienie');

const LM_KEYS = { ...NO_KEYS, lmStudioUrl: 'http://pc:1234' };
const LM_SOURCE = { provider: 'lmstudio', model: 'gemma' } as const;

/** What went to LM Studio for one request: its messages and temperature. */
async function lmStudioSent(request: Parameters<typeof requestMnemonics>[0]) {
  const { sent } = await withStub(
    { status: 200, body: { choices: [{ message: { content: good } }] } },
    () => requestMnemonics(request, LM_SOURCE, LM_KEYS)
  );
  const body = bodyOf(sent) as {
    messages?: { role: string; content: string }[];
    temperature?: number;
  };
  const messages = body.messages ?? [];

  return { messages, last: messages[messages.length - 1]?.content, temperature: body.temperature };
}

const chave = {
  term: 'chave',
  termLanguage: 'Portuguese (European)',
  meaning: 'klucz',
  meaningLanguages: ['Polish', 'English'],
};

const lm = await lmStudioSent(chave);

// Measured 2026-10-21: given two languages the small model drifts into English,
// and it reads spelling instead of hearing — `chave` got `kawa`. One language
// and the sound in Polish letters, together, are what fixed it.
check(
  'LM Studio dostaje tylko pierwszy jezyk i brzmienie z regul',
  lm.last,
  'FOREIGN (Portuguese (European)): chave\nSOUNDS LIKE: szaw\nMEANING: klucz\nKNOWN:\n1. Polish'
);
check(
  'przyklady tez niosa brzmienie',
  lm.messages[1]?.content,
  'FOREIGN (Portuguese): comer\nSOUNDS LIKE: komer\nMEANING: jeść\nKNOWN:\n1. Polish'
);
check('i temperature 0,7', lm.temperature, 0.7);

// Rules first: IPA on the card may have been written by the same small model.
check(
  'zapisane IPA nie przebija regul',
  (await lmStudioSent({ ...chave, termPhonetic: '/kɐj/' })).last?.includes('SOUNDS LIKE: szaw'),
  true
);
check(
  'jezyk bez regul bierze zapisane IPA',
  (
    await lmStudioSent({ ...chave, termLanguage: 'Portuguese (Brazilian)', termPhonetic: '/ˈʃavi/' })
  ).last?.includes('SOUNDS LIKE: szawi'),
  true
);
check(
  'bez regul i bez IPA nie ma linii, a jezyk dalej jeden',
  (await lmStudioSent({ ...chave, termLanguage: 'English (American)', term: 'key' })).last,
  'FOREIGN (English (American)): key\nMEANING: klucz\nKNOWN:\n1. Polish'
);

// The sound is spelled the Polish way, so it tells an English keyword nothing.
// This is "Przegeneruj w: angielski".
const english = await lmStudioSent({ ...chave, meaningLanguages: ['English'] });

check('po angielsku bez linii brzmienia', english.last?.includes('SOUNDS LIKE'), false);
check(
  'ani w przykladach',
  english.messages.some((message) => message.content.includes('SOUNDS LIKE')),
  false
);

// Gemini hears the word and uses the ranking well: it gets the prompt it had.
const cloud = await withStub(geminiSays(good), () =>
  requestMnemonics({ ...chave, termPhonetic: '/ʃav/' }, CLOUD_TEXT, KEYS)
);
const cloudBody = bodyOf(cloud.sent) as {
  contents?: { parts?: { text?: string }[] }[];
  generationConfig?: { temperature?: number };
};
const cloudTexts = (cloudBody.contents ?? []).map((turn) => turn.parts?.[0]?.text ?? '');

check(
  'Gemini bez zmian: caly ranking',
  cloudTexts[cloudTexts.length - 1],
  'FOREIGN (Portuguese (European)): chave\nMEANING: klucz\nKNOWN:\n1. Polish\n2. English'
);
check(
  'bez linii brzmienia nigdzie',
  cloudTexts.some((text) => text.includes('SOUNDS LIKE')),
  false
);
check('i z dawna temperatura', cloudBody.generationConfig?.temperature, 0.95);

group('Temperatura ustawiona przez uzytkownika');

const cloudWarm = await withStub(geminiSays(good), () =>
  requestMnemonics(chave, CLOUD_TEXT, KEYS, 1.2)
);

check(
  'Gemini dostaje temperature uzytkownika',
  (bodyOf(cloudWarm.sent) as { generationConfig?: { temperature?: number } }).generationConfig
    ?.temperature,
  1.2
);

const localCold = await withStub(
  { status: 200, body: { choices: [{ message: { content: good } }] } },
  () => requestMnemonics(chave, LM_SOURCE, LM_KEYS, 0)
);

// Zero is a temperature, not "unset": it must not fall back to 0.7.
check(
  'LM Studio tez, a zero to zero',
  (bodyOf(localCold.sent) as { temperature?: number }).temperature,
  0
);

/** The failure a request rejects with. */
async function refusalOf(call: () => Promise<unknown>) {
  try {
    await call();
    return 'nie odmowil';
  } catch (error) {
    return (error as { failure?: string }).failure ?? String(error);
  }
}

check(
  'bez slowa nie pyta',
  await refusalOf(() =>
    requestMnemonics(
      { term: '  ', termLanguage: '', meaning: 'jeść', meaningLanguages: [] },
      CLOUD_TEXT,
      KEYS
    )
  ),
  'empty-prompt'
);
check(
  'bez znaczenia tez nie',
  await refusalOf(() =>
    requestMnemonics(
      { term: 'comer', termLanguage: '', meaning: '   ', meaningLanguages: [] },
      CLOUD_TEXT,
      KEYS
    )
  ),
  'empty-prompt'
);

// The model answered, but not with an association: that has to fail as loudly
// as no answer at all, and carry its words so a phone can report them.
check(
  'odpowiedz nie bedaca skojarzeniem to blad',
  (
    await withStub(geminiSays('nie umiem'), () =>
      requestMnemonics(
        { term: 'comer', termLanguage: '', meaning: 'jeść', meaningLanguages: [] },
        CLOUD_TEXT,
        KEYS
      )
    )
  ).outcome,
  'malformed'
);

group('Z ktorych jezykow jest slowo-klucz');

/**
 * The model may reach past the first of the learner's languages, and when it
 * does it has to say so — the user is entitled to know that a hint leans on
 * their English rather than their Polish. Missing is fine: an association that
 * forgot to label itself is still a good association.
 */
const borrowed = parseMnemonicList(
  JSON.stringify([
    {
      sounds: 'kama',
      keyword: 'camel',
      keywordLanguages: ['English'],
      sentence: 'Camel śpi w łóżku.',
      prompt: 'a camel asleep in a bed',
    },
  ])
)[0];

check('jezyk klucza wraca', borrowed?.languages, ['English']);

/**
 * A keyword of two words, half in one language and half in another — what a
 * long foreign word gets matched with when no single word echoes it. Both
 * halves are named, in the order they carry the sound.
 */
const pair = parseMnemonicList(
  JSON.stringify([
    {
      sounds: 'opinionejtyd',
      keyword: 'opat nieto',
      keywordLanguages: ['Polish', 'Spanish'],
      sentence: 'Opat i nieto mają własne zdanie.',
      prompt: 'an abbot and a grandson arguing',
    },
  ])
)[0];

check('para zostaje jednym kluczem', pair?.keyword, 'opat nieto');
check('a oba jezyki wracaja', pair?.languages, ['Polish', 'Spanish']);

// Both halves from one language is the ordinary pair, and it says so once: the
// label answers "what does this lean on", not "how many words are there".
const samePair = parseMnemonicList(
  JSON.stringify([
    {
      sounds: 'opinionejtyd',
      keyword: 'opona notes',
      keywordLanguages: ['Polish', 'Polish'],
      sentence: 'Opona i notes mają własne zdanie.',
      prompt: 'a tyre and a notepad',
    },
  ])
)[0];

check('powtorzony jezyk liczy sie raz', samePair?.languages, ['Polish']);

group('Kiedy zdania po prostu nie ma');

/**
 * A pair split across two of the learner's languages belongs to neither, so
 * every sentence built on it is broken in one of them. There the two words and
 * the picture are the whole association, and the model is told to send no
 * sentence at all — which has to arrive as an association, not as a reject.
 */
const wordsOnly = parseMnemonicList(
  JSON.stringify([
    {
      sounds: 'opinionejtyd',
      keyword: 'opat nieto',
      keywordLanguages: ['Polish', 'Spanish'],
      sentence: '',
      prompt: 'an abbot and a grandson arguing',
    },
  ])
)[0];

check('para z dwoch jezykow zyje bez zdania', Boolean(wordsOnly), true);
check('i zostaje przy samych wyrazach', wordsOnly?.sentence, '');
check('a obraz da sie z niej zrobic', Boolean(wordsOnly?.prompt), true);

// Everywhere else a missing sentence is a model that stopped halfway, and a
// field that looks filled in but reads as nothing is worse than an honest fail.
const oneLanguageNoSentence = parseMnemonicList(
  JSON.stringify([
    {
      keyword: 'komar',
      keywordLanguages: ['Polish'],
      sentence: '',
      prompt: 'a mosquito eating',
    },
  ])
);

check('jeden jezyk bez zdania to brak odpowiedzi', oneLanguageNoSentence.length, 0);

// Same for a pair whose halves came from one language: it can be put in a
// sentence, so a missing one is a failure like any other.
const samePairNoSentence = parseMnemonicList(
  JSON.stringify([
    {
      keyword: 'opona notes',
      keywordLanguages: ['Polish', 'Polish'],
      sentence: '',
      prompt: 'a tyre and a notepad',
    },
  ])
);

check('para z jednego jezyka musi miec zdanie', samePairNoSentence.length, 0);

// The two that nothing can do without: one is what the learner remembers, the
// other is what draws the picture again.
check(
  'bez klucza nie ma skojarzenia',
  parseMnemonicList('[{"keywordLanguages":["Polish","Spanish"],"sentence":"","prompt":"a scene"}]').length,
  0
);
check(
  'bez sceny tez nie',
  parseMnemonicList('[{"keyword":"opat nieto","keywordLanguages":["Polish","Spanish"],"sentence":""}]').length,
  0
);

// The fallback model answers in free-form text with no schema holding it to
// anything, so the older single field is understood rather than dropped.
const older = parseMnemonicList(
  JSON.stringify([
    {
      keyword: 'komar',
      keywordLanguage: 'Polish',
      sentence: 'Komar je kanapkę.',
      prompt: 'a mosquito eating',
    },
  ])
)[0];

check('stara pojedyncza nazwa tez przechodzi', older?.languages, ['Polish']);

const unlabelled = parseMnemonicList(
  JSON.stringify([
    { sounds: 'kama', keyword: 'kamien', sentence: 'Kamien lezy na lozku.', prompt: 'a boulder' },
  ])
)[0];

// Not one of the parts a mnemonic needs: without it the field still shows, still
// redraws, and only the little language label goes missing.
check('brak jezyka nie uniewaznia skojarzenia', Boolean(unlabelled), true);
check('a samo pole jest puste', unlabelled?.languages, []);
