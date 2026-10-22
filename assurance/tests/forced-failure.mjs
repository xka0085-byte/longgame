// 强制失败验收：对三条线各自复制一份沙箱，破坏该线的 normal 样本，
// 确认 assurance-gate 失败且 publish 被拦，真实 data/lines 哈希不变。
// 不修改工作树，所有注入在系统临时目录中的副本里完成。
import {
  readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, rmSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const ROOT = process.cwd();
const WORK = join(tmpdir(), 'longgame-forced-failure');

const shaFile = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n');

function copyRepo(dest) {
  cpSync(ROOT, dest, {
    recursive: true,
    filter: (src) => {
      const rel = relative(ROOT, src).replace(/\\/g, '/');
      if (!rel) return true;
      if (rel === '.git' || rel.startsWith('.git/')) return false;
      if (rel === 'node_modules' || rel.startsWith('node_modules/')) return false;
      if (rel.startsWith('assurance/.staging')) return false;
      if (rel.startsWith('assurance/.gate')) return false;
      if (rel.startsWith('assurance/fault-injection/work')) return false;
      if (rel.startsWith('assurance/fault-injection/guard-work')) return false;
      if (rel.startsWith('assurance/fault-injection/logs')) return false;
      return true;
    },
  });
}

function runNode(sandbox, script, timeout = 300000) {
  const r = spawnSync(process.execPath, [script], { cwd: sandbox, encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status === null ? 1 : r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

const CASES = [
  {
    line: 'agent-dirs',
    mutate(sb) {
      const p = join(sb, 'assurance/fixtures/agent-dirs/normal.json');
      const st = readJson(p);
      st.collect.runs[0].dirs = {};
      writeJson(p, st);
    },
  },
  {
    line: 'eidas-tsl',
    mutate(sb) {
      const p = join(sb, 'assurance/fixtures/eidas-tsl/normal.json');
      const st = readJson(p);
      st.collect.runs[0].pointers = [];
      st.collect.runs[0].pointerCount = 0;
      writeJson(p, st);
    },
  },
  {
    line: 'formd-sweep',
    mutate(sb) {
      const p = join(sb, 'assurance/fixtures/formd-sweep/normal.json');
      const st = readJson(p);
      st.collect.runs[0].queries = [];
      writeJson(p, st);
    },
  },
];

function refreshManifest(sb, line) {
  const dir = join(sb, 'assurance/fixtures', line);
  const mp = join(dir, 'manifest.json');
  const m = readJson(mp);
  for (const s of m.samples) if (s.file === 'normal.json') s.sha256 = shaFile(join(dir, 'normal.json'));
  writeJson(mp, m);
}

const realBefore = {};
for (const c of CASES) realBefore[c.line] = shaFile(join(ROOT, 'data/lines', `${c.line}.json`));

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
const results = [];

for (const c of CASES) {
  const sb = join(WORK, c.line);
  copyRepo(sb);
  const dataPath = join(sb, 'data/lines', `${c.line}.json`);
  const sandboxBefore = shaFile(dataPath);
  c.mutate(sb);
  refreshManifest(sb, c.line);
  const sampleAfter = shaFile(join(sb, 'assurance/fixtures', c.line, 'normal.json'));

  const gate = runNode(sb, 'scripts/assurance-gate.mjs');
  const publish = runNode(sb, 'scripts/publish.mjs');
  const sandboxAfter = shaFile(dataPath);
  const gateResultPath = join(sb, 'assurance/.gate/result.json');
  let failedCheck = null;
  if (existsSync(gateResultPath)) {
    try { failedCheck = readJson(gateResultPath).checks.find((x) => x.exitCode !== 0)?.name ?? null; } catch { /* 保持 null */ }
  }
  const publishBlocked = publish.code !== 0 && /publish blocked by assurance gate/.test(publish.out);
  results.push({
    line: c.line,
    sample: `assurance/fixtures/${c.line}/normal.json`,
    sample_sha256_after_mutation: sampleAfter,
    gate_exit: gate.code,
    gate_failed_check: failedCheck,
    publish_exit: publish.code,
    publish_blocked: publishBlocked,
    sandbox_data_hash_before: sandboxBefore,
    sandbox_data_hash_after_publish: sandboxAfter,
    sandbox_data_unchanged: sandboxBefore === sandboxAfter,
    real_data_unchanged: shaFile(join(ROOT, 'data/lines', `${c.line}.json`)) === realBefore[c.line],
    pass: gate.code !== 0 && publishBlocked && sandboxBefore === sandboxAfter,
  });
  console.log(`${results.at(-1).pass ? 'BLOCKED' : 'NOT-BLOCKED'} ${c.line}: gate=${gate.code} (${failedCheck ?? 'unknown'}), publish=${publish.code}, sandboxDataUnchanged=${sandboxBefore === sandboxAfter}`);
}

const allPass = results.every((r) => r.pass && r.real_data_unchanged);
mkdirSync(join(ROOT, 'assurance/results'), { recursive: true });
writeJson(join(ROOT, 'assurance/results/forced-failure.json'), {
  generated_at: new Date().toISOString(),
  commit: (() => { try { return spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim(); } catch { return 'UNKNOWN'; } })(),
  all_blocked: allPass,
  cases: results,
});
console.log(`\nforced-failure: ${results.length} lines, allBlocked=${allPass}, realDataUnchanged=${results.every((r) => r.real_data_unchanged)}`);
process.exitCode = allPass ? 0 : 1;
