/**
 * What a speech field reads and in which voice. Both decisions are made before
 * anything native is touched, which is exactly why they can be tested at all —
 * the engine itself is `expo-speech`, called from the components.
 */
import { matchVoice, MAX_SPEECH_LENGTH, speechText, speechVoice } from '@/lib/speech';

import { check, group } from './harness';

group('Co czyta pole wymowy');

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

group('Ktorym glosem');

// The answer is the word being learned, and that is the one worth hearing —
// reading the learner's own question back at them teaches nothing.
check('czyta jezykiem odpowiedzi', speechVoice({ front: ['pl'], back: ['pt-PT'] }), 'pt-PT');
check('a nie pytania', speechVoice({ front: ['pl'], back: [] }), null);

// Silence beats confidence: `janela` read in Polish sounds like nothing and
// teaches something false, so the field says what is missing instead.
check('talia bez jezykow nie ma glosu', speechVoice({ front: [], back: [] }), null);
check('kilka jezykow — pierwszy', speechVoice({ front: [], back: ['es', 'pt-PT'] }), 'es');

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
