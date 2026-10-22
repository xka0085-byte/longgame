// 固定样本执行器：按 manifest 逐样本执行，独立校验，仅凭退出码判定。
// 不修改任何生产数据；只读 assurance/fixtures 下的样本文件。
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateRun, sha256File } from './lib/assurance-core.mjs';

const ROOT = process.cwd();
const FIXTURE_ROOT = join(ROOT, 'assurance/fixtures');
const EIA_HOST = 'www.eia.gov';
const EXTERNAL = new Set(['mcpreflight-weekly', 'erc8004-snapshot', 'protocol-watch']);
const results = [];

function isHostAllowed(url, hosts) {
  let host;
  try { host = new URL(url).host; } catch { return false; }
  return hosts.includes(host);
}

function evaluateGrid(data) {
  const errors = [];
  if (!Array.isArray(data)) { errors.push('root is not an array'); return errors; }
  if (data.length === 0) errors.push('empty dataset');
  const keys = new Set();
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    if (!r || typeof r !== 'object' || Array.isArray(r)) { errors.push(`row ${i} is not an object`); continue; }
    for (const f of ['period', 'plant_id', 'generator_id', 'status', 'capacity_mw', 'capacity_unit', 'source_url']) {
      if (!(f in r)) errors.push(`row ${i} missing field ${f}`);
    }
    if (typeof r.plant_id !== 'string' || !r.plant_id) errors.push(`row ${i} plant_id must be non-empty string`);
    if (typeof r.generator_id !== 'string' || !r.generator_id) errors.push(`row ${i} generator_id must be non-empty string`);
    if (typeof r.status !== 'string' || !r.status) errors.push(`row ${i} status must be non-empty string`);
    if (typeof r.capacity_mw !== 'number' || !Number.isFinite(r.capacity_mw)) errors.push(`row ${i} capacity_mw must be a finite number`);
    if (r.capacity_mw < 0) errors.push(`row ${i} capacity_mw is negative`);
    if (r.capacity_unit !== 'MW') errors.push(`row ${i} capacity_unit must be MW, got ${JSON.stringify(r.capacity_unit)}`);
    if (typeof r.source_url !== 'string' || !isHostAllowed(r.source_url, [EIA_HOST])) {
      errors.push(`row ${i} source host is not allowed: ${JSON.stringify(r.source_url)}`);
    }
    const key = `${r.period}|${r.plant_id}|${r.generator_id}`;
    if (keys.has(key)) errors.push(`duplicate key ${key}`);
    keys.add(key);
    if (typeof r.capacity_mw === 'number') sum += r.capacity_mw;
  }
  return { errors, values: { record_count: data.length, sum_capacity_mw: Math.round(sum * 1e6) / 1e6 } };
}

const MP_STATUS = new Set(['PASS', 'FAIL', 'AUTH_GATED', 'UNKNOWN']);
function evaluateMcpreflight(data, target) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) { errors.push('root is not an object'); return errors; }
  if (!Array.isArray(data.results)) { errors.push('results is not an array'); return errors; }
  if (data.results.length === 0) errors.push('empty results');
  const names = new Set();
  for (let i = 0; i < data.results.length; i++) {
    const r = data.results[i];
    if (!r || typeof r !== 'object' || Array.isArray(r)) { errors.push(`result ${i} is not an object`); continue; }
    for (const f of ['name', 'finalStatus', 'url', 'checkedAt', 'findings']) {
      if (!(f in r)) errors.push(`result ${i} missing field ${f}`);
    }
    if (typeof r.name !== 'string' || !r.name) errors.push(`result ${i} name must be non-empty string`);
    if (typeof r.finalStatus !== 'string' || !MP_STATUS.has(r.finalStatus)) {
      errors.push(`result ${i} finalStatus must be PASS|FAIL|AUTH_GATED|UNKNOWN, got ${JSON.stringify(r.finalStatus)}`);
    }
    if (typeof r.url !== 'string' || !/^https?:\/\//.test(r.url)) errors.push(`result ${i} url must be http(s)`);
    if (!r.findings || !Array.isArray(r.findings)) errors.push(`result ${i} findings must be an array`);
    if (!(r.toolCount === null || (Number.isInteger(r.toolCount) && r.toolCount >= 0))) {
      errors.push(`result ${i} toolCount must be integer or null, got ${JSON.stringify(r.toolCount)}`);
    }
    if (typeof r.checkedAt !== 'string' || Number.isNaN(Date.parse(r.checkedAt))) errors.push(`result ${i} checkedAt must be an ISO timestamp`);
    if (r.name && names.has(r.name)) errors.push(`duplicate key ${r.name}`);
    if (r.name) names.add(r.name);
    if (target === 'publish-eligibility' && r.finalStatus === 'UNKNOWN') {
      errors.push(`result ${nameOr(r, i)} is UNKNOWN and must not be published as PASS`);
    }
  }
  return { errors, values: { result_count: data.results.length } };
}

