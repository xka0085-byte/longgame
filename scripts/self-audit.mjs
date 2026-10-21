// Self-audit for the longgame portfolio.
//
// Read-only with respect to portfolio.json and data/lines/*.json. It writes:
//   docs/status.json
//   docs/audit/latest.md
//
// This is a local self-check, not third-party verification. Missing data is
// represented as null / "never", never as a successful zero.
//
// Usage:
//   node scripts/self-audit.mjs
//   node scripts/self-audit.mjs --fixture c2pa-spec=C:\temp\c2pa-spec-fixture.json
//
// Optional flags (used by the local acceptance fixture):
//   --portfolio <path>   default portfolio.json
//   --data-dir <path>    default data/lines
//   --evidence <path>    default docs/evidence.json
//   --out <path>         default docs/status.json
//   --audit-out <path>   default docs/audit/latest.md
//   --now <ISO date>     override "now" for reproducible tests
//   --fixture <id>=<path> override one line's data file

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';

const root = process.cwd();

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function argValues(name) {
  const out = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === name && process.argv[i + 1]) out.push(process.argv[i + 1]);
  }
  return out;
}

const portfolioPath = resolve(root, argValue('--portfolio', 'portfolio.json'));
const dataDir = resolve(root, argValue('--data-dir', 'data/lines'));
const evidencePath = resolve(root, argValue('--evidence', 'docs/evidence.json'));
const outPath = resolve(root, argValue('--out', 'docs/status.json'));
const auditPath = resolve(root, argValue('--audit-out', 'docs/audit/latest.md'));
const nowRaw = argValue('--now', '');
const now = nowRaw ? new Date(nowRaw) : new Date();

if (Number.isNaN(now.getTime())) {
  console.error(`self-audit: invalid --now value: ${nowRaw}`);
  process.exit(1);
}

const fixtureMap = new Map();
for (const spec of argValues('--fixture')) {
  const eq = spec.indexOf('=');
  if (eq <= 0) {
    console.error(`self-audit: invalid --fixture "${spec}", expected id=path`);
    process.exit(1);
  }
  fixtureMap.set(spec.slice(0, eq), resolve(root, spec.slice(eq + 1)));
}

function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`${label} not found: ${path}`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`${label} is not valid JSON: ${path}: ${e.message}`);
  }
}

