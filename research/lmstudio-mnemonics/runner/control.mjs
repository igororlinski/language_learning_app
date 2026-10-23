// Control run after shipping (2026-10-23): the nine words through the APP's own
// requestMnemonics with LM Studio as the source — not a copy of the prompt — so
// what is scored is exactly what the phone sends.
// Needs exp/app.mjs from setup.sh. Usage: node control.mjs <out.jsonl> [model]
import fs from 'node:fs';
import { requestMnemonics, NO_KEYS } from '../exp/app.mjs';

const [, , outPath, model = 'google/gemma-4-e4b'] = process.argv;
const { words } = JSON.parse(fs.readFileSync(new URL('./phase3.json', import.meta.url), 'utf8'));
const keys = { ...NO_KEYS, lmStudioUrl: 'http://localhost:1234' };

for (const w of words) {
  const t0 = Date.now();
  const rec = { cfg: 'app', term: w.term, meaning: w.meaning };
  try {
    const list = await requestMnemonics(w, { provider: 'lmstudio', model }, keys);
    Object.assign(rec, { ms: Date.now() - t0, ok: list.length, items: list.map((m) => ({ k: m.keyword, s: m.sentence })) });
  } catch (e) {
    Object.assign(rec, { ms: Date.now() - t0, error: String(e?.failure ?? e) });
  }
  fs.appendFileSync(outPath, JSON.stringify(rec) + '\n');
  console.log(rec.term, rec.ms, (rec.items ?? []).map((i) => i.k).join(' | ') || rec.error);
}
