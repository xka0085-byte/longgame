// self-upgrade：让这套组合对自己的"运行策略"做有限、可回滚、带证据的自动升级。
//
// 为什么不是"自动改代码"：
//   自动改解析逻辑、自动合并 PR 这类事一旦出错，会把一条本来只是降级的数据线变成
//   一条**看起来正常但是错的**数据线。这套项目对外只承诺"可复核"，所以自我升级的
//   范围被硬限制在**策略参数**，不碰解析器、不碰证据、不碰门禁阈值、不碰 assurance_level。
//
// 允许自动改的（白名单，代码里写死）：
//   1. portfolio.json 里 collect.pages[].tolerate / tolerate_reason
//      条件：该页最近连续 ≥3 轮不可用、近 20 轮零成功、失败状态全部属于反爬/限流集合
//      （202/403/417/429 或 fetch-error）。这只会让"已知抓不到的源"不再阻断整轮，
//      不改变任何已写入的数据。
//   2. data/self-tuning.json 的周期容忍天数
//      条件：该线真实采集间隔长期大于名义周期（说明参数定得比现实更紧），每次加 1 天，
//      上限 weekly +3 / monthly +7。
//
// 每一处变更都必须：留 before/after、留证据、留回滚方式，并当场跑 verify + contracts
// 两个门禁；任一不过立即把文件还原成变更前的原文。
//
// 用法：
//   node scripts/self-upgrade.mjs --dry-run    # 只出计划
//   node scripts/self-upgrade.mjs              # 执行（含门禁校验与自动回滚）

import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';

const nowIso = process.env.LONGGAME_NOW || new Date().toISOString();
const today = process.env.LONGGAME_TODAY || nowIso.slice(0, 10);
const dryRun = process.argv.includes('--dry-run');

const PORTFOLIO = 'portfolio.json';
const TUNING = 'data/self-tuning.json';
const LOG = 'data/self-upgrade-log.jsonl';
const DIAG = 'data/diagnostics.json';

const ANTI_BOT = new Set([202, 403, 417, 429]);
const LIMITS = { weeklyMaxGrace: 3, monthlyMaxGrace: 7 };

function readJson(p, fb = null) {
  if (!existsSync(p)) return fb;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fb; }
}
function days(iso) {
  const t = Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(t) ? null : t / 86400000;
}

const portfolioText = readFileSync(PORTFOLIO, 'utf8');
const portfolio = JSON.parse(portfolioText);
const tuningDoc = readJson(TUNING, { thresholds: {}, note: null }) || { thresholds: {} };
const tuningText = existsSync(TUNING) ? readFileSync(TUNING, 'utf8') : null;

const changes = [];
const diagnoses = [];

// ---------- 分析每一页的可得性历史 ----------
for (const s of portfolio.series) {
  const pages = s.collect?.type === 'pages' ? s.collect.pages : null;
  const data = readJson(`data/lines/${s.id}.json`);
  const runs = (data?.collect?.runs || []).slice(-20);
  if (!runs.length) continue;

  if (pages) {
    for (const p of pages) {
      const seq = runs.map(r => (r.pages || []).find(x => x.id === p.id)).filter(Boolean);
      if (!seq.length) continue;
      const okCount = seq.filter(x => x.unavailable !== true).length;
      let streak = 0;
      for (let i = seq.length - 1; i >= 0; i--) {
        if (seq[i].unavailable === true) streak += 1; else break;
      }
      const failCodes = [...new Set(seq.filter(x => x.unavailable === true).map(x => x.status ?? 'fetch-error'))];
      const allAntiBot = failCodes.length > 0 && failCodes.every(c => c === 'fetch-error' || ANTI_BOT.has(c));
      const already = p.tolerate === true;

      if (!already && streak >= 3 && okCount === 0 && allAntiBot) {
        changes.push({
          kind: 'tolerate-page',
          target: `${s.id}/${p.id}`,
          apply() {
            p.tolerate = true;
            p.tolerate_reason = `自动标记 ${today}：连续 ${streak} 轮不可用、近 ${seq.length} 轮零成功，失败状态 ${JSON.stringify(failCodes)} 属反爬/限流类环境拦截。容错只表示该页不再阻断整轮采集，不写入任何零值，保留上次数据。回滚：删除该页 tolerate 与 tolerate_reason。`;
          },
          evidence: { consecutive_unavailable: streak, rounds_observed: seq.length, ok_rounds: okCount, fail_codes: failCodes },
          rollback: `删除 portfolio.json 中 ${s.id}.collect.pages[id=${p.id}] 的 tolerate / tolerate_reason`,
        });
      }

      if (streak >= 2 && okCount > 0 && !already) {
        diagnoses.push({
          id: `${s.id}/${p.id}`, kind: 'intermittent',
          detail: `近 ${seq.length} 轮中成功 ${okCount} 轮、当前连续不可用 ${streak} 轮，属间歇性拦截，不自动 tolerate（会掩盖真实故障），留待人工判断`,
        });
      }
      if (already && streak >= 6) {
        diagnoses.push({
          id: `${s.id}/${p.id}`, kind: 'tolerated-long-outage',
          detail: `已标记 tolerate，但近 ${seq.length} 轮只有 ${okCount} 轮成功、当前连续 ${streak} 轮不可用——需人工确认该源是否已永久下线/改版，若是则应把这条线降级而不是继续占位`,
        });
      }
    }
  }

  // ---------- 周期参数自适应 ----------
  const collectRuns = (data?.collect?.runs || []);
  if (collectRuns.length >= 4 && s.cron?.collect) {
    const ds = collectRuns.map(r => days(r.date)).filter(Boolean).sort((a, b) => a - b);
    const gaps = [];
    for (let i = 1; i < ds.length; i++) gaps.push(ds[i] - ds[i - 1]);
    const nominal = s.cron.collect === 'monthly' ? 30 : 7;
    if (gaps.length >= 3) {
      const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const key = s.cron.collect === 'monthly' ? 'monthlyGraceDays' : 'weeklyGraceDays';
      const current = tuningDoc.thresholds?.[key] ?? (s.cron.collect === 'monthly' ? 3 : 1);
      const cap = s.cron.collect === 'monthly' ? LIMITS.monthlyMaxGrace : LIMITS.weeklyMaxGrace;
      // 真实节奏比名义周期更松，且还没到上限 → 放宽 1 天（有真实间隔分布作证）
      if (avg > nominal && avg < nominal * 2 && current < cap) {
        changes.push({
          kind: 'relax-cadence',
          target: `tuning.${key} (${s.id} 驱动)`,
          apply() {
            tuningDoc.thresholds = tuningDoc.thresholds || {};
            tuningDoc.thresholds[key] = current + 1;
            tuningDoc.note = `由 self-upgrade.mjs 于 ${today} 自动调整：${s.id} 实际采集间隔均值 ${avg.toFixed(1)} 天 > 名义 ${nominal} 天。上限 ${cap}。`;
          },
          evidence: { line: s.id, avg_gap_days: Number(avg.toFixed(2)), samples: gaps.length, from: current, to: current + 1 },
          rollback: `把 ${TUNING} 中 thresholds.${key} 改回 ${current}`,
        });
      }
    }
  }
}

