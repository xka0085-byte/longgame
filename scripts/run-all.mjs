// 编排器：node scripts/run-all.mjs radar|collect-daily|collect-weekly|collect-monthly|report
// 采集窗口：portfolio.json 中某条线带 window_until（默认窗口起点 2026-11-01）时，
// 窗口内改由 collect-daily 每日采集，weekly 跳过该线；窗口结束后自动回到 weekly。
// 日期可用 LONGGAME_TODAY=YYYY-MM-DD 覆盖，仅用于验收模拟，不写入数据文件。
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const MODES = ['radar', 'collect-daily', 'collect-weekly', 'collect-monthly', 'report'];
const mode = process.argv[2];
if (!MODES.includes(mode)) {
  console.error(`usage: ${MODES.join('|')}`); process.exit(1);
}
const portfolio = JSON.parse(readFileSync('portfolio.json', 'utf8'));
const today = process.env.LONGGAME_TODAY || new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) { console.error(`invalid LONGGAME_TODAY: ${today}`); process.exit(1); }

// 窗口起点：未显式配置时按首窗准备期 2026-11-01 起算；window_until 当天仍算窗口内。
function inWindow(s) {
  if (!s.window_until) return false;
  const start = s.window_start || '2026-11-01';
  return today >= start && today <= s.window_until;
}

console.log(`run-all ${mode} today=${today}`);

for (const s of portfolio.series) {
  if (!s.collect && !s.radar) { console.log(`${s.id}: skip (external)`); continue; }
  const isCollect = mode === 'collect-weekly' || mode === 'collect-monthly' || mode === 'collect-daily';

  if (isCollect) {
    if (!s.collect) continue;
    if (mode === 'collect-daily') {
      if (!inWindow(s)) { console.log(`${s.id}: skip (no active window)`); continue; }
      console.log(`${s.id}: daily window active until ${s.window_until}`);
    } else {
      const want = mode === 'collect-weekly' ? 'weekly' : 'monthly';
      if (s.cron?.collect !== want) continue;
      if (inWindow(s)) { console.log(`${s.id}: skip (daily window until ${s.window_until}, handled by collect-daily)`); continue; }
    }
    try {
      if (process.env.LONGGAME_DRY_RUN === '1') { console.log(`${s.id}: would collect (dry-run)`); continue; }
      execFileSync('node', ['scripts/line.mjs', s.id, 'collect'], { stdio: 'inherit', timeout: 180000 });
      // sb253 首窗：每轮采集后立即刷新页面；有无名单、数据源是否可用由页面脚本判定。
      if (s.id === 'sb253-docket' && existsSync('scripts/sb253-first-window.mjs')) {
        execFileSync('node', ['scripts/sb253-first-window.mjs'], { stdio: 'inherit', timeout: 60000 });
      }
    } catch (e) {
      console.error(`${s.id} collect FAILED: ${e.message.slice(0, 140)}`);
    }
  } else if (mode === 'radar') {
    if (s.cron?.radar !== 'daily' || !s.radar?.length) continue;
    try { execFileSync('node', ['scripts/line.mjs', s.id, 'radar'], { stdio: 'inherit', timeout: 180000 }); }
    catch (e) { console.error(`${s.id} radar FAILED: ${e.message.slice(0, 140)}`); }
  }
}
if (mode === 'report') execFileSync('node', ['scripts/report.mjs'], { stdio: 'inherit' });
console.log(`run-all ${mode} done`);