function readLineData(id) {
  const fixture = fixtureMap.get(id);
  const path = fixture || resolve(dataDir, `${id}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`line data is not valid JSON: ${path}: ${e.message}`);
  }
}

const portfolio = readJson(portfolioPath, 'portfolio.json');
if (!Array.isArray(portfolio.series)) {
  console.error('self-audit: portfolio.json has no series array');
  process.exit(1);
}
const series = portfolio.series;
const ids = new Set(series.map(s => s.id));

// Evidence is manually maintained. An absent file is an error: silently
// treating it as empty would hide a broken evidence registry.
const evidence = readJson(evidencePath, 'docs/evidence.json');
if (!Array.isArray(evidence)) {
  console.error('self-audit: docs/evidence.json must be an array');
  process.exit(1);
}
const EVIDENCE_TYPES = new Set(['citation', 'mention', 'reply', 'download', 'recompute']);
const DAY_MS = 24 * 60 * 60 * 1000;

function dateValue(s) {
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

for (const [i, e] of evidence.entries()) {
  const at = `evidence[${i}]`;
  if (!e || typeof e !== 'object') throw new Error(`${at} is not an object`);
  if (!ids.has(e.line_id)) throw new Error(`${at}.line_id is not in portfolio.json: ${e.line_id}`);
  if (!EVIDENCE_TYPES.has(e.type)) throw new Error(`${at}.type must be citation/mention/reply/download/recompute`);
  if (typeof e.url !== 'string' || !/^https?:\/\//i.test(e.url)) throw new Error(`${at}.url must be an http(s) URL`);
  if (dateValue(e.date) === null) throw new Error(`${at}.date is invalid: ${e.date}`);
  if (typeof e.note !== 'string') throw new Error(`${at}.note must be a string`);
}

const evidenceByLine = new Map();
for (const e of evidence) {
  if (!evidenceByLine.has(e.line_id)) evidenceByLine.set(e.line_id, []);
  evidenceByLine.get(e.line_id).push(e);
}

const CADENCE_DAYS = {
  daily: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  quarterly: 90,
  yearly: 365,
};

function expectedCadence(s) {
  const c = s?.cron?.collect;
  if (!c) return null;
  // Keep a missing / unknown cadence as null, not zero.
  return Object.prototype.hasOwnProperty.call(CADENCE_DAYS, c) ? CADENCE_DAYS[c] : null;
}

function pageStatus(page) {
  if (!page || typeof page !== 'object') return { usable: false, failed: true, detail: 'invalid page entry' };
  if (page.unavailable === true) return { usable: false, failed: true, detail: page.reason || 'unavailable' };
  if (page.error) return { usable: false, failed: true, detail: page.error };
  const status = Number(page.status);
  if (Number.isFinite(status)) {
    if (status >= 200 && status < 300) return { usable: true, failed: false, detail: null };
    return { usable: false, failed: true, detail: `http-${status}` };
  }
  // A page entry with a signature but no status is usable legacy data.
  if (page.sig) return { usable: true, failed: false, detail: null };
  return { usable: false, failed: true, detail: 'no status' };
}

function classifyRun(run) {
  if (!run || typeof run !== 'object') return { status: 'no-runs', success: false, detail: 'no runs' };
  if (typeof run.status === 'string' && run.status) {
    const unavailable = run.status === 'data-source-unavailable';
    return {
      status: run.status,
      success: !unavailable && run.status !== 'error' && run.status !== 'failed',
      detail: unavailable ? (run.reason || 'data-source-unavailable') : run.status,
    };
  }
  if (run.error) return { status: 'error', success: false, detail: run.error };

  const pageChecks = [];
  if (Array.isArray(run.pages)) {
    for (const p of run.pages) pageChecks.push(pageStatus(p));
  }
  if (run.dirs && typeof run.dirs === 'object') {
    for (const d of Object.values(run.dirs)) pageChecks.push(pageStatus(d));
  }
  const queryChecks = Array.isArray(run.queries)
    ? run.queries.map(q => (q && typeof q.thisMonth === 'number'
      ? { usable: true, failed: false, detail: null }
      : { usable: false, failed: true, detail: q?.keyword ? `${q.keyword}: no monthly value` : 'no monthly value' }))
    : [];

  if (run.eiaCounts && typeof run.eiaCounts === 'object') {
    return { status: 'ok', success: true, detail: null };
  }
  if (run.eia?.error) {
    return { status: 'error', success: false, detail: run.eia.error };
  }
  if (run.pointerCount != null) {
    return { status: 'ok', success: true, detail: null };
  }

  const checks = [...pageChecks, ...queryChecks];
  if (checks.length === 0) {
    // A run with no recognizable payload is not a success.
    return { status: 'unknown', success: false, detail: 'unrecognized run payload' };
  }
  const usable = checks.filter(c => c.usable).length;
  const failed = checks.filter(c => c.failed);
  if (usable === 0) {
    return { status: 'data-source-unavailable', success: false, detail: failed[0]?.detail || 'no usable source' };
  }
  if (failed.length > 0) {
    return {
      status: 'partial',
      success: true,
      detail: failed.map(f => f.detail).filter(Boolean).slice(0, 3).join('; '),
    };
  }
  return { status: 'ok', success: true, detail: null };
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().replace('T', ' ').replace('.000Z', 'Z');
}

function fmtAge(days) {
  // null means "no successful run", not zero days.
  return days == null ? '—' : String(days);
}

function sortedRuns(data) {
  const runs = data?.collect?.runs;
  if (!Array.isArray(runs)) return [];
  return runs
    .filter(r => r && dateValue(r.date) !== null)
    .slice()
    .sort((a, b) => dateValue(a.date) - dateValue(b.date));
}

function checkPage(id) {
  const p = resolve(root, 'docs/lines', `${id}.html`);
  if (!existsSync(p)) return { ok: false, detail: `missing ${p}` };
  try {
    const size = statSync(p).size;
    return size > 0 ? { ok: true, detail: null } : { ok: false, detail: `empty ${p}` };
  } catch (e) {
    return { ok: false, detail: e.message };
  }
}

const CSV_HEADER = 'date,source_file,operating_rows,planned_rows,planned_mw,canceled_rows,canceled_mw,retired_rows,retired_mw';
function checkCsv(id) {
  // Only grid-queue has a committed CSV artifact in this repository.
  if (id !== 'grid-queue') return { ok: null, detail: null };
  const p = resolve(root, 'docs/data/grid-queue-latest.csv');
  if (!existsSync(p)) return { ok: false, detail: `missing ${p}` };
  try {
    const text = readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return { ok: false, detail: 'no data row' };
    if (lines[0].trim() !== CSV_HEADER) return { ok: false, detail: 'header mismatch' };
    return { ok: true, detail: null };
  } catch (e) {
    return { ok: false, detail: e.message };
  }
}

const rows = [];
for (const s of series) {
  const data = readLineData(s.id);
  const runs = sortedRuns(data);
  const latestRun = runs.length ? runs[runs.length - 1] : null;
  const latest = latestRun ? classifyRun(latestRun) : { status: 'no-runs', success: false, detail: 'no runs' };

  let lastSuccess = null;
  for (const r of runs) {
    if (classifyRun(r).success) lastSuccess = r.date;
  }
  const lastSuccessMs = lastSuccess ? dateValue(lastSuccess) : null;
  const age = lastSuccessMs == null ? null : Math.max(0, Math.floor((now.getTime() - lastSuccessMs) / DAY_MS));

  let consecutiveFailures = null;
  if (runs.length) {
    consecutiveFailures = 0;
    for (let i = runs.length - 1; i >= 0; i--) {
      if (classifyRun(runs[i]).success) break;
      consecutiveFailures++;
    }
  }

  const cadence = expectedCadence(s);
  const external = typeof s.managed_in === 'string' && s.managed_in !== 'longgame';
  const sourceStatus = external ? 'external-managed' : (data ? latest.status : 'not-collected');
  let freshness;
  if (external) freshness = 'external';
  else if (age != null && cadence != null && age > cadence * 2) freshness = 'stale';
  else if (sourceStatus === 'data-source-unavailable') freshness = 'unavailable';
  else if (lastSuccess == null) freshness = 'never';
  else freshness = 'fresh';

  const page = checkPage(s.id);
  const csv = checkCsv(s.id);
  const cutoff = now.getTime() - 90 * DAY_MS;
  const evidenceCount = (evidenceByLine.get(s.id) || [])
    .filter(e => {
      const t = dateValue(e.date);
      return t != null && t >= cutoff && t <= now.getTime() + DAY_MS;
    }).length;

  rows.push({
    id: s.id,
    last_attempt_at: latestRun?.date ?? null,
    last_success_at: lastSuccess,
    consecutive_failures: consecutiveFailures,
    source_status: sourceStatus,
    data_age_days: age,
    expected_cadence_days: cadence,
    freshness,
    page_ok: page.ok,
    csv_ok: csv.ok,
    evidence_count_90d: evidenceCount,
    _status_detail: data ? latest.detail : (s.home ? 'external line; no local collector' : 'no data file'),
    _page_detail: page.detail,
    _csv_detail: csv.detail,
    _run_count: runs.length,
    _external: Boolean(s.home),
  });
}

// status.json must contain exactly the documented fields; internal audit
// details stay out of the machine-readable status file.
const status = {
  generated_at: now.toISOString(),
  lines: rows.map(r => ({
    id: r.id,
    last_attempt_at: r.last_attempt_at,
    last_success_at: r.last_success_at,
    consecutive_failures: r.consecutive_failures,
    source_status: r.source_status,
    data_age_days: r.data_age_days,
    expected_cadence_days: r.expected_cadence_days,
    freshness: r.freshness,
    page_ok: r.page_ok,
    csv_ok: r.csv_ok,
    evidence_count_90d: r.evidence_count_90d,
  })),
};

// fresh is least urgent; unavailable/stale/never are surfaced first.
const FRESHNESS_RANK = { unavailable: 0, stale: 1, never: 2, fresh: 3, external: 4 };
const auditRows = rows.slice().sort((a, b) => {
  const d = FRESHNESS_RANK[a.freshness] - FRESHNESS_RANK[b.freshness];
  return d || a.id.localeCompare(b.id);
});

function cell(v) {
  return String(v ?? '—').replace(/\|/g, '\\|');
}

const counts = auditRows.reduce((acc, r) => {
  acc[r.freshness] = (acc[r.freshness] || 0) + 1;
  return acc;
}, {});

const table = [
  '| 线 | freshness | 最近尝试 (UTC) | 最近成功 (UTC) | 未更新天数 | 连续失败 | source_status | page_ok | csv_ok | 90天证据 |',
  '|---|---|---|---|---:|---:|---|---|---|---:|',
  ...auditRows.map(r => `| ${cell(r.id)} | ${r.freshness} | ${cell(fmtDate(r.last_attempt_at))} | ${cell(fmtDate(r.last_success_at))} | ${cell(fmtAge(r.data_age_days))} | ${cell(r.consecutive_failures)} | ${cell(r.source_status)} | ${r.page_ok ? 'true' : 'false'} | ${r.csv_ok == null ? '—' : (r.csv_ok ? 'true' : 'false')} | ${r.evidence_count_90d} |`),
].join('\n');

const anomalyParts = new Map();
const addAnomaly = (id, text) => {
  if (!anomalyParts.has(id)) anomalyParts.set(id, []);
  anomalyParts.get(id).push(text);
};
for (const r of auditRows) {
  if (r.freshness !== 'fresh') {
    const ageText = r.last_success_at == null
      ? '无成功记录（不是 0 天）'
      : (r.data_age_days === 0 ? '最近成功不足 1 天前' : `${r.data_age_days} 天未更新`);
    const cadenceText = r.expected_cadence_days == null ? '无本地采集节奏' : `预期 ${r.expected_cadence_days} 天`;
    const err = r._status_detail ? `；最近状态/错误：${r._status_detail}` : '';
    addAnomaly(r.id, `${ageText}，${cadenceText}${err}`);
  } else if (r.source_status === 'partial') {
    addAnomaly(r.id, `部分来源失败：${r._status_detail || 'partial'}`);
  }
  if (!r.page_ok) {
    addAnomaly(r.id, `页面不可用（${r._page_detail || 'page_ok=false'}）`);
  }
  if (r.csv_ok === false) {
    addAnomaly(r.id, `CSV 不可用（${r._csv_detail || 'csv_ok=false'}）`);
  }
}
const anomalies = auditRows
  .filter(r => anomalyParts.has(r.id))
  .map(r => `- **${r.id}**：${anomalyParts.get(r.id).join('；')}。`);

// Proposals are evidence-triggered only. No evidence means no proposal.
// The rules are deliberately conservative: a citation/mention/reply/download
// is a demand signal for a citable artifact; a recompute is a signal to review
// the line's cadence. Nothing is proposed from freshness alone.
const proposalCandidates = [];
for (const [lineId, items] of evidenceByLine.entries()) {
  const urls = [...new Set(items.map(e => e.url).filter(Boolean))];
  if (urls.length === 0) continue;
  const types = [...new Set(items.map(e => e.type))];
  const notes = items.map(e => e.note).filter(Boolean).join(' ');
  let action = 'new-artifact';
  let reason = `该线已有 ${items.length} 条外部证据（${types.join('/')}）；建议把证据固化为可引用产物，供人工判断。`;
  if (/cadence|frequency|更新频率|更新节奏/i.test(notes)) {
    action = 'change-cadence';
    reason = `外部证据提示该线的更新节奏需要复核；先人工核对证据，再决定是否改 cadence。`;
  } else if (/retire|退役|停止跟踪|停止维护/i.test(notes)) {
    action = 'retire-line';
    reason = `外部证据出现退役/停止跟踪信号；先人工复核，不自动改线。`;
  }
  proposalCandidates.push({
    action,
    target: lineId,
    reason,
    evidence_urls: urls.slice(0, 5),
    effort: action === 'new-artifact' ? 'S' : 'M',
    risk: 'low',
  });
}
proposalCandidates.sort((a, b) => b.evidence_urls.length - a.evidence_urls.length || a.target.localeCompare(b.target));
const proposals = proposalCandidates.slice(0, 3);

const proposalLines = proposals.length
  ? proposals.map((p, i) => [
      `### P-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${String(i + 1).padStart(2, '0')}`,
      `- action: ${p.action}`,
      `- target: ${p.target}`,
      `- reason: ${p.reason}`,
      `- evidence_urls: ${p.evidence_urls.map(u => `<${u}>`).join(', ')}`,
      `- effort: ${p.effort}`,
      `- risk: ${p.risk}`,
    ].join('\n')).join('\n\n')
  : '本期 docs/evidence.json 无记录，不提提案。没有证据就不写提案。';

