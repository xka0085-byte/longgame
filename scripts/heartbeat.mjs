// heartbeat：这套数据组合的自检—自愈—告警 主循环。
//
// 为什么需要它：
//   1. GitHub 的 schedule 事件会被静默丢弃。实测 longgame 在 2026-10-22/23 各触发一次后，
//      直到 10-30 再没有任何 schedule 运行（158 小时），而系统本身没有任何地方会说话。
//   2. 原先的看门狗 if-stale.mjs 挂在 daily-collect 内部——触发器死了，看门狗一起死，
//      等于把保险丝接在同一根已经烧断的线上。
//   3. 所有失败都是静默的，没有 Issue/邮件/webhook，断档只有靠人翻 Actions 才发现。
//
// 它做四件事：
//   A. 心跳：每次运行落一条记录到 data/heartbeat.json（可被外部 dead-man switch 检查新鲜度）
//   B. 评估：按每条线的周期算 gap、连续失败、降级页、自产文档陈旧度
//   C. 自愈：对超期的线当场单线补采（不重试第二次，避免无限撞墙）
//   D. 告警：critical 开/更新 Issue，恢复后自动关闭（去重，不刷屏）
//
// 边界（写死在代码里，self-upgrade 也不许改）：
//   - 采集失败绝不写 0，绝不伪造成功；缺数据一律留 null / "never"
//   - 不改 assurance_level、不改 evidence.json、不改门禁阈值
//   - 本自检不是第三方验证，输出里必须显式声明
//
// 用法：
//   node scripts/heartbeat.mjs              # 评估 + 自愈 + 告警
//   node scripts/heartbeat.mjs --no-heal    # 只评估（CI 门禁/本地排查用）
//   node scripts/heartbeat.mjs --json       # 只打印 JSON
//   LONGGAME_TODAY=2026-11-07 node scripts/heartbeat.mjs --no-heal   # 模拟日期验收

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { raise, resolve, alertReady } from './lib/github-issue.mjs';

const ROOT = process.cwd();
const HEARTBEAT_STATE = 'data/heartbeat.json';
const TUNING_FILE = 'data/self-tuning.json';
const OUT_LATEST = 'docs/health/latest.json';
const OUT_HISTORY = 'docs/health/history.jsonl';
const OUT_PAGE = 'docs/health.html';
const GATE_RESULT = 'assurance/.gate/result.json';
const STATUS_JSON = 'docs/status.json';

const nowIso = process.env.LONGGAME_NOW || new Date().toISOString();
const nowMs = Date.parse(nowIso);
if (Number.isNaN(nowMs)) {
  console.error(`heartbeat: invalid LONGGAME_NOW: ${nowIso}`);
  process.exit(1);
}
const today = process.env.LONGGAME_TODAY || nowIso.slice(0, 10);
const flags = new Set(process.argv.slice(2));
const doHeal = !flags.has('--no-heal');
const jsonOnly = flags.has('--json');

// 阈值集中在这里，且允许 data/self-tuning.json 覆盖——这是 self-upgrade.mjs 唯一能动的参数面。
const DEFAULT_TUNING = {
  weeklyGraceDays: 1,        // weekly 线超过 7+grace 天算超期
  monthlyGraceDays: 3,       // monthly 线超过 31+grace 天算超期
  windowGraceDays: 0,        // 首窗线（sb253 类）窗口内按日采，超过 1 天即超期
  criticalMultiplier: 1.5,   // gap > (limit * multiplier) 升级为 critical
  consecutiveFailureCritical: 2,
  heartbeatSilenceHours: 30, // 心跳静默超过此值 = 触发器已死
  // 对齐 weekly-audit 的周期：它一周才产一次 docs/status.json，阈值设 48h 等于
  // 每周有 5 天在报假警（线上实测 216h 仍在报）。8 天 = 一个周期 + 1 天宽限。
  selfOutputStaleHours: 192, // docs/status.json 陈旧超过此值 = 自审环节断了
  historyKeep: 400,
  heartbeatKeep: 60,
};
const tuning = (() => {
  let overrides = {};
  if (existsSync(TUNING_FILE)) {
    try { overrides = JSON.parse(readFileSync(TUNING_FILE, 'utf8')).thresholds || {}; }
    catch (e) { console.error(`heartbeat: ${TUNING_FILE} unreadable, using defaults (${e.message})`); }
  }
  return { ...DEFAULT_TUNING, ...overrides };
})();

