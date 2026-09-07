/**
 * Reading what a language model said, and refusing what it did not say.
 *
 * The prompt that produces these answers lives in the Worker, where it can be
 * rewritten by a redeploy. What is pinned down here is everything that has to
 * hold no matter which model is behind it or how it decides to wrap its JSON.
 */
import { requestMnemonic } from '@/lib/ai-mnemonic';
import {
  buildScenePrompt,
  mnemonicJson,
  parseMnemonicColumn,
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

check(
  'zapis i odczyt wracaja tym samym',
  parseMnemonicColumn(mnemonicJson({ keyword: 'komar', prompt: 'a mosquito eating' }))?.keyword,
  'komar'
);
check(
  'razem ze scena',
  parseMnemonicColumn(mnemonicJson({ keyword: 'komar', prompt: 'a mosquito eating' }))?.prompt,
  'a mosquito eating'
);

check('brak skojarzenia to null w kolumnie', mnemonicJson(null), null);
check('polowa skojarzenia tez', mnemonicJson({ keyword: 'komar', prompt: '  ' }), null);

// A row written by some future version must not be able to break the editor.
check('smieci w kolumnie czytaja sie jako brak', parseMnemonicColumn('{{{'), null);
check('null tez', parseMnemonicColumn(null), null);

group('Zadanie o skojarzenie');

const asked = await withStub(
  { status: 200, body: { success: true, result: { text: good } } },
  () =>
    requestMnemonic(
      {
        term: 'comer',
        termLanguages: ['portugalski'],
        meaning: 'jeść',
        meaningLanguages: ['polski'],
      },
      'https://w.example.dev'
    ).then((mnemonic) => mnemonic.keyword)
);

check('idzie na wlasna sciezke', asked.sent?.url, 'https://w.example.dev/mnemonic');
check('i wraca skojarzeniem', asked.outcome, 'komar');

const sent = JSON.parse(String(asked.sent?.init.body)) as Record<string, unknown>;

// The languages are what make the trick possible: a sound-alike has to be a
// word in the language the learner already speaks, and the model cannot know
// which that is by looking at two words.
check('slowo uczone jedzie jako term', sent.term, 'comer');
check('znaczenie jako meaning', sent.meaning, 'jeść');
check('z jezykiem slowa', JSON.stringify(sent.termLanguages), '["portugalski"]');
check('i jezykiem znaczenia', JSON.stringify(sent.meaningLanguages), '["polski"]');

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
    requestMnemonic(
      { term: '  ', termLanguages: [], meaning: 'jeść', meaningLanguages: [] },
      'https://w.example.dev'
    )
  ),
  'empty-prompt'
);
check(
  'bez znaczenia tez nie',
  await refusalOf(() =>
    requestMnemonic(
      { term: 'comer', termLanguages: [], meaning: '   ', meaningLanguages: [] },
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
      requestMnemonic(
        { term: 'comer', termLanguages: [], meaning: 'jeść', meaningLanguages: [] },
        'https://w.example.dev'
      )
    )
  ).outcome,
  'malformed'
);