const audit = `# longgame 自我审计 ${now.toISOString().slice(0, 10)}

生成时间：${now.toISOString()}（UTC）。这是本地 self-audit 的状态汇总与提案，不是第三方复算，也不代表任何外部验证。

## 状态表

按 freshness 严重度排序：unavailable → stale → never → fresh。缺失值用 \`—\` 表示，不写成 0。

${table}

统计：fresh ${counts.fresh || 0}，stale ${counts.stale || 0}，unavailable ${counts.unavailable || 0}，never ${counts.never || 0}。

## 异常项

${anomalies.length ? anomalies.join('\n') : '无。'}

## 提案（最多 3 条）

${proposalLines}

---

审计只读 portfolio.json 与 data/lines/*.json；不修改任何线，不新增线，不对外发布。提案必须由 docs/evidence.json 中的证据触发，人工决定记录在 docs/decisions.md。
`;

mkdirSync(dirname(outPath), { recursive: true });
mkdirSync(dirname(auditPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(status, null, 2) + '\n', 'utf8');
writeFileSync(auditPath, audit, 'utf8');

console.log(`self-audit: ${status.lines.length} lines -> ${outPath}`);
console.log(`self-audit: audit -> ${auditPath}`);
console.log(`self-audit: freshness fresh=${counts.fresh || 0} stale=${counts.stale || 0} unavailable=${counts.unavailable || 0} never=${counts.never || 0}; proposals=${proposals.length}`);
