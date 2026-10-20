// eIDAS TSL diff 序列：EU 信任列表变更（decade-portfolio 既定 A 级低成本序列）
// LOTL 指针列表 diff，数据落 data/eidas-tsl.json
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const UA = { 'User-Agent': 'longgame-portfolio/0.1 personal research' };
const LOTL = 'https://ec.europa.eu/tools/lotl/eu-lotl.xml';
const OUT = 'data/eidas-tsl.json';

const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { runs: [], events: [] };
const run = { date: new Date().toISOString() };

try {
  const r = await fetch(LOTL, { headers: UA, signal: AbortSignal.timeout(30000) });
  const xml = await r.text();
  run.status = r.status;
  run.bytes = xml.length;
  // LOTL 本身是 TSL，成员国指针在 SchemeTSLLocation/TSLLocation；排除自引用
  const locs = [...xml.matchAll(/(?:TSLLocation|SchemeTSLLocation)>(https?:[^<]+)/g)].map(m => m[1].trim()).filter(u => !/eu-lotl\.xml/.test(u));
  run.pointerCount = locs.length;
  run.pointers = [...new Set(locs)].sort();
  const prevPtrs = prev.runs.at(-1)?.pointers || [];
  const prevSet = new Set(prevPtrs);
  if (prevPtrs.length) {
    const changes = [];
    for (const u of run.pointers) if (!prevSet.has(u)) changes.push({ type: 'tsl-added', url: u });
    for (const u of prevPtrs) if (!run.pointers.includes(u)) changes.push({ type: 'tsl-removed', url: u });
    run.changes = changes;
    if (changes.length) prev.events.push({ date: run.date, changes });
  }
} catch (e) {
  run.error = String(e).slice(0, 160);
}
prev.runs.push(run);
if (prev.runs.length > 300) prev.runs = prev.runs.slice(-300);
writeFileSync(OUT, JSON.stringify(prev, null, 1));
console.log(`eidas-tsl ${run.date} status=${run.status || run.error} pointers=${run.pointerCount ?? '?'} events=${(run.changes || []).length}`);