function nameOr(r, i) { return r && r.name ? r.name : `#${i}`; }

const manifestDirs = readdirSync(FIXTURE_ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((name) => existsSync(join(FIXTURE_ROOT, name, 'manifest.json')) || existsSync(join(FIXTURE_ROOT, name, 'NOT_APPLICABLE.md')))
  .sort();

for (const dataset of manifestDirs) {
  const dir = join(FIXTURE_ROOT, dataset);
  const marker = join(dir, 'NOT_APPLICABLE.md');
  if (EXTERNAL.has(dataset) || existsSync(marker)) {
    const text = existsSync(marker) ? readFileSync(marker, 'utf8') : '';
    const ok = /NOT_APPLICABLE/.test(text) && /原因/.test(text);
    results.push({ dataset, file: 'NOT_APPLICABLE.md', status: ok ? 'PASS' : 'FAIL', errors: ok ? [] : ['external fixture marker must state NOT_APPLICABLE and a reason'] });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${dataset}: NOT_APPLICABLE (external, no synthetic samples)`);
    continue;
  }

  const manifestPath = join(dir, 'manifest.json');
  let manifest;
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); }
  catch (e) { results.push({ dataset, file: 'manifest.json', status: 'FAIL', errors: [`manifest parse: ${e.message}`] }); continue; }

  const lineId = manifest.line || dataset;
  const minSamples = dataset === 'grid-queue' || dataset === 'mcpreflight' ? 6 : 3;
  if (!Array.isArray(manifest.samples) || manifest.samples.length < minSamples) {
    results.push({ dataset, file: 'manifest.json', status: 'FAIL', errors: [`manifest must list at least ${minSamples} samples`] });
  }
  const kinds = new Set((manifest.samples || []).map((s) => s.kind));
  for (const kind of ['normal', 'empty', 'invalid']) {
    if (!kinds.has(kind)) results.push({ dataset, file: 'manifest.json', status: 'FAIL', errors: [`missing sample kind: ${kind}`] });
  }

  for (const sample of manifest.samples || []) {
    const file = join(dir, sample.file);
    const rec = { dataset, file: sample.file, target: sample.target, expected: sample.expected, status: 'FAIL', errors: [], checks: [], observed: null };
    if (!existsSync(file)) { rec.errors.push('sample file missing'); results.push(rec); continue; }
    for (const key of ['sha256', 'source', 'target', 'expected', 'basis']) {
      if (!sample[key]) rec.errors.push(`manifest sample missing ${key}`);
    }
    try {
      const actualHash = sha256File(file);
      if (actualHash !== sample.sha256) rec.checks.push(`sha256 mismatch: expected ${sample.sha256}, got ${actualHash}`);
      const data = JSON.parse(readFileSync(file, 'utf8'));
      const ev = dataset === 'grid-queue'
        ? evaluateGrid(data)
        : dataset === 'mcpreflight'
          ? evaluateMcpreflight(data, sample.target)
          : { errors: evaluateRun(lineId, data, { strict: true }), values: null };
      rec.checks.push(...ev.errors);
      rec.observed = ev.values || null;

      if (sample.expected === 'pass') {
        if (rec.checks.length > 0) rec.errors.push('expected pass but checks failed');
      } else if (sample.expected === 'fail') {
        if (rec.checks.length === 0) rec.errors.push('expected fail but checks passed');
        else if (sample.expected_error_contains && !rec.checks.join(' ').includes(sample.expected_error_contains)) {
          rec.errors.push(`expected error containing "${sample.expected_error_contains}" not found`);
        }
      } else {
        rec.errors.push(`invalid expected value: ${sample.expected}`);
      }
      if (sample.expected === 'pass' && sample.expected_values && rec.observed) {
        for (const [k, v] of Object.entries(sample.expected_values)) {
          if (rec.observed[k] !== v) rec.errors.push(`expected value ${k}=${v}, got ${rec.observed[k]}`);
        }
      }
    } catch (e) {
      rec.errors.push(`execution error: ${e.message}`);
    }
    rec.status = rec.errors.length ? 'FAIL' : 'PASS';
    results.push(rec);
    const detail = rec.errors.length ? rec.errors.join('; ') : (rec.checks.length ? `expected rejection: ${rec.checks.join('; ')}` : 'ok');
    console.log(`${rec.status} ${dataset}/${rec.file} (${sample.target}): ${detail}`);
  }
}

const failed = results.filter((r) => r.status !== 'PASS');
mkdirSync(join(ROOT, 'assurance/results'), { recursive: true });
writeFileSync(join(ROOT, 'assurance/results/fixtures.json'), JSON.stringify({
  at: new Date().toISOString(),
  samples: results.length,
  passed: results.length - failed.length,
  failed: failed.length,
  results,
}, null, 2) + '\n');
console.log(`\nrun-fixtures: ${results.length} samples, ${results.length - failed.length} passed, ${failed.length} failed`);
process.exitCode = failed.length ? 1 : 0;
