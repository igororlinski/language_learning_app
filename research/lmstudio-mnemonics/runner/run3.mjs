// Phase 3: where the "sounds like" hint comes from, automatically.
// Usage: node run3.mjs <configs.json> <out.jsonl>
// cfg.source: 'ipa' (gemma IPA -> Polish spelling in code) | 'direct' (gemma writes Polish spelling)
import fs from 'node:fs';
import { mnemonicPrompt, phoneticPrompt, parseMnemonicList, parsePhonetic } from '../exp/lib3.mjs';
import { ptToPolish, esToPolish } from './rules.mjs';

const [, , configsPath, outPath] = process.argv;
const { words, configs } = JSON.parse(fs.readFileSync(configsPath, 'utf8'));
const URL = 'http://localhost:1234/v1/chat/completions';
const MODEL = 'google/gemma-4-e4b';

async function chat(messages, temperature, extra = {}) {
  const t0 = Date.now();
  const r = await fetch(URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(400000),
    body: JSON.stringify({ model: MODEL, messages, temperature, max_tokens: 4096, reasoning_effort: 'none', ...extra }),
  });
  const j = await r.json();
  const text = String(j.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  return { text, ms: Date.now() - t0 };
}

/** IPA (pt / es, broad) to how a Pole would spell it. Deterministic, lossy on purpose. */
export function ipaToPolish(ipa) {
  let s = ipa.normalize('NFD').replace(/[\/\[\]ˈˌ.ː:]/g, '').replace(/̃/g, '').normalize('NFC');
  const pairs = [
    ['tʃ', 'cz'], ['dʒ', 'dż'], ['ʃ', 'sz'], ['ʒ', 'ż'], ['ɲ', 'ni'], ['ʎ', 'li'], ['ɾ', 'r'], ['ʁ', 'r'],
    ['x', 'ch'], ['β', 'b'], ['ð', 'd'], ['ɣ', 'g'], ['θ', 's'], ['ɐ', 'a'], ['ə', 'e'], ['ɨ', ''], ['ɛ', 'e'],
    ['ɔ', 'o'], ['ʊ', 'u'], ['ɪ', 'i'], ['w', 'ł'], ['v', 'w'], ['ŋ', 'n'], ['ʝ', 'j'], ['ɫ', 'ł'], ['ɡ', 'g'],
  ];
  for (const [a, b] of pairs) s = s.split(a).join(b);
  return s.replace(/\s+/g, ' ').trim();
}

const directPrompt = (term, language) => [
  { role: 'system', content: [
    'You tell a Polish reader how to pronounce a foreign word.',
    'Write the word as it SOUNDS when a native speaker of the given language variety says it,',
    'spelled with Polish letters and Polish spelling rules, so that a Pole reading it aloud says it right.',
    'Use sz, cz, ż, ch, w, j, ł, ni the Polish way. Do not keep the foreign spelling.',
    'Answer as JSON: {"sounds": "..."}. Nothing else.',
  ].join('\n') },
  { role: 'user', content: 'Language: Portuguese (European)\nWord: comer' },
  { role: 'assistant', content: '{"sounds":"kumer"}' },
  { role: 'user', content: 'Language: English\nWord: chair' },
  { role: 'assistant', content: '{"sounds":"czer"}' },
  { role: 'user', content: `Language: ${language}\nWord: ${term}` },
];

function withSounds(prompt, sounds) {
  const turns = prompt.turns.map((t, i) => {
    if (t.role !== 'user') return t;
    const next = prompt.turns[i + 1];
    const s = next ? JSON.parse(next.content)[0].sounds : sounds;
    return { ...t, content: t.content.replace('\nMEANING', `\nSOUNDS LIKE: ${s}\nMEANING`) };
  });
  return [{ role: 'system', content: prompt.system }, ...turns];
}

for (const cfg of configs) {
  for (const w of words) {
    const rec = { cfg: cfg.name, term: w.term, meaning: w.meaning };
    try {
      let sounds, soundsMs, ipa;
      if (cfg.source === 'rules') {
        sounds = w.termLanguage === 'Spanish' ? esToPolish(w.term) : ptToPolish(w.term);
        soundsMs = 0;
      } else if (cfg.source === 'ipa') {
        const p = phoneticPrompt({ text: w.term, language: w.termLanguage });
        const r = await chat([{ role: 'system', content: p.system }, ...p.turns], 0.2);
        ipa = parsePhonetic(r.text);
        sounds = ipa ? ipaToPolish(ipa) : w.term;
        soundsMs = r.ms;
      } else {
        const r = await chat(directPrompt(w.term, w.termLanguage), 0.2);
        const m = r.text.match(/"sounds"\s*:\s*"([^"]*)"/);
        sounds = m ? m[1] : w.term;
        soundsMs = r.ms;
      }
      const prompt = mnemonicPrompt({ ...w, meaningLanguages: ['Polish'] });
      const r = await chat(withSounds(prompt, sounds), cfg.temperature ?? 0.7);
      const list = parseMnemonicList(r.text);
      Object.assign(rec, {
        ipa, sounds, soundsMs, ms: r.ms + soundsMs, ok: list.length,
        items: list.map((m) => ({ k: m.keyword, s: m.sentence })), raw: list.length ? undefined : r.text.slice(0, 300),
      });
    } catch (e) {
      rec.error = String(e);
    }
    fs.appendFileSync(outPath, JSON.stringify(rec) + '\n');
    console.log(rec.cfg, rec.term, rec.ipa ?? '', '→', rec.sounds, rec.soundsMs, rec.ms, (rec.items ?? []).map((i) => i.k).join(' | '));
  }
}
