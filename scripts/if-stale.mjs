// 看门狗：GitHub Actions 的 schedule 事件会被静默丢弃（本项目 2026-10-22~10-29 连续八天
// 没有任何自动运行，只有手动 dispatch 才动过），只靠周一那一个 cron 触发，一旦丢一次就是
// 整周数据断档。这里挂在每天的 daily-collect 上顺带检查：只要某条 weekly 线距上次采集
// 已超过 7 天，就立刻补采一轮，让"至少每天有一次 schedule 生效"成为恢复条件而不是
// "周一那一次必须生效"。
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const today = process.env.LONGGAME_TODAY || new Date().toISOString().slice(0, 10);
const todayMs = new Date(`${today}T00:00:00Z`).getTime();
const portfolio = JSON.parse(readFileSync('portfolio.json', 'utf8'));

const due = [];
for (const s of portfolio.series) {
  if (s.cron?.collect !== 'weekly') continue;
  const f = `data/lines/${s.id}.json`;
  if (!existsSync(f)) { due.push(`${s.id}(no data)`); continue; }
  const runs = JSON.parse(readFileSync(f, 'utf8')).collect?.runs || [];
  const last = runs.at(-1)?.date?.slice(0, 10);
  if (!last) { due.push(`${s.id}(no run)`); continue; }
  const gap = Math.round((todayMs - new Date(`${last}T00:00:00Z`).getTime()) / 86400000);
  if (gap > 7) due.push(`${s.id}(${gap}d)`);
}

if (!due.length) {
  console.log(`if-stale: all weekly lines within cadence (today=${today})`);
  process.exit(0);
}

console.log(`if-stale: overdue -> ${due.join(', ')}; running collect-weekly`);
const r = spawnSync(process.execPath, ['scripts/run-all.mjs', 'collect-weekly'], { stdio: 'inherit' });
process.exit(r.status ?? 1);