// ---------- 执行 ----------
function runGate() {
  const checks = [
    ['verify', 'scripts/verify.mjs'],
    ['contracts', 'scripts/validate-contracts.mjs'],
  ];
  for (const [name, script] of checks) {
    const r = spawnSync(process.execPath, [script], { stdio: 'inherit', timeout: 180000 });
    if ((r.status ?? 1) !== 0) return { ok: false, failed: name };
  }
  return { ok: true };
}

mkdirSync(dirname(LOG), { recursive: true });
const applied = [];
let reverted = null;

if (!changes.length) {
  console.log(`self-upgrade: 无需变更（${today}）`);
} else {
  console.log(`self-upgrade: ${changes.length} 项候选变更`);
  for (const c of changes) console.log(`  - ${c.kind} ${c.target}`);

  if (dryRun) {
    for (const c of changes) console.log(`  [dry-run] ${c.kind} ${c.target} :: ${JSON.stringify(c.evidence)}`);
  } else {
    for (const c of changes) c.apply();
    writeFileSync(PORTFOLIO, JSON.stringify(portfolio, null, 2) + '\n');
    writeFileSync(TUNING, JSON.stringify(tuningDoc, null, 2) + '\n');

    const gate = runGate();
    if (!gate.ok) {
      // 门禁不过 = 这次"升级"不成立，原样退回
      writeFileSync(PORTFOLIO, portfolioText);
      if (tuningText === null) {
        if (existsSync(TUNING)) writeFileSync(TUNING, JSON.stringify({ thresholds: {}, note: 'rollback: 变更未通过门禁' }, null, 2) + '\n');
      } else {
        writeFileSync(TUNING, tuningText);
      }
      reverted = gate.failed;
      console.error(`self-upgrade: 门禁 ${gate.failed} 未通过，已回滚全部变更`);
    } else {
      applied.push(...changes.map(c => ({ kind: c.kind, target: c.target })));
      for (const c of changes) {
        appendFileSync(LOG, JSON.stringify({
          at: nowIso, kind: c.kind, target: c.target, evidence: c.evidence,
          gate: 'verify+contracts PASS', rollback: c.rollback,
        }) + '\n');
      }
    }
  }
}

const diagDoc = {
  generated_at: nowIso,
  changes_proposed: changes.map(c => ({ kind: c.kind, target: c.target, evidence: c.evidence })),
  changes_applied: applied,
  reverted_by_gate: reverted,
  observations: diagnoses,
  note: '诊断只记录现象与建议，不改代码。任何"看起来像 bug"的判断都需要人确认后才动解析器。',
};
writeFileSync(DIAG, JSON.stringify(diagDoc, null, 2) + '\n');

for (const d of diagnoses) console.log(`  [diagnosis] ${d.id} ${d.kind} — ${d.detail}`);
process.exitCode = reverted ? 1 : 0;
