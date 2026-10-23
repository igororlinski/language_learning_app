// Usage: node md.mjs <results.jsonl> <cfgs per table>
import fs from 'node:fs';
import { judge } from './score.mjs';
const rows = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const per = +(process.argv[3] ?? 4);
const cfgs = [...new Set(rows.map((r) => r.cfg))];
const terms = [...new Set(rows.map((r) => r.term))];
const cell = (r) => !r ? '—' : r.error || r.ok === undefined ? `*błąd (${Math.round(r.ms / 1000)} s)*` :
  (r.items.map((i) => { const j = judge(r.term, i.k); return `${i.k}${j.good ? ' ✓' : j.real ? '' : ' ✗'}`; }).join(' · ') || '*0*') + ` <sub>${Math.round(r.ms / 1000)} s</sub>`;
for (let i = 0; i < cfgs.length; i += per) {
  const cs = cfgs.slice(i, i + per);
  console.log(`| słowo | ${cs.join(' | ')} |`);
  console.log(`| --- |${cs.map(() => ' --- |').join('')}`);
  for (const t of terms) console.log(`| \`${t}\` | ${cs.map((c) => cell(rows.find((r) => r.cfg === c && r.term === t))).join(' | ')} |`);
  console.log();
}
