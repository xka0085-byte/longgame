// 编排器：node scripts/run-all.mjs radar|collect-weekly|collect-monthly|report
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const mode = process.argv[2];
if (!['radar', 'collect-weekly', 'collect-monthly', 'report'].includes(mode)) {
  console.error('usage: run-all radar|collect-weekly|collect-monthly|report'); process.exit(1);
}
const portfolio = JSON.parse(readFileSync('portfolio.json', 'utf8'));

for (const s of portfolio.series) {
  if (!s.collect && !s.radar) { console.log(`${s.id}: skip (external)`); continue; }
  const isCollect = mode === 'collect-weekly' || mode === 'collect-monthly';
  if (isCollect) {
    const want = mode === 'collect-weekly' ? 'weekly' : 'monthly';
    if (s.cron?.collect !== want) continue;
    if (!s.collect) continue;
    try { execFileSync('node', ['scripts/line.mjs', s.id, 'collect'], { stdio: 'inherit', timeout: 180000 }); }
    catch (e) { console.error(`${s.id} collect FAILED: ${e.message.slice(0, 140)}`); }
  } else if (mode === 'radar') {
    if (s.cron?.radar !== 'daily' || !s.radar?.length) continue;
    try { execFileSync('node', ['scripts/line.mjs', s.id, 'radar'], { stdio: 'inherit', timeout: 180000 }); }
    catch (e) { console.error(`${s.id} radar FAILED: ${e.message.slice(0, 140)}`); }
  }
}
if (mode === 'report') execFileSync('node', ['scripts/report.mjs'], { stdio: 'inherit' });
console.log(`run-all ${mode} done`);
