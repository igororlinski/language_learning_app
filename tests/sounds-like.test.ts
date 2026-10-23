/**
 * How a foreign word sounds in Polish letters — the line that took a small
 * local model from 1–2 good keywords on nine words to 8–11 (2026-10-21).
 *
 * The words are the ones measured, and the expected sounds are the ones the
 * rules gave then: the measurement holds only as long as these do.
 */
import { hasSpellingRules, ipaToPolish, soundsLike } from '@/lib/sounds-like';

import { check, group } from './harness';

group('Brzmienie z regul pisowni');

const pt = (term: string) => soundsLike({ term, language: 'pt-PT' });
const es = (term: string) => soundsLike({ term, language: 'es' });

// The nine words from the measurement, and the sounds it was measured with.
check('janela → żanela', pt('janela'), 'żanela');
check('queijo → kejżu', pt('queijo'), 'kejżu');
check('sapato → sapatu', pt('sapato'), 'sapatu');
check('cozinha → kozinia', pt('cozinha'), 'kozinia');
check('cavalo → kawalu', pt('cavalo'), 'kawalu');
check('borboleta → borboleta', pt('borboleta'), 'borboleta');
check('chave → szaw (nie „kaw”)', pt('chave'), 'szaw');
check('perro → pero', es('perro'), 'pero');
check('mantequilla → mantekija', es('mantequilla'), 'mantekija');

check('portugalskie s przed spolgloska to sz', pt('escova'), 'eszkowa');
check('koncowe -os to usz', pt('gatos'), 'gatusz');
// The nasal diphthong must not lose its second letter to the final-o rule.
check('pão → pał', pt('pão'), 'pał');
check('hiszpanskie j to ch', es('jamón'), 'chamon');
check('hiszpanskie z to s', es('zapato'), 'sapato');
check('Meksyk czyta sie tak samo', soundsLike({ term: 'cerveza', language: 'es-MX' }), 'serbesa');

// A phrase is spelled word by word: the endings rules look at belong to words.
check('fraza slowo po slowie', pt('o gato'), 'u gatu');
check('wielka litera i interpunkcja nie przeszkadzaja', pt('Chave!'), 'szaw');

group('Brzmienie z zapisu IPA');

check('tʃ to cz, nie tsz', ipaToPolish('/tʃe/'), 'cze');
check('portugalskie /ʃav/', ipaToPolish('/ʃav/'), 'szaw');
check('akcent i nosowosc znikaja', ipaToPolish('/kuˈzĩɲɐ/'), 'kuzinia');
check('angielskie /tʃɛə/', ipaToPolish('/tʃɛə/'), 'czee');
check('kilka slow zostaje kilkoma', ipaToPolish('/o ˈɡatu/'), 'o gatu');
check('same znaki bez liter to brak', ipaToPolish('/ˈ./'), null);

group('Skad brac brzmienie');

// Rules beat the stored IPA: nobody knows who wrote it, and a small model's
// Portuguese IPA is wrong in exactly the way that hurts (`chave` → /kɐj/).
check(
  'reguly wygrywaja z zapisanym IPA',
  soundsLike({ term: 'chave', language: 'pt-PT', ipa: '/kɐj/' }),
  'szaw'
);
// Brazilian Portuguese has no rules here: its `te` is „czi", so the European
// ones would teach a wrong sound. The stored IPA is what it gets.
check('pt-BR nie ma regul', hasSpellingRules('pt-BR'), false);
check(
  'jezyk bez regul bierze IPA',
  soundsLike({ term: 'chave', language: 'pt-BR', ipa: '/ˈʃavi/' }),
  'szawi'
);
check('bez regul i bez IPA nie ma brzmienia', soundsLike({ term: 'chair', language: 'en-US' }), null);
check('puste IPA to brak IPA', soundsLike({ term: 'chair', language: 'en-US', ipa: '  ' }), null);
check('talia bez jezyka tez', soundsLike({ term: 'chave', language: null }), null);
