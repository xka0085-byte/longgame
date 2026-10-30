// 编排器：node scripts/run-all.mjs radar|collect-daily|collect-weekly|collect-monthly|report
// 采集窗口：portfolio.json 中某条线带 window_until（默认窗口起点 2026-11-01）时，
// 窗口内改由 collect-daily 每日采集，weekly 跳过该线；窗口结束后自动回到 weekly。
// 日期可用 LONGGAME_TODAY=YYYY-MM-DD 覆盖，仅用于验收模拟，不写入数据文件。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
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

// 失败判定的分层（2026-10-30 改）：
//   页级（line.mjs）已经做三档容错，单页反爬不该拖垮整轮；
//   线级（这里）原来更进一步——"任一 line 失败即整轮非零退出"，结果是一条线的环境性
//   拦截（CI 出口 IP 被 403）会让其它 12 条线的真实采集全部无法发布。10-26、10-30 两次
//   weekly-collect 就是这么静默停发的：数据采到了，但 exit=1 让 gate/publish 跳过。
//   现在改成：单线失败只记录不阻断，只有**本轮尝试的线全部失败**才判失败。
//   单线持续故障不会被掩盖——heartbeat 会对"连续两轮全挂"的线开 critical Issue。
let failures = 0;
let attempted = 0;
const failedLines = [];

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
    attempted += 1;
    try {
      if (process.env.LONGGAME_DRY_RUN === '1') { console.log(`${s.id}: would collect (dry-run)`); continue; }
      execFileSync('node', ['scripts/line.mjs', s.id, 'collect'], { stdio: 'inherit', timeout: s.timeout_ms || 180000 });
      // sb253 首窗：每轮采集后立即刷新页面；有无名单、数据源是否可用由页面脚本判定。
      if (s.id === 'sb253-docket' && existsSync('scripts/sb253-first-window.mjs')) {
        execFileSync('node', ['scripts/sb253-first-window.mjs'], { stdio: 'inherit', timeout: 60000 });
      }
    } catch (e) {
      failures += 1; failedLines.push(`${s.id}:collect`);
      console.error(`${s.id} collect FAILED: ${e.message.slice(0, 140)}`);
    }
  } else if (mode === 'radar') {
    if (s.cron?.radar !== 'daily' || !s.radar?.length) continue;
    attempted += 1;
    try { execFileSync('node', ['scripts/line.mjs', s.id, 'radar'], { stdio: 'inherit', timeout: s.timeout_ms || 180000 }); }
    catch (e) { failures += 1; failedLines.push(`${s.id}:radar`); console.error(`${s.id} radar FAILED: ${e.message.slice(0, 140)}`); }
  }
}
// 漏跑检测：GitHub 的 schedule 事件可能整段丢失（本项目 10-24~10-29 即无任何 schedule 运行），
// 因此即使本轮采集成功，也要显式暴露"距上个采集点已超出自身周期"的线，避免看着绿灯其实断了。
const todayMs = new Date(`${today}T00:00:00Z`).getTime();
function gapDays(d) { return Math.round((todayMs - new Date(`${d}T00:00:00Z`).getTime()) / 86400000); }
const stale = [];
for (const s of portfolio.series) {
  if (!s.collect) continue;
  const f = `data/lines/${s.id}.json`;
  if (!existsSync(f)) { stale.push(`${s.id}: no data file`); continue; }
  const st = JSON.parse(readFileSync(f, 'utf8'));
  const last = st.collect?.runs?.at(-1)?.date?.slice(0, 10);
  if (!last) { stale.push(`${s.id}: no collect run`); continue; }
  const limit = s.cron?.collect === 'monthly' ? 31 : 7;
  const gap = gapDays(last);
  if (gap > limit) stale.push(`${s.id}: last collect ${last} (${gap}d > ${limit}d cadence)`);
}
if (stale.length) {
  console.warn(`stale lines (${stale.length}): collection gap exceeds cadence`);
  for (const x of stale) console.warn(`  ${x}`);
}

if (mode === 'report') execFileSync('node', ['scripts/report.mjs'], { stdio: 'inherit' });

// 失败清单落盘：给 heartbeat 和 self-upgrade 当证据用，也给人排查时不用翻 Actions 日志。
writeFileSync('data/collect-runs.json', JSON.stringify({
  at: new Date().toISOString(),
  today,
  mode,
  attempted,
  failures,
  failed_lines: failedLines,
  stale_lines: stale,
  verdict: attempted > 0 && failures === attempted ? 'failed' : failures > 0 ? 'partial' : 'ok',
}, null, 2) + '\n');

if (failures > 0 && failures < attempted) {
  console.warn(`run-all ${mode} PARTIAL: ${failures}/${attempted} line(s) failed (${failedLines.join(', ')}) — 已采集到的线照常进入 gate/publish，故障线由 heartbeat 跟踪`);
} else if (attempted > 0 && failures === attempted) {
  console.error(`run-all ${mode} FAILED: all ${attempted} attempted line(s) failed — 全部数据源同时不可用，判整轮失败`);
  process.exit(1);
} else if (attempted === 0) {
  console.warn(`run-all ${mode}: 本模式无待执行线（检查 cron 配置与采集窗口）`);
}
console.log(`run-all ${mode} done`);
