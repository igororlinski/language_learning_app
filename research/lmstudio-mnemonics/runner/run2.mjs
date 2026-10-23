// Usage: node run2.mjs <configs.json> <out.jsonl>
// Like run.mjs, plus prompt variants: short, six, sounds, polishOnly.
import fs from 'node:fs';
import { mnemonicPrompt, MNEMONIC_SCHEMA, parseMnemonicList } from '../exp/lib.mjs';

const [, , configsPath, outPath] = process.argv;
const { words, configs } = JSON.parse(fs.readFileSync(configsPath, 'utf8'));
const URL = 'http://localhost:1234/v1/chat/completions';
const SHORT = fs.readFileSync(new globalThis.URL('./short.txt', import.meta.url), 'utf8');
const SOUNDS = {
  janela: 'żanela', queijo: 'kejżu', sapato: 'sapatu', cozinha: 'kuzinia', cavalo: 'kawalu',
  borboleta: 'burbuleta', chave: 'szaw', perro: 'pero', mantequilla: 'mantekija',
  obrigado: 'obrigadu', manzana: 'mansana', cerveja: 'serwejża', escova: 'eszkowa', sorvete: 'surwete',
};

const strip = (s) => {
  const { propertyOrdering, ...r } = s;
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v && typeof v === 'object' && !Array.isArray(v) ? strip(v) : v]));
};

function variant(p, cfg, w) {
  let system = cfg.short ? SHORT : p.system;
  let turns = p.turns;
  if (cfg.six) {
    system = system
      .replace('exactly THREE such objects', 'exactly SIX such objects')
      .replace('THREE DIFFERENT sound-alike', 'SIX DIFFERENT sound-alike')
      .replace('exactly THREE objects', 'exactly SIX objects')
      .replace('THREE DIFFERENT keywords', 'SIX DIFFERENT keywords');
  }
  if (cfg.sounds) {
    turns = turns.map((t, i) => {
      if (t.role !== 'user') return t;
      const next = turns[i + 1];
      const s = next ? JSON.parse(next.content)[0].sounds : SOUNDS[w.term];
      return { ...t, content: t.content.replace('\nMEANING', `\nSOUNDS LIKE: ${s}\nMEANING`) };
    });
  }
  if (cfg.exampleLimit != null) {
    // Keep only the first N examples (2 turns each) plus the final question.
    turns = [...turns.slice(0, cfg.exampleLimit * 2), turns[turns.length - 1]];
  }
  return { system, turns };
}

for (const cfg of configs) {
  for (const w of words) {
    const base = mnemonicPrompt(cfg.polishOnly ? { ...w, meaningLanguages: ['Polish'] } : w);
    const prompt = variant(base, cfg, w);
    const messages = [{ role: 'system', content: prompt.system }, ...prompt.turns];
    const body = { model: 'google/gemma-4-e4b', messages, temperature: cfg.temperature, max_tokens: cfg.max_tokens ?? 4096 };
    if (cfg.top_p != null) body.top_p = cfg.top_p;
    if (cfg.top_k != null) body.top_k = cfg.top_k;
    if (cfg.repeat_penalty != null) body.repeat_penalty = cfg.repeat_penalty;
    if (cfg.reasoning) body.reasoning_effort = cfg.reasoning;
    if (cfg.schema) body.response_format = { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema: strip(MNEMONIC_SCHEMA) } };
    const t0 = Date.now();
    let rec = { cfg: cfg.name, term: w.term, meaning: w.meaning };
    try {
      const r = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(400000) });
      const j = await r.json();
      const msg = j.choices?.[0]?.message ?? {};
      const text = String(msg.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      const list = parseMnemonicList(text, cfg.six ? 6 : 3);
      rec = {
        ...rec, ms: Date.now() - t0, usage: j.usage, ok: list.length,
        items: list.map((m) => ({ k: m.keyword, s: m.sentence, l: m.keywordLanguages })),
        raw: list.length ? undefined : text.slice(0, 300),
      };
    } catch (e) {
      rec = { ...rec, ms: Date.now() - t0, error: String(e) };
    }
    fs.appendFileSync(outPath, JSON.stringify(rec) + '\n');
    console.log(rec.cfg, rec.term, rec.ms, rec.ok, (rec.items ?? []).map((i) => i.k).join(' | '));
  }
}
