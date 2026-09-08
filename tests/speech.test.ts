/**
 * What gets read out loud and in which voice. Both decisions are made before
 * anything native is touched, which is exactly why they can be tested at all —
 * the engine itself is `expo-speech`, called from the components.
 */
import {
  matchVoice,
  MAX_SPEECH_LENGTH,
  soleCandidate,
  speechCandidates,
  speechText,
  speechVoice,
} from '@/lib/speech';

import { keptSpeech, speechMenu } from '@/components/speech-menu';

import { check, group } from './harness';

group('Co czyta wycofane pole wymowy');

// The overwhelmingly common field is added and never touched: it says the word
// being learned, which is the answer.
check('puste pole czyta odpowiedz', speechText('', 'janela'), 'janela');
check('a wpisany tekst wygrywa', speechText('a janela', 'janela'), 'a janela');
check('same spacje to nie tekst', speechText('   ', 'janela'), 'janela');
check('karta bez odpowiedzi nie ma czego czytac', speechText('', ''), '');

// A field left long by accident should not turn a review into a monologue.
check(
  'bardzo dlugi tekst jest przycinany',
  speechText('a'.repeat(500), '').length,
  MAX_SPEECH_LENGTH
);

group('Ktorym glosem czyta wycofane pole');

// The answer is the word being learned, and that is the one worth hearing —
// reading the learner's own question back at them teaches nothing.
check('czyta jezykiem odpowiedzi', speechVoice({ front: ['pl'], back: 'pt-PT' }), 'pt-PT');
check('a nie pytania', speechVoice({ front: ['pl'], back: null }), null);

// Silence beats confidence: `janela` read in Polish sounds like nothing and
// teaches something false, so the field says what is missing instead.
check('talia bez jezykow nie ma glosu', speechVoice({ front: [], back: null }), null);


group('Czy telefon ma glos');

const polish = ['pl-PL', 'en-US', 'pt-BR'];

check('kod bez regionu bierze dowolny region', matchVoice('pl', polish).status, 'exact');
check('kod z regionem chce swojego', matchVoice('pt-BR', polish).status, 'exact');

// The accent is wrong, the word is still said — worth a sentence, not a refusal.
const brazilian = matchVoice('pt-PT', polish);
check('inny region to wariant, nie brak', brazilian.status, 'variant');
check('i mowi ktory, tak jak pisze go katalog', brazilian.tag, 'pt-BR');

check('brak jezyka to brak', matchVoice('ja', polish).status, 'missing');
check('talia bez jezyka tez', matchVoice(null, polish).status, 'missing');

// The whole safety of the check: a phone that has not answered yet, or an
// engine that threw, must never disable a button that would have worked.
check('nieznana lista to nie brak', matchVoice('ja', null).status, 'unknown');

// Engines report tags in whatever shape they like.
check('podkreslnik i wielkosc liter nie przeszkadzaja', matchVoice('pt-BR', ['PT_br']).status, 'exact');

group('Ktore jezyki wchodza w gre');

/**
 * Which languages a text could be read in is the deck's own declaration,
 * narrowed by which of its texts this is — and the **length** of what comes
 * back is the whole design. One candidate is an answer, and the editor uses it
 * without asking. Several is a real question, and then the user picks.
 */
const bilingual = { front: ['pl', 'en-US'], back: 'pt-PT' };

check('odpowiedz to jeden jezyk — ten uczony', speechCandidates('answer', bilingual), ['pt-PT']);
check('pytanie to jezyki, ktorymi uczacy sie wlada', speechCandidates('question', bilingual), [
  'pl',
  'en-US',
]);
// The association is written in one of the learner's own languages, so it asks
// exactly the question the question side asks.
check('skojarzenie pyta tak samo jak pytanie', speechCandidates('mnemonic', bilingual), [
  'pl',
  'en-US',
]);
// An extra field is the one text the deck says nothing about: an example in the
// language being learned is as likely as a note in the learner's own.
check('pole dodatkowe moze byc jednym i drugim', speechCandidates('free', bilingual), [
  'pl',
  'en-US',
  'pt-PT',
]);

// Never invented: a deck that has not said gets nothing, and the editor says
// what is missing instead of guessing.
check('talia bez jezykow nic nie proponuje', speechCandidates('free', { front: [], back: null }), []);
check('ani dla odpowiedzi', speechCandidates('answer', { front: ['pl'], back: null }), []);

group('Kiedy nie ma o co pytac');

