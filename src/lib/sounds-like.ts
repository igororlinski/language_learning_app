/**
 * How a foreign word sounds, spelled the way a Pole would spell it — `chave`
 * is „szaw", `queijo` is „kejżu".
 *
 * **Why this exists (measured 2026-10-21, `LMSTUDIO-EKSPERYMENTY.md`).** A
 * small local model cannot hear a foreign word: it reads the spelling, so
 * `chave` gets `kawa` and `cave` — everything starting with *c*, nothing with
 * *sz*. Handed the sound, it matches Polish words to it well: the line
 * `SOUNDS LIKE` in the request took gemma-4-e4b from 1–2 good Polish keywords
 * on nine words to 8–11, in the same ~30 s.
 *
 * **The sound must not come from that model.** Its Portuguese is wrong
 * (`chave` → /kɐj/), and a wrong sound leads it exactly where it points:
 * „kaj" gets `kajak`, a good association with a pronunciation the word does
 * not have. So the sound comes from the code — spelling rules where a language
 * has them, the card's stored IPA otherwise — or not at all.
 *
 * Approximate on purpose. Polish letters cannot spell a Portuguese reduced
 * vowel, and they do not need to: the model is looking for a word that sounds
 * *roughly* like this, and roughly is what a rule gets right every time.
 */

/** Lowercase Polish letters and nothing else — what a sound may be spelled in. */
const NOT_POLISH = /[^a-ząćęłńóśźż]/g;

const PT_VOWELS = 'aeiouáéíóúâêôãõ';

/**
 * European Portuguese. The upper-case letters are placeholders: a sound
 * already decided (`ch` → SZ) must not be decided again by a later rule that
 * looks for a plain `s`. Everything is lowered at the end.
 *
 * What it gets right is what matters most for a Pole: `ch`/`x` → sz, `j`/`g`
 * before e/i → ż, `nh`/`lh` → ni/li, `s` before a consonant or at the end →
 * sz, the final `o` → u and the final `e` silent.
 */
function portugueseWord(word: string): string {
  return word
    .replace(/ch/g, 'SZ')
    .replace(/lh/g, 'LI')
    .replace(/nh/g, 'NI')
    .replace(/qu(?=[eiéíê])/g, 'K')
    .replace(/gu(?=[eiéíê])/g, 'G')
    .replace(/qu/g, 'KŁ')
    .replace(/ç/g, 'S')
    .replace(/c(?=[eiéíê])/g, 'S')
    .replace(/g(?=[eiéíê])/g, 'Ż')
    .replace(/j/g, 'Ż')
    .replace(/x/g, 'SZ')
    .replace(/rr/g, 'R')
    .replace(/ss/g, 'S')
    .replace(new RegExp(`(?<=[${PT_VOWELS}])s(?=[${PT_VOWELS}])`, 'g'), 'Z')
    .replace(new RegExp(`s(?=$|[^${PT_VOWELS}])`, 'g'), 'SZ')
    .replace(/z$/, 'SZ')
    .replace(/c/g, 'K')
    .replace(/v/g, 'W')
    .replace(/h/g, '')
    // The nasal diphthongs before the final-vowel rules, which would otherwise
    // eat their second letter: `pão` is „pał", not „pau".
    .replace(/ões$/, 'OJSZ')
    .replace(/ão/g, 'AŁ')
    .replace(/o$/, 'U')
    .replace(/oSZ$/, 'USZ')
    .replace(/e$/, '')
    .replace(/ei/g, 'EJ')
    .replace(/ou/g, 'O')
    .replace(/[áàâã]/g, 'a')
    .replace(/[éê]/g, 'e')
    .replace(/í/g, 'i')
    .replace(/[óô]/g, 'o')
    .replace(/ú/g, 'u')
    .toLowerCase();
}

/**
 * Spanish, both the Spanish of Spain and of Mexico: `z` and `c` before e/i
 * are spelled „s" for either — Polish has no /θ/, and „s" is the nearest
 * thing it has.
 */
function spanishWord(word: string): string {
  return word
    .replace(/ch/g, 'CZ')
    .replace(/ll/g, 'J')
    .replace(/ñ/g, 'NI')
    .replace(/rr/g, 'R')
    .replace(/qu(?=[eié])/g, 'K')
    .replace(/gu(?=[eié])/g, 'G')
    .replace(/c(?=[eié])/g, 'S')
    .replace(/z/g, 'S')
    .replace(/g(?=[eié])/g, 'CH')
    .replace(/j/g, 'CH')
    .replace(/c/g, 'K')
    .replace(/v/g, 'B')
    .replace(/h/g, '')
    .replace(/y$/, 'I')
    .replace(/á/g, 'a')
    .replace(/é/g, 'e')
    .replace(/í/g, 'i')
    .replace(/ó/g, 'o')
    .replace(/[úü]/g, 'u')
    .toLowerCase();
}

