// Usage: node score.mjs <results.jsonl> [--list]
import fs from 'node:fs';
const D = new URL('../dict/', import.meta.url);
const pl = new Set(fs.readFileSync(new URL('pl.txt', D), 'utf8').split('\n'));
const en = new Set(fs.readFileSync(new URL('en_50k.txt', D), 'utf8').split('\n').map((l) => l.split(' ')[0]));
const REF = { janela: 'żanela', queijo: 'kejżu', sapato: 'sapatu', cozinha: 'kuzinia', cavalo: 'kawalu',
  borboleta: 'burbuleta', chave: 'szaw', perro: 'pero', mantequilla: 'mantekija' };

const norm = (w) => w.toLowerCase().normalize('NFC')
  .replace(/dż/g, 'J').replace(/dź/g, 'J').replace(/rz/g, 'Z').replace(/sz/g, 'S').replace(/cz/g, 'C')
  .replace(/sh/g, 'S').replace(/ch/g, 'h').replace(/ph/g, 'f').replace(/th/g, 't').replace(/qu/g, 'k')
  .replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/ni(?=[aeiouyąęó])/g, 'ñ').replace(/ń/g, 'ñ')
  .replace(/[żź]/g, 'Z').replace(/ś/g, 'S').replace(/ć/g, 'C').replace(/ó/g, 'u').replace(/w/g, 'v')
  .replace(/ą/g, 'o').replace(/ę/g, 'e').replace(/y/g, 'i').replace(/x/g, 'ks').replace(/(.)\1/g, '$1')
  .replace(/[^a-zA-Zñ]/g, '');
const lev = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length]; };

export function judge(term, keyword) {
  const words = keyword.toLowerCase().split(/\s+/).filter(Boolean);
  const real = words.length > 0 && words.every((w) => pl.has(w) || en.has(w));
  const ref = norm(REF[term]); const k = norm(words.join(''));
  // Sound: compare the keyword's opening against the whole reference (a longer real word may carry the sound in its beginning).
  const head = k.slice(0, ref.length + 1);
  const sim = 1 - lev(head, ref) / Math.max(head.length, ref.length);
  const open = k[0] === ref[0] && (k[1] === ref[1] || k[2] === ref[2]);
  const self = lev(k, ref) <= 1; // the foreign word re-spelled
  return { real, sim: +sim.toFixed(2), open, good: real && open && sim >= 0.4 && !self, pair: words.length > 1 };
}

if (process.argv[1].endsWith('score.mjs')) {
  const rows = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const by = {};
  for (const r of rows) (by[r.cfg] ??= []).push(r);
  const out = [];
  for (const [cfg, rs] of Object.entries(by)) {
    let n = 0, real = 0, good = 0, sim = 0, wordsWithGood = 0, full = 0, toks = 0, ms = 0, pairsShort = 0;
    for (const r of rs) {
      ms += r.ms; toks += r.usage?.completion_tokens ?? 0; if (r.ok >= 3) full++;
      let any = false;
      for (const it of r.items ?? []) { const j = judge(r.term, it.k); n++; real += j.real; good += j.good; sim += j.sim; any ||= j.good;
        if (j.pair && r.term !== 'mantequilla') pairsShort++; it.j = j; }
      wordsWithGood += any;
    }
    out.push({ cfg, runs: rs.length, full3: full, kw: n, realPct: Math.round(100 * real / n), goodPct: Math.round(100 * good / n),
      wordsWithGood: `${wordsWithGood}/${rs.length}`, avgSim: +(sim / n).toFixed(2), badPairs: pairsShort,
      avgS: Math.round(ms / rs.length / 1000), avgTok: Math.round(toks / rs.length) });
    if (process.argv.includes('--list')) for (const r of rs)
      console.log(cfg.padEnd(16), r.term.padEnd(12), (r.items ?? []).map((i) => `${i.k}${i.j.good ? '✓' : i.j.real ? '~' : '✗'}`).join(' | '), r.raw ? 'RAW:' + r.raw.slice(0, 80) : '');
  }
  console.table(out);
}
