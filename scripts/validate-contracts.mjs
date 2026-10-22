// 数据契约校验器：只读 assurance/contracts/datasets/*.yaml 与契约声明的本地数据。
// 不修改任何数据；任何失败以非零退出码阻止发布。
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const CONTRACT_DIR = join(ROOT, 'assurance/contracts/datasets');
const portfolio = JSON.parse(readFileSync(join(ROOT, 'portfolio.json'), 'utf8'));
const errors = [];
const warnings = [];

function fail(id, msg) { errors.push(`${id}: ${msg}`); }
function warn(id, msg) { warnings.push(`${id}: ${msg}`); }

// ---- 最小 YAML 解析器：只支持本仓库契约使用的块状子集 ----
// 支持：缩进映射、`- key: value` 列表、标量、[]、内联数组、双/单引号字符串。
// 不支持：锚点、折叠块、多文档、行内注释。契约文件由本仓库生成器产出，结构受控。
function tokenize(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n];
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const indent = raw.match(/^ */)[0].length;
    if (indent % 2 !== 0) throw new Error(`line ${n + 1}: indent is not a multiple of 2`);
    out.push({ indent, text: raw.slice(indent).trimEnd(), line: n + 1 });
  }
  return out;
}

function parseScalar(s) {
  const t = s.trim();
  if (t === '[]') return [];
  if (t === '{}') return {};
  if (t === 'null' || t === '~') return null;
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^-?\d+$/.test(t)) return Number(t);
  if (/^-?\d+\.\d+$/.test(t)) return Number(t);
  if (t.startsWith('[') && t.endsWith(']')) {
    const inner = t.slice(1, -1).trim();
    if (!inner) return [];
    const parts = [];
    let cur = '', quote = null;
    for (let i = 0; i < inner.length; i++) {
      const c = inner[i];
      if (quote) {
        cur += c;
        if (c === quote && inner[i - 1] !== '\\') quote = null;
      } else if (c === '"' || c === "'") {
        quote = c; cur += c;
      } else if (c === ',') {
        parts.push(cur.trim()); cur = '';
      } else cur += c;
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts.map(parseScalar);
  }
  if (t.startsWith('"') && t.endsWith('"')) {
    try { return JSON.parse(t); } catch { throw new Error(`bad double-quoted string: ${t}`); }
  }
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  return t;
}

function parseYaml(text) {
  const tokens = tokenize(text);
  let i = 0;
  const isDash = (t) => t === '-' || t.startsWith('- ');

  function parseNode(indent) {
    if (i >= tokens.length || tokens[i].indent < indent) return null;
    if (isDash(tokens[i].text)) return parseArray(tokens[i].indent);
    return parseMap(tokens[i].indent);
  }

  function parseMap(indent) {
    const obj = {};
    while (i < tokens.length && tokens[i].indent === indent && !isDash(tokens[i].text)) {
      const tok = tokens[i];
      const m = tok.text.match(/^([^:]+):(.*)$/);
      if (!m) throw new Error(`line ${tok.line}: expected key: value, got ${tok.text}`);
      const key = m[1].trim();
      const rest = m[2].trim();
      i++;
      if (rest === '') {
        if (i < tokens.length && tokens[i].indent > indent) obj[key] = parseNode(tokens[i].indent);
        else obj[key] = null;
      } else {
        obj[key] = parseScalar(rest);
      }
    }
    return obj;
  }

  function parseArray(indent) {
    const arr = [];
    while (i < tokens.length && tokens[i].indent === indent && isDash(tokens[i].text)) {
      const tok = tokens[i];
      let content = tok.text === '-' ? '' : tok.text.slice(2).trim();
      i++;
      if (content === '') {
        if (i < tokens.length && tokens[i].indent > indent) arr.push(parseNode(tokens[i].indent));
        else arr.push(null);
        continue;
      }
      const looksLikeKey = !content.startsWith('"') && !content.startsWith("'") &&
        /^[A-Za-z0-9_.-]+:(\s|$)/.test(content);
      if (!looksLikeKey) {
        arr.push(parseScalar(content));
        continue;
      }
      const obj = {};
      const m = content.match(/^([^:]+):(.*)$/);
      const key = m[1].trim();
      const rest = m[2].trim();
      if (rest === '') {
        if (i < tokens.length && tokens[i].indent > indent + 2) obj[key] = parseNode(tokens[i].indent);
        else obj[key] = null;
      } else {
        obj[key] = parseScalar(rest);
      }
      if (i < tokens.length && tokens[i].indent === indent + 2 && !isDash(tokens[i].text)) {
        const more = parseMap(indent + 2);
        Object.assign(obj, more);
      }
      arr.push(obj);
    }
    return arr;
  }

  const value = parseNode(tokens.length ? tokens[0].indent : 0);
  if (i < tokens.length) throw new Error(`line ${tokens[i].line}: unexpected content`);
  return value;
}