function readJson(p, fallback = null) {
  if (!existsSync(p)) return fallback;
  try { return JSON.parse(readFileSync(p, 'utf8')); }
  catch { return fallback; }
}
// 门禁结论要跨 workflow 读。assurance/.gate/result.json 落在 runner 本地目录，
// job 结束即销毁，所以心跳在另一个 workflow 里永远读不到它——线上实测健康页
// 每次都在报 gate-missing（假信号），而真正的 gate FAIL 反而看不见。
// 有 GITHUB_TOKEN 时直接问 Actions 最近一次 assurance-gate 的结论；本地跑时回退读文件。
async function gateState() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const branch = process.env.GITHUB_REF_NAME || 'master';
  if (token && repo) {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${repo}/actions/workflows/assurance-gate.yml/runs?branch=${encodeURIComponent(branch)}&per_page=1`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'longgame-heartbeat' } },
      );
      if (res.ok) {
        const j = await res.json();
        const run = (j.workflow_runs || [])[0];
        if (run && run.status === 'completed' && run.conclusion) {
          return {
            at: run.updated_at || run.created_at,
            passed: run.conclusion === 'success',
            source: 'actions-api',
            url: run.html_url,
            conclusion: run.conclusion,
          };
        }
      }
    } catch (e) {
      console.error(`heartbeat: gate lookup via api failed (${e.message}); falling back to local file`);
    }
  }
  const local = readJson(GATE_RESULT);
  return local ? { ...local, source: 'local-file' } : null;
}

function daysBetween(aIso, bIso) {
  const a = Date.parse(`${String(aIso).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(bIso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

// 一轮采集到底算不算失败：优先读采集器自己写的 run.ok；历史数据没有该字段时按各自
// 结构推断（pages / dirs / queries / eia / pointers）。都无法判定时返回 null——宁可
// 说"不知道"，也不能把 dirs/eia/edgar 这几类线误判成"整轮全挂"（那是假警报，
// 假警报比没有警报更糟：人一旦被吵到就会开始忽略所有警报）。
function roundFailed(r) {
  if (typeof r.ok === 'boolean') return r.ok === false;
  if (Array.isArray(r.pages)) return r.pages.length > 0 && r.pages.every(p => p.unavailable === true);
  if (r.dirs && typeof r.dirs === 'object') {
    const v = Object.values(r.dirs);
    return v.length > 0 && v.every(d => d?.unavailable === true || d?.error);
  }
  if (Array.isArray(r.queries)) return r.queries.length > 0 && r.queries.every(q => q.error);
  if (r.eia) return !!r.eia.error;
  if (Array.isArray(r.pointers)) return (r.pointerCount ?? r.pointers.length) === 0;
  return null;
}

const portfolio = readJson('portfolio.json');
if (!portfolio?.series) { console.error('heartbeat: portfolio.json missing series'); process.exit(1); }

// ---------- B. 评估 ----------
function lineCadence(s) {
  if (s.window_until) {
    const inWindow = today >= (s.window_start || '2026-11-01') && today <= s.window_until;
    if (inWindow) return { kind: 'window', limit: 1 + tuning.windowGraceDays };
  }
  if (s.cron?.collect === 'monthly') return { kind: 'monthly', limit: 31 + tuning.monthlyGraceDays };
  if (s.cron?.collect === 'weekly') return { kind: 'weekly', limit: 7 + tuning.weeklyGraceDays };
  return { kind: 'unknown', limit: 7 + tuning.weeklyGraceDays };
}

function evaluate(gate) {
  const signals = [];
  const lines = [];

  for (const s of portfolio.series) {
    const rec = {
      id: s.id,
      managed: !!s.collect,
      status: s.status || null,
      cadence: lineCadence(s).kind,
      last_collect: null,
      gap_days: null,
      limit_days: lineCadence(s).limit,
      consecutive_failed_rounds: 0,
      last_round: null,
      degraded_pages: 0,
      freshness: 'unknown',
    };
    if (!s.collect) {
      rec.freshness = 'external';
      lines.push(rec);
      continue;
    }
    const data = readJson(`data/lines/${s.id}.json`);
    const runs = data?.collect?.runs || [];
    if (!runs.length) {
      rec.freshness = 'never';
      signals.push({
        id: `line-never-collected:${s.id}`,
        severity: 'critical',
        detail: `${s.id} 没有任何采集记录（data/lines/${s.id}.json 缺失或无 runs）`,
      });
      lines.push(rec);
      continue;
    }
    const last = runs.at(-1);
    rec.last_attempt = last.date ? String(last.date).slice(0, 10) : null;
    // 新鲜度必须按"最后一次**成功**采集"算。若按最后一条 run 算，一条每周都跑、
    // 每次都全挂的线会永远显示 gap=0——那正是"绿灯下的死亡"，本例 agent-dirs
    // 就曾连续 7 轮无有效数据却被算成当天新鲜。
    const lastOk = [...runs].reverse().find(r => roundFailed(r) === false);
    rec.last_collect = lastOk?.date ? String(lastOk.date).slice(0, 10) : null;
    rec.last_round = last.status || null;
    rec.degraded_pages = last.unavailablePages || (last.pages || []).filter(p => p.unavailable).length || 0;
    rec.gap_days = rec.last_collect ? daysBetween(rec.last_collect, today) : null;

    // 连续失败：尾部连续"判定为失败"的轮次数
    for (let i = runs.length - 1; i >= 0; i--) {
      if (roundFailed(runs[i]) === true) rec.consecutive_failed_rounds += 1;
      else break;
    }

    const limit = rec.limit_days;
    if (rec.gap_days === null) {
      rec.freshness = 'never';
      signals.push({
        id: `line-never-successful:${s.id}`,
        severity: 'critical',
        detail: `${s.id} 有 ${runs.length} 轮采集记录但从未有一轮判定成功——数据文件里只有失败痕迹，没有任何可用数据`,
      });
    } else if (rec.gap_days > limit * tuning.criticalMultiplier) {
      rec.freshness = 'critical';
      signals.push({
        id: `line-stale:${s.id}`,
        severity: 'critical',
        detail: `${s.id} 距上次采集 ${rec.gap_days} 天，超过 ${limit} 天周期的 ${tuning.criticalMultiplier} 倍`,
      });
    } else if (rec.gap_days > limit) {
      rec.freshness = 'stale';
      signals.push({
        id: `line-stale:${s.id}`,
        severity: 'warn',
        detail: `${s.id} 距上次采集 ${rec.gap_days} 天，已超出 ${limit} 天周期`,
      });
    } else {
      rec.freshness = 'fresh';
    }

    if (rec.consecutive_failed_rounds >= tuning.consecutiveFailureCritical) {
      signals.push({
        id: `line-broken:${s.id}`,
        severity: 'critical',
        detail: `${s.id} 连续 ${rec.consecutive_failed_rounds} 轮采集全部不可用（未写入零值，保留上次数据）`,
      });
    } else if (rec.consecutive_failed_rounds === 1) {
      signals.push({ id: `line-broken:${s.id}`, severity: 'warn', detail: `${s.id} 最近一轮采集全部不可用` });
    }
    if (rec.degraded_pages > 0 && rec.freshness !== 'critical') {
      signals.push({
        id: `line-degraded:${s.id}`,
        severity: 'info',
        detail: `${s.id} 最近一轮有 ${rec.degraded_pages} 个页面不可用（按容错档放行，已记事件）`,
      });
    }
    lines.push(rec);
  }

  // 心跳静默：上次心跳距今超阈值 = 触发器或调度链路已断
  const hb = readJson(HEARTBEAT_STATE, { runs: [] });
  const prevRuns = (hb.runs || []).filter(r => Date.parse(r.at) < nowMs);
  const prevAt = prevRuns.at(-1)?.at || null;
  const silenceHours = prevAt ? (nowMs - Date.parse(prevAt)) / 3600000 : null;
  if (silenceHours !== null && silenceHours > tuning.heartbeatSilenceHours) {
    signals.push({
      id: 'schedule-silence',
      severity: 'critical',
      detail: `上次心跳在 ${prevAt}，已静默 ${silenceHours.toFixed(1)} 小时（阈值 ${tuning.heartbeatSilenceHours}h）——说明 cron 触发链路断了，不只是某条数据线的问题`,
    });
  }

  // 自产文档陈旧：自审环节本身断掉
  const status = readJson(STATUS_JSON);
  const statusAt = status?.generated_at || null;
  const statusStaleH = statusAt ? (nowMs - Date.parse(statusAt)) / 3600000 : null;
  if (statusStaleH !== null && statusStaleH > tuning.selfOutputStaleHours) {
    signals.push({
      id: 'self-output-stale',
      severity: 'warn',
      detail: `docs/status.json 生成于 ${statusAt}，已 ${statusStaleH.toFixed(0)} 小时未更新，自审环节（weekly-audit）没跑成`,
    });
  }

  // 发布门禁：最近一次结果失败或过旧（gate 由调用方提供：CI 走 Actions API，本地走文件）
  if (gate) {
    const gateAgeH = (nowMs - Date.parse(gate.at)) / 3600000;
    if (gate.passed === false) {
      signals.push({ id: 'gate-failed', severity: 'critical', detail: `最近一次 assurance-gate 为 FAIL（${gate.at}，来源 ${gate.source || 'unknown'}），发布被阻断` });
    } else if (gateAgeH > 24 * 8) {
      signals.push({ id: 'gate-stale', severity: 'warn', detail: `最近一次 gate 通过是 ${gate.at}（${gateAgeH.toFixed(0)} 小时前，来源 ${gate.source || 'unknown'}），超过 8 天未复跑` });
    }
  } else {
    signals.push({ id: 'gate-missing', severity: 'warn', detail: '查不到最近一次 assurance-gate 的结论（无 token 且无本地 result.json），门禁状态未知' });
  }

  const rank = { critical: 3, warn: 2, info: 1 };
  const worst = signals.reduce((acc, s) => Math.max(acc, rank[s.severity] || 0), 0);
  const overall = worst >= 3 ? 'critical' : worst === 2 ? 'degraded' : 'ok';
  return { overall, signals, lines, prevAt, silenceHours };
}

// ---------- C. 自愈 ----------
// 只做一件事：对超期且可采集的线，单线补采一次。不做第二次重试——同源连续失败继续撞墙
// 只会把执行时间耗光，真正该做的是把问题暴露给人（走告警）。
function selfHeal(state) {
  const healed = [];
  const failed = [];
  const staleIds = state.signals
    .filter(s => s.id.startsWith('line-stale:') || s.id.startsWith('line-never-collected:') || s.id.startsWith('line-never-successful:'))
    .map(s => s.id.split(':')[1]);
  if (!staleIds.length) return { healed, failed, attempted: [] };

  for (const id of staleIds) {
    const s = portfolio.series.find(x => x.id === id);
    if (!s?.collect) continue;
    if (process.env.LONGGAME_DRY_RUN === '1') { failed.push(`${id}(dry-run)`); continue; }
    const r = spawnSync(process.execPath, ['scripts/line.mjs', id, 'collect'], {
      stdio: 'inherit', timeout: 240000, env: process.env,
    });
    if (r.status === 0) healed.push(id);
    else failed.push(`${id}(exit=${r.status ?? 'timeout'})`);
  }
  return { healed, failed, attempted: staleIds };
}

// ---------- 状态页 ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function renderPage(payload) {
  const rows = payload.lines.map(l => {
    const cls = l.freshness === 'critical' ? 'bad' : l.freshness === 'stale' ? 'warn' : l.freshness === 'external' ? 'mute' : 'ok';
    return `<tr class="${cls}"><td>${esc(l.id)}</td><td>${esc(l.cadence)}</td><td>${esc(l.last_collect ?? 'never')}</td><td>${l.gap_days ?? '—'}</td><td>${l.limit_days}</td><td>${esc(l.freshness)}</td><td>${l.consecutive_failed_rounds}</td><td>${l.degraded_pages}</td></tr>`;
  }).join('\n');
  const sig = payload.signals.length
    ? payload.signals.map(s => `<li class="${esc(s.severity)}"><b>${esc(s.severity)}</b> · ${esc(s.detail)}</li>`).join('\n')
    : '<li class="ok">无异常信号</li>';
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<title>longgame 运维健康页</title>
<style>
body{font:15px/1.65 -apple-system,"Segoe UI",system-ui,sans-serif;max-width:960px;margin:48px auto;padding:0 20px;color:#1c1c1e}
h1{font-size:24px;margin-bottom:4px}h2{font-size:17px;margin-top:36px}
.meta{color:#6b7280;font-size:13px}
table{border-collapse:collapse;width:100%;font-size:13.5px;margin-top:12px}
th,td{border-bottom:1px solid #e5e7eb;padding:7px 8px;text-align:left}
th{background:#f9fafb;font-weight:600}
tr.bad td{background:#fef2f2}tr.warn td{background:#fffbeb}tr.mute td{color:#9ca3af}
ul{padding-left:20px}li{margin:5px 0}
li.critical{color:#b91c1c}li.warn{color:#b45309}li.info{color:#4b5563}li.ok{color:#15803d}
code{background:#f3f4f6;padding:1px 5px;border-radius:4px;font-size:12.5px}
.note{border-left:3px solid #d1d5db;padding:8px 14px;color:#4b5563;font-size:13.5px;margin-top:28px}
</style>
<h1>longgame 运维健康页</h1>
<p class="meta">生成于 ${esc(payload.generated_at)} · 总体状态 <b>${esc(payload.overall)}</b> · 心跳来源 ${esc(payload.trigger)}</p>
<h2>异常信号</h2><ul>${sig}</ul>
<h2>各线新鲜度</h2>
<table><thead><tr><th>线</th><th>周期</th><th>上次采集</th><th>间隔(天)</th><th>容忍(天)</th><th>新鲜度</th><th>连续失败</th><th>降级页</th></tr></thead><tbody>${rows}</tbody></table>
<div class="note">
这是项目自己的内部自检，<b>不是第三方验证</b>（evidence_level 仍为 E0，verified_by_third_party 为 false）。
采集失败一律不写 0，缺数据保留 null / never。心跳只能证明"这一次跑了"，
无法证明"该跑的那次跑了"——外部 dead-man 检查由独立进程负责。
</div>
</html>`;
}

// ---------- 主流程 ----------
const gate = await gateState();
const state = evaluate(gate);
let heal = { healed: [], failed: [], attempted: [] };
let stateAfter = state;

if (doHeal && state.signals.some(s => s.id.startsWith('line-stale:') || s.id.startsWith('line-never-collected:') || s.id.startsWith('line-never-successful:'))) {
  heal = selfHeal(state);
  if (heal.healed.length) stateAfter = evaluate(gate); // 补采后重新评估，别拿旧结论告警
}

const critical = stateAfter.signals.filter(s => s.severity === 'critical');
const warns = stateAfter.signals.filter(s => s.severity === 'warn');

const payload = {
  generated_at: nowIso,
  today,
  trigger: process.env.GITHUB_EVENT_NAME || (process.env.CI ? 'ci' : 'local'),
  overall: stateAfter.overall,
  signals: stateAfter.signals,
  lines: stateAfter.lines,
  heal,
  previous_heartbeat_at: stateAfter.prevAt,
  silence_hours: stateAfter.silenceHours === null ? null : Number(stateAfter.silenceHours.toFixed(1)),
  gate: gate ? { at: gate.at, passed: gate.passed, source: gate.source, url: gate.url || null } : null,
  thresholds: tuning,
  disclaimer: '内部自检，非第三方验证；E0 / verified_by_third_party=false',
};

if (jsonOnly) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(critical.length ? 1 : 0);
}

mkdirSync(dirname(OUT_LATEST), { recursive: true });
writeFileSync(OUT_LATEST, JSON.stringify(payload, null, 2) + '\n');
appendFileSync(OUT_HISTORY, JSON.stringify({
  at: nowIso, overall: payload.overall,
  critical: critical.length, warn: warns.length, healed: heal.healed,
}) + '\n');
// 历史只留最近 N 行，避免仓库无限膨胀
const histLines = readFileSync(OUT_HISTORY, 'utf8').trim().split('\n');
if (histLines.length > tuning.historyKeep) {
  writeFileSync(OUT_HISTORY, histLines.slice(-tuning.historyKeep).join('\n') + '\n');
}
writeFileSync(OUT_PAGE, renderPage(payload));

// 心跳记录
const hb = readJson(HEARTBEAT_STATE, { runs: [] });
hb.runs = [...(hb.runs || []), {
  at: nowIso, trigger: payload.trigger, overall: payload.overall,
  critical: critical.length, warn: warns.length, healed: heal.healed,
}].slice(-tuning.heartbeatKeep);
writeFileSync(HEARTBEAT_STATE, JSON.stringify(hb, null, 2) + '\n');

// ---------- D. 告警 ----------
if (critical.length) {
  const body = [
    `自动巡检在 ${nowIso} 判定 **critical**（trigger=${payload.trigger}）。`,
    '',
    '**异常**',
    ...critical.map(s => `- \`${s.id}\` — ${s.detail}`),
    '',
    heal.attempted.length ? `**自愈已尝试**：${heal.attempted.join(', ')}；成功 ${heal.healed.join(', ') || '无'}；失败 ${heal.failed.join(', ') || '无'}` : '**自愈未触发**（无超期线）',
    '',
    `心跳静默：${payload.silence_hours === null ? '无历史心跳' : payload.silence_hours + ' 小时'}`,
    `最近一次心跳：${payload.previous_heartbeat_at || '无'}`,
    '',
    `健康页：https://xka0085-byte.github.io/longgame/health.html`,
    `原始数据：docs/health/latest.json`,
    '',
    '> 这是内部自检，不是第三方验证。恢复后此 Issue 会自动关闭。',
  ].join('\n');
  await raise('longgame-critical', body);
} else {
  await resolve('longgame-critical', `巡检恢复：${nowIso} 无 critical 信号。`);
}

// schedule 静默单独立案，因为它的含义和"某条线挂了"完全不同——是触发器死了。
if (stateAfter.signals.some(s => s.id === 'schedule-silence')) {
  await raise('longgame-schedule-silence', [
    `GitHub 的 schedule 触发链路疑似中断。`,
    '',
    `- 上次心跳：${payload.previous_heartbeat_at}`,
    `- 静默时长：${payload.silence_hours} 小时（阈值 ${tuning.heartbeatSilenceHours}h）`,
    '',
    '心跳只能证明"这一次跑了"。cron 被丢弃时，仓库内部任何看门狗都不会运行，',
    '因此本 Issue 只有在 **外部触发器** 把人/机器叫醒并补跑一次后才会出现——',
    '这正是它存在的意义：让"沉默"本身变成一条可读的信号。',
  ].join('\n'));
} else {
  await resolve('longgame-schedule-silence', `心跳恢复：${nowIso}。`);
}

console.log(`heartbeat: overall=${payload.overall} critical=${critical.length} warn=${warns.length} healed=${heal.healed.length} alert_channel=${alertReady() ? 'github-issue' : 'stderr-only'}`);
for (const s of stateAfter.signals) console.log(`  [${s.severity}] ${s.id} — ${s.detail}`);
process.exitCode = critical.length ? 1 : 0;