// Asking somebody to confirm the only option is not a question.
check('jeden kandydat wlacza sie sam', soleCandidate(['pt-PT']), 'pt-PT');
check('dwa wymagaja wyboru', soleCandidate(['pl', 'en-US']), null);
// Picking the first of several would be picking for the user, and picking wrong
// is silent: a Portuguese word read in Polish still comes out of the speaker.
check('zero to tez brak wyboru', soleCandidate([]), null);


group('Trybik: co oferuje, gdy glosu jeszcze nie ma');

/**
 * The menu both editors hang off the gear. Its whole shape follows from the
 * number of candidates, so that is what is checked — not the wording.
 */
const menu = (
  scope: 'question' | 'answer' | 'mnemonic' | 'free',
  languages: { front: string[]; back: string | null },
  current: string | null
) => {
  const picked: (string | null)[] = [];
  let shown: { title: string; actions: { label: string; onPress: () => void }[] } | null = null;

  const actions = speechMenu({
    scope,
    languages,
    current,
    set: (code) => picked.push(code),
    show: (sheet) => {
      shown = sheet as typeof shown;
    },
  });

  return { actions, picked, sheet: () => shown };
};

// One candidate is not a question: asking would be asking somebody to confirm
// the only option, so the tap sets it and the sheet closes.
const single = menu('answer', { front: ['pl'], back: 'pt-PT' }, null);

check('jeden kandydat: jedna pozycja', single.actions.length, 1);
check('nie trzyma arkusza otwartego', single.actions[0]?.keepOpen, false);
single.actions[0]?.onPress();
check('i od razu ustawia jedyny jezyk', single.picked, ['pt-PT']);

// Several is a real question, so the same tap swaps the sheet for the list.
const many = menu('question', { front: ['pl', 'en-US'], back: 'pt-PT' }, null);

check('kilku kandydatow: arkusz zostaje otwarty', many.actions[0]?.keepOpen, true);
many.actions[0]?.onPress();
check('nic nie zostalo wybrane za uzytkownika', many.picked, []);
check('a lista ma tyle pozycji, ile jezykow', many.sheet()?.actions.length, 2);
many.sheet()?.actions[1]?.onPress();
check('wybor z listy ustawia wskazany', many.picked, ['en-US']);

// None: the entry stays, greyed out, saying what is missing — a menu that
// quietly drops items teaches the user the feature does not exist.
const none = menu('free', { front: [], back: null }, null);

check('bez jezykow pozycja zostaje', none.actions.length, 1);
check('ale jest wyszarzona', none.actions[0]?.disabled, true);
check('i mowi czego brakuje', Boolean(none.actions[0]?.hint), true);

group('Trybik: co oferuje, gdy glos juz jest');

const on = menu('question', { front: ['pl', 'en-US'], back: 'pt-PT' }, 'pl');

check('mozna zmienic jezyk i wylaczyc', on.actions.length, 2);
on.actions[1]?.onPress();
check('wylaczenie czysci jezyk', on.picked, [null]);

// Nothing else to move to, so there is nothing to offer beyond turning it off.
const onlyOne = menu('answer', { front: ['pl'], back: 'pt-PT' }, 'pt-PT');

check('jedyny kandydat to juz ustawiony: sama rezygnacja', onlyOne.actions.length, 1);

// Unless the deck has since been changed, and the one language it now declares
// is not the one this field speaks — then there is somewhere to go after all.
const stale = menu('answer', { front: ['pl'], back: 'es' }, 'pt-PT');

check('nieaktualny jezyk ma dokad wrocic', stale.actions.length, 2);

group('Domyslna talii nie moze nazywac jezyka, ktorego talia nie deklaruje');

/**
 * Only deck defaults are pruned. A card's own language is a fact about that
 * card; a deck's is a rule waiting to be applied to cards that do not exist
 * yet, and a rule naming a language the deck does not declare would go on
 * handing every new card a voice nothing on the deck claims.
 */
const declared = { front: ['pl', 'en-US'], back: 'pt-PT' };

check('zadeklarowany zostaje', keptSpeech('question', declared, 'en-US'), 'en-US');
check('niezadeklarowany wypada', keptSpeech('question', declared, 'de'), null);
// Dropping beats re-pointing: "you removed English, have Polish instead" is a
// guess, and a guess about pronunciation is silent when it is wrong.
check('jezyk odpowiedzi nie wchodzi w pytanie', keptSpeech('question', declared, 'pt-PT'), null);
check('brak zostaje brakiem', keptSpeech('answer', declared, null), null);