function getPath(obj, path) {
  return path.split('.').reduce((cur, key) => (cur == null ? undefined : cur[key]), obj);
}

function checkType(value, type) {
  if (type === 'string') return typeof value === 'string';
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type.endsWith('|null')) {
    if (value === null) return true;
    return checkType(value, type.slice(0, -5));
  }
  return false;
}

function asArray(v) { return Array.isArray(v) ? v : []; }

const ids = new Set(portfolio.series.map((s) => s.id));
const files = existsSync(CONTRACT_DIR)
  ? readdirSync(CONTRACT_DIR).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml')).sort()
  : [];
const seen = new Set();
const contracts = [];

for (const file of files) {
  const full = join(CONTRACT_DIR, file);
  let c;
  try {
    c = parseYaml(readFileSync(full, 'utf8'));
  } catch (e) {
    fail(file, `YAML parse error: ${e.message}`);
    continue;
  }
  if (!c || typeof c !== 'object' || Array.isArray(c)) { fail(file, 'top level must be a mapping'); continue; }
  contracts.push(c);
  const id = c.id || file;
  if (seen.has(id)) fail(id, 'duplicate contract id');
  seen.add(id);
  if (!ids.has(id)) fail(id, 'id is not a series in portfolio.json');
  if (c.contract_version !== 1) fail(id, 'contract_version must be 1');
  if (!['enforced', 'contract-only', 'external'].includes(c.status)) fail(id, `invalid status ${c.status}`);
  if (!c.owner || typeof c.owner !== 'string') fail(id, 'owner is required (UNKNOWN allowed)');

  const src = c.source || {};
  if (!Array.isArray(src.hosts) || src.hosts.length === 0) fail(id, 'source.hosts must be a non-empty array');
  if (!src.url || typeof src.url !== 'string') fail(id, 'source.url is required');
  if (!src.license || typeof src.license !== 'string') fail(id, 'source.license is required (UNKNOWN allowed)');

  const schema = c.schema || {};
  const fields = asArray(schema.required_fields);
  if (!fields.length) fail(id, 'schema.required_fields must not be empty');
  for (const f of fields) {
    if (!f || typeof f !== 'object') { fail(id, 'required_fields item must be a mapping'); continue; }
    if (!f.path || typeof f.path !== 'string') fail(id, 'required field without path');
    if (!f.type || typeof f.type !== 'string') fail(id, `field ${f.path || '?'} without type`);
    if (!f.unit || typeof f.unit !== 'string') fail(id, `field ${f.path || '?'} without unit (UNKNOWN allowed)`);
    if (f.min != null && typeof f.min !== 'number') fail(id, `field ${f.path} min must be a number`);
  }
  if (!Array.isArray(schema.primary_key) || schema.primary_key.length === 0) fail(id, 'schema.primary_key must be non-empty');
  if (!schema.dedupe || !schema.dedupe.strategy || !schema.dedupe.basis) fail(id, 'schema.dedupe.strategy/basis required');
  for (const inv of asArray(schema.invariants)) {
    if (!inv.id || !inv.rule || !inv.basis) fail(id, 'invariant requires id/rule/basis');
  }
  if (!Array.isArray(c.units) || c.units.length === 0) fail(id, 'units must be a non-empty array');

  const fresh = c.freshness || {};
  if (!['daily', 'weekly', 'monthly', 'UNKNOWN'].includes(fresh.cadence)) fail(id, `invalid cadence ${fresh.cadence}`);
  if (!(fresh.max_age_days === 'UNKNOWN' || typeof fresh.max_age_days === 'number')) {
    fail(id, 'freshness.max_age_days must be a number or UNKNOWN');
  }
  if (typeof fresh.max_age_days === 'number' && (!fresh.basis || fresh.basis === 'UNKNOWN')) {
    fail(id, 'numeric max_age_days requires a non-UNKNOWN basis');
  }

  const fp = c.failure_policy || {};
  for (const k of ['on_http_error', 'on_429', 'on_empty', 'on_parse_error', 'on_missing_field', 'on_unit_mismatch', 'on_duplicate', 'on_source_host_mismatch']) {
    if (!['fail', 'warn', 'keep-previous'].includes(fp[k])) fail(id, `failure_policy.${k} must be fail|warn|keep-previous`);
    if (c.status === 'enforced' && fp[k] !== 'fail') fail(id, `enforced contract must fail on ${k}`);
  }

  const pub = c.publish || {};
  if (pub.require_gate !== true) fail(id, 'publish.require_gate must be true');
  if (!Array.isArray(pub.blocked_by) || pub.blocked_by.length === 0) fail(id, 'publish.blocked_by must be non-empty');

  const rev = c.review || {};
  if (!rev.last_reviewed) fail(id, 'review.last_reviewed required');
  if (!Array.isArray(rev.unresolved_assumptions)) fail(id, 'review.unresolved_assumptions must be an array');
}

