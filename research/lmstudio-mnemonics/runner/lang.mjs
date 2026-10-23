import fs from 'node:fs';
const pl = new Set(fs.readFileSync(new URL('../dict/pl.txt', import.meta.url), 'utf8').split('\n'));
const en = new Set(fs.readFileSync(new URL('../dict/en_50k.txt', import.meta.url), 'utf8').split('\n').map((l) => l.split(' ')[0]));
const rows = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const by = {};
for (const r of rows) {
  const b = (by[r.cfg] ??= { kw: 0, polish: 0, english: 0, fake: 0 });
  for (const i of r.items ?? []) {
    const ws = i.k.toLowerCase().split(/\s+/);
    b.kw++;
    if (ws.every((w) => pl.has(w))) b.polish++;
    else if (ws.every((w) => en.has(w) || pl.has(w))) b.english++;
    else b.fake++;
  }
}
console.table(by);
