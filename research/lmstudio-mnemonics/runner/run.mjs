// Usage: node run.mjs <configs.json> <out.jsonl>
import fs from 'node:fs';
import { mnemonicPrompt, MNEMONIC_SCHEMA, parseMnemonicList } from '../exp/lib.mjs';

const [, , configsPath, outPath] = process.argv;
const { words, configs } = JSON.parse(fs.readFileSync(configsPath, 'utf8'));
const URL = 'http://localhost:1234/v1/chat/completions';

const strip = (s) => { const { propertyOrdering, ...r } = s; return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v && typeof v === 'object' && !Array.isArray(v) ? strip(v) : v])); };

for (const cfg of configs) {
  for (const w of words) {
    const prompt = mnemonicPrompt(w);
    const messages = [{ role: 'system', content: cfg.systemSuffix ? prompt.system + cfg.systemSuffix : prompt.system }, ...prompt.turns];
    const body = { model: 'google/gemma-4-e4b', messages, temperature: cfg.temperature, max_tokens: cfg.max_tokens ?? 4096 };
    if (cfg.top_p != null) body.top_p = cfg.top_p;
    if (cfg.top_k != null) body.top_k = cfg.top_k;
    if (cfg.min_p != null) body.min_p = cfg.min_p;
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
      const list = parseMnemonicList(text);
      rec = { ...rec, ms: Date.now() - t0, usage: j.usage, reasoningChars: (msg.reasoning_content ?? msg.reasoning ?? '').length,
        ok: list.length, items: list.map((m) => ({ k: m.keyword, s: m.sentence, l: m.keywordLanguages ?? m.keywordLanguage })), raw: list.length ? undefined : text.slice(0, 300) };
    } catch (e) { rec = { ...rec, ms: Date.now() - t0, error: String(e) }; }
    fs.appendFileSync(outPath, JSON.stringify(rec) + '\n');
    console.log(rec.cfg, rec.term, rec.ms, rec.ok, (rec.items ?? []).map((i) => i.k).join(' | '));
  }
}