for (const id of ids) if (!seen.has(id)) fail('portfolio', `series ${id} has no contract`);
if (contracts.length !== 13) fail('contracts', `expected 13 contract files, got ${contracts.length}`);

// ---- 强制契约：对真实本地数据执行字段、主键、不变量与来源主机检查 ----
function checkGrid(c) {
  const id = c.id;
  const rel = c.scope?.local_path;
  if (!rel || rel === 'UNKNOWN') { fail(id, 'enforced contract has no local_path'); return; }
  const full = join(ROOT, rel);
  if (!existsSync(full)) { fail(id, `data file missing: ${rel}`); return; }
  let st;
  try { st = JSON.parse(readFileSync(full, 'utf8')); }
  catch (e) { fail(id, `data file is not valid JSON: ${e.message}`); return; }
  const runs = st.collect?.runs;
  if (!Array.isArray(runs) || runs.length === 0) { fail(id, 'collect.runs is empty'); return; }

  const dates = runs.map((r) => r.date);
  const dupDates = dates.filter((d, i) => dates.indexOf(d) !== i);
  if (dupDates.length) fail(id, `duplicate run.date: ${[...new Set(dupDates)].join(', ')}`);

  const latest = runs.at(-1);
  if (latest?.eia?.error) fail(id, `latest run records collection error: ${latest.eia.error}`);
  if (latest?.eia?.parseError) fail(id, `latest run records parse error: ${latest.eia.parseError}`);
  if (!latest?.eiaCounts || typeof latest.eiaCounts !== 'object') {
    fail(id, 'latest run has no eiaCounts (failed collection must not be published)');
  }

  const last = [...runs].reverse().find((r) => r.eiaCounts && typeof r.eiaCounts === 'object');
  if (!last) { fail(id, 'no run with eiaCounts'); return; }

  for (const f of asArray(c.schema.required_fields)) {
    const v = getPath(last, f.path);
    if (v === undefined) { fail(id, `missing required field ${f.path}`); continue; }
    if (!checkType(v, f.type)) { fail(id, `${f.path} expected ${f.type}, got ${v === null ? 'null' : typeof v}`); continue; }
    if (typeof f.min === 'number' && typeof v === 'number' && v < f.min) fail(id, `${f.path}=${v} below min ${f.min}`);
  }

  const e = last.eiaCounts;
  if (typeof e.file === 'string' && !/\.(xlsx|xls)$/i.test(e.file)) fail(id, `eiaCounts.file is not an xlsx file: ${e.file}`);
  const url = last.eia?.url;
  if (!url) fail(id, 'missing eia.url (source evidence)');
  else {
    let host;
    try { host = new URL(url).host; } catch { fail(id, `eia.url is not a URL: ${url}`); }
    if (host && !asArray(c.source.hosts).includes(host)) fail(id, `source host ${host} not allowed`);
  }

  for (const [countKey, mwKey] of [['planned', 'plannedMW'], ['canceled', 'canceledMW'], ['retired', 'retiredMW']]) {
    if (typeof e[countKey] === 'number' && e[countKey] > 0 && !(typeof e[mwKey] === 'number' && e[mwKey] > 0)) {
      fail(id, `invariant violated: ${countKey}=${e[countKey]} but ${mwKey}=${e[mwKey]} (column missing or parse failure)`);
    }
  }

  const summary = last.eia?.summary;
  if (summary) {
    for (const [k, sk] of [['planned', 'Planned'], ['canceled', 'Canceled or Postponed'], ['retired', 'Retired'], ['operating', 'Operating']]) {
      if (typeof e[k] === 'number' && typeof summary.sheets?.[sk] === 'number' && e[k] !== summary.sheets[sk]) {
        fail(id, `eiaCounts.${k} (${e[k]}) disagrees with eia.summary.sheets.${sk} (${summary.sheets[sk]})`);
      }
    }
    for (const [k, sk] of [['plannedMW', 'plannedMW'], ['canceledMW', 'canceledMW'], ['retiredMW', 'retiredMW']]) {
      if (typeof e[k] === 'number' && typeof summary[sk] === 'number' && Math.abs(e[k] - summary[sk]) > 1e-9) {
        fail(id, `eiaCounts.${k} (${e[k]}) disagrees with eia.summary.${sk} (${summary[sk]})`);
      }
    }
  }
}

for (const c of contracts) {
  if (c.status === 'enforced') {
    if (c.id === 'grid-queue') checkGrid(c);
    else warn(c.id, 'enforced contract has no registered data checker; only shape was validated');
  }
}

for (const w of warnings) console.log(`WARN ${w}`);
for (const e of errors) console.log(`FAIL ${e}`);
console.log(`\nvalidate-contracts: ${contracts.length} contracts, ${errors.length} failures`);
process.exitCode = errors.length ? 1 : 0;