/**
 * The languages whose spelling says how they sound, by code. Brazilian
 * Portuguese is missing on purpose: it says `te` as „czi" and the final `e`
 * as „i", so the European rules would teach it a wrong sound.
 */
const RULES: Record<string, (word: string) => string> = {
  'pt-PT': portugueseWord,
  es: spanishWord,
  'es-MX': spanishWord,
};

/** Whether a language's sound can be read off its spelling here. */
export const hasSpellingRules = (code: string | null | undefined): boolean =>
  !!code && code in RULES;

/** Word by word: the rules look at word endings, and a phrase has several. */
const byWord = (text: string, spell: (word: string) => string) =>
  text
    .toLowerCase()
    .split(/[\s\-–—/]+/)
    .map((word) => spell(word.replace(/[^\p{L}]/gu, '')).replace(NOT_POLISH, ''))
    .filter(Boolean)
    .join(' ');

/**
 * Broad IPA to Polish letters. Longest symbols first, so `tʃ` is „cz" before
 * `ʃ` alone could make it „tsz". Written for Portuguese and Spanish and wide
 * enough for the common English, French and German symbols; whatever it does
 * not know is dropped rather than guessed.
 */
const IPA_TO_POLISH: [string, string][] = [
  ['tʃ', 'cz'],
  ['dʒ', 'dż'],
  ['tɕ', 'ć'],
  ['dʑ', 'dź'],
  ['ʃ', 'sz'],
  ['ʒ', 'ż'],
  ['ɕ', 'ś'],
  ['ʑ', 'ź'],
  ['ɲ', 'ni'],
  ['ʎ', 'li'],
  ['ɾ', 'r'],
  ['ʁ', 'r'],
  ['ʀ', 'r'],
  ['ɹ', 'r'],
  ['x', 'ch'],
  ['χ', 'ch'],
  ['β', 'b'],
  ['ð', 'd'],
  ['ɣ', 'g'],
  ['θ', 's'],
  ['ɐ', 'a'],
  ['ɑ', 'a'],
  ['ʌ', 'a'],
  ['æ', 'e'],
  ['ə', 'e'],
  ['ɜ', 'e'],
  ['ɛ', 'e'],
  ['ø', 'e'],
  ['œ', 'e'],
  ['ɨ', ''],
  ['ɔ', 'o'],
  ['ɒ', 'o'],
  ['ʊ', 'u'],
  ['ɪ', 'i'],
  ['w', 'ł'],
  ['v', 'w'],
  ['ŋ', 'n'],
  ['ʝ', 'j'],
  ['ɫ', 'ł'],
  ['ɡ', 'g'],
];

/** What a transcription sounds like in Polish letters, or null when nothing is left. */
export function ipaToPolish(ipa: string): string | null {
  let sound = ipa
    .normalize('NFD')
    // Slashes, brackets, stress and length marks, and every combining mark
    // (nasal tilde, syllabic and non-syllabic ticks): none of them is a letter.
    .replace(/[/[\]ˈˌ.ːˑ:'‿]|\p{M}/gu, '')
    .normalize('NFC')
    .toLowerCase();

  for (const [symbol, letters] of IPA_TO_POLISH) sound = sound.split(symbol).join(letters);

  const words = sound
    .split(/\s+/)
    .map((word) => word.replace(NOT_POLISH, ''))
    .filter(Boolean);

  return words.length > 0 ? words.join(' ') : null;
}

/**
 * How the word sounds in Polish letters — or null, and then the request goes
 * without the line, which is still better than a wrong sound.
 *
 * Rules first, the stored IPA second, and that order is the lesson of the
 * measurement: nobody knows who wrote a card's IPA, and IPA written by the
 * same small model is wrong in exactly the way that hurts (`chave` → /kɐj/).
 * Rules for a language that has them are as good as a sound written by hand
 * (seven of nine words identical) and cost nothing.
 */
export function soundsLike({
  term,
  language,
  ipa,
}: {
  term: string;
  /** BCP-47 code of the word's language, or null when the deck says nothing. */
  language: string | null;
  /** The card's stored transcription of exactly this text, if there is one. */
  ipa?: string | null;
}): string | null {
  const spell = language ? RULES[language] : undefined;

  if (spell) return byWord(term, spell) || null;

  return ipa?.trim() ? ipaToPolish(ipa) : null;
}
