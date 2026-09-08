/**
 * Reading what a language model said, and refusing what it did not say.
 *
 * The prompt that produces these answers lives in the Worker, where it can be
 * rewritten by a redeploy. What is pinned down here is everything that has to
 * hold no matter which model is behind it or how it decides to wrap its JSON.
 */
import { requestMnemonics } from '@/lib/ai-mnemonic';
import {
  buildScenePrompt,
  mnemonicJson,
  parseMnemonicColumn,
  parseMnemonicList,
  parseMnemonicText,
} from '@/lib/mnemonic';

import { withStub } from './ai-worker.test';
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

const asked = await withStub(
  { status: 200, body: { success: true, result: { text: good } } },
  () =>
    requestMnemonics(
      {
        term: 'comer',
        termLanguage: 'Portuguese (European)',
        meaning: 'jeść',
        meaningLanguages: ['polski'],
      },
      'https://w.example.dev'
    ).then((mnemonics) => mnemonics[0]?.keyword)
);

check('idzie na wlasna sciezke', asked.sent?.url, 'https://w.example.dev/mnemonic');
check('i wraca skojarzeniem', asked.outcome, 'komar');

const sent = JSON.parse(String(asked.sent?.init.body)) as Record<string, unknown>;

// The languages are what make the trick possible: a sound-alike has to be a
// word in the language the learner already speaks, and the model cannot know
// which that is by looking at two words.
check('slowo uczone jedzie jako term', sent.term, 'comer');
check('znaczenie jako meaning', sent.meaning, 'jeść');
// One language for the word being learned: it has one pronunciation, and both
// the voice that reads it and the sound a keyword must imitate follow from it.
check('z jednym jezykiem slowa', sent.termLanguage, 'Portuguese (European)');

// …and a ranking for the learner's own languages, in the deck's order. The list
// is an instruction, not a set: the model works down it.
check('i rankingiem jezykow znaczenia', JSON.stringify(sent.meaningLanguages), '["polski"]');

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
      'https://w.example.dev'
    )
  ),
  'empty-prompt'
);
check(
  'bez znaczenia tez nie',
  await refusalOf(() =>
    requestMnemonics(
      { term: 'comer', termLanguage: '', meaning: '   ', meaningLanguages: [] },
      'https://w.example.dev'
    )
  ),
  'empty-prompt'
);

// The model answered, but not with an association: that has to fail as loudly
// as no answer at all, and carry its words so a phone can report them.
check(
  'odpowiedz nie bedaca skojarzeniem to blad',
  (
    await withStub({ status: 200, body: { success: true, result: { text: 'nie umiem' } } }, () =>
      requestMnemonics(
        { term: 'comer', termLanguage: '', meaning: 'jeść', meaningLanguages: [] },
        'https://w.example.dev'
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
