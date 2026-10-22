// 故障注入：每种故障在独立沙箱副本中注入，真实仓库 data/lines 不被修改。
// 判定标准：gate 非零退出、publish 被门禁拒绝、最后一份有效数据未被 publish 覆盖。
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const ROOT = process.cwd();
// 沙箱必须放在仓库之外：cpSync 不允许把仓库复制进自身的子目录。
const WORK = process.env.LONGGAME_FI_WORK || join(tmpdir(), 'longgame-fault-injection');
const LOGS = join(ROOT, 'assurance/fault-injection/logs');
mkdirSync(WORK, { recursive: true });
mkdirSync(LOGS, { recursive: true });

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const shaFile = (p) => sha(readFileSync(p));
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n');

function realDataHashes() {
  const dir = join(ROOT, 'data/lines');
  const out = {};
  for (const f of readdirSync(dir).sort()) {
    if (f.endsWith('.json')) out[f] = shaFile(join(dir, f));
  }
  return out;
}

function copyRepo(dest) {
  cpSync(ROOT, dest, {
    recursive: true,
    filter: (src) => {
      const rel = relative(ROOT, src).replace(/\\/g, '/');
      if (!rel) return true;
      if (rel === '.git' || rel.startsWith('.git/')) return false;
      if (rel === 'node_modules' || rel.startsWith('node_modules/')) return false;
      if (rel.startsWith('assurance/fault-injection/work')) return false;
      if (rel.startsWith('assurance/fault-injection/guard-work')) return false;
      if (rel.startsWith('assurance/fault-injection/logs')) return false;
      if (rel.startsWith('assurance/.gate')) return false;
      return true;
    },
  });
}

function updateManifest(sandbox, dataset, file) {
  const dir = join(sandbox, 'assurance/fixtures', dataset);
  const manifestPath = join(dir, 'manifest.json');
  const manifest = readJson(manifestPath);
  for (const s of manifest.samples) {
    if (s.file === file) s.sha256 = shaFile(join(dir, file));
  }
  writeJson(manifestPath, manifest);
}

function lastValidRunHash(dataPath) {
  const st = readJson(dataPath);
  const runs = st.collect?.runs || [];
  const valid = runs.filter((r) => r.eiaCounts && typeof r.eiaCounts === 'object' && r.eiaCounts.bytes > 0);
  if (!valid.length) return null;
  return { date: valid.at(-1).date, hash: sha(JSON.stringify(valid.at(-1))) };
}

function runNode(sandbox, script, timeout = 240000) {
  const r = spawnSync(process.execPath, [script], { cwd: sandbox, encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status === null ? 1 : r.status, signal: r.signal, out: `${r.stdout || ''}${r.stderr || ''}` };
}

const FAULTS = [
  {
    id: 'column-rename',
    target: 'fixtures/grid-queue/normal.json',
    expectedBlockPoint: 'fixtures',
    mutate(sandbox) {
      const p = join(sandbox, 'assurance/fixtures/grid-queue/normal.json');
      const rows = readJson(p);
      for (const r of rows) { r.capacity = r.capacity_mw; delete r.capacity_mw; }
      writeJson(p, rows);
      updateManifest(sandbox, 'grid-queue', 'normal.json');
    },
  },
  {
    id: 'unit-mw-to-gw',
    target: 'fixtures/grid-queue/normal.json',
    expectedBlockPoint: 'fixtures',
    mutate(sandbox) {
      const p = join(sandbox, 'assurance/fixtures/grid-queue/normal.json');
      const rows = readJson(p);
      for (const r of rows) { r.capacity_mw = r.capacity_mw / 1000; r.capacity_unit = 'GW'; }
      writeJson(p, rows);
      updateManifest(sandbox, 'grid-queue', 'normal.json');
    },
  },
  {
    id: 'empty-response',
    target: 'data/lines/grid-queue.json',
    expectedBlockPoint: 'contracts',
    mutate(sandbox) {
      const p = join(sandbox, 'data/lines/grid-queue.json');
      const st = readJson(p);
      st.collect.runs.push({
        date: '2026-10-21T09:00:00.000Z',
        eia: { url: 'https://www.eia.gov/electricity/data/eia860m/', status: 200, bytes: 0 },
        eiaCounts: { operating: 0, planned: 0, retired: 0, canceled: 0, plannedMW: 0, canceledMW: 0, retiredMW: 0, file: '', bytes: 0 },
      });
      writeJson(p, st);
    },
  },
  {
    id: 'http-429',
    target: 'data/lines/grid-queue.json',
    expectedBlockPoint: 'contracts',
    mutate(sandbox) {
      const p = join(sandbox, 'data/lines/grid-queue.json');
      const st = readJson(p);
      st.collect.runs.push({
        date: '2026-10-21T09:05:00.000Z',
        eia: { url: 'https://www.eia.gov/electricity/data/eia860m/', error: 'HTTP 429', status: 429 },
        eiaCounts: null,
      });
      writeJson(p, st);
    },
  },
  {
    id: 'duplicate-rows',
    target: 'data/lines/grid-queue.json',
    expectedBlockPoint: 'contracts',
    mutate(sandbox) {
      const p = join(sandbox, 'data/lines/grid-queue.json');
      const st = readJson(p);
      const runs = st.collect.runs;
      runs.push(JSON.parse(JSON.stringify(runs.at(-1))));
      writeJson(p, st);
    },
  },
  {
    id: 'truncated-data-file',
    target: 'data/lines/grid-queue.json',
    expectedBlockPoint: 'contracts',
    mutate(sandbox) {
      const p = join(sandbox, 'data/lines/grid-queue.json');
      const text = readFileSync(p, 'utf8');
      writeFileSync(p, text.slice(0, 120));
    },
  },
];

const realBefore = realDataHashes();
const summary = [];

for (const fault of FAULTS) {
  const sandbox = join(WORK, fault.id);
  // 每次使用新的沙箱，避免上一次注入残留。
  if (existsSync(sandbox)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    copyRepo(`${sandbox}-${stamp}`);
    var sb = `${sandbox}-${stamp}`;
  } else {
    copyRepo(sandbox);
    var sb = sandbox;
  }

  const dataPath = join(sb, 'data/lines/grid-queue.json');
  let before = null;
  try { before = lastValidRunHash(dataPath); } catch { /* 截断故障可能使 JSON 不可读，另行记录 */ }
  const sandboxDataBefore = shaFile(dataPath);

  fault.mutate(sb);
  const sandboxDataAfterInject = shaFile(dataPath);

  const gate = runNode(sb, 'scripts/assurance-gate.mjs');
  let gateResult = null;
  const gateFile = join(sb, 'assurance/.gate/result.json');
  if (existsSync(gateFile)) {
    try { gateResult = readJson(gateFile); } catch { /* 保持 null */ }
  }

  const publish = runNode(sb, 'scripts/publish.mjs');
  const publishBlocked = publish.code !== 0 && /publish blocked by assurance gate/.test(publish.out);
  const sandboxDataAfterPublish = shaFile(dataPath);

  let preserved = null;
  if (before) {
    try {
      const after = lastValidRunHash(dataPath);
      preserved = after && after.date === before.date && after.hash === before.hash;
    } catch { preserved = false; }
  }

  const gateFailedAt = gateResult?.checks?.find((c) => c.exitCode !== 0)?.name || (gate.code !== 0 ? 'unknown' : null);
  const blocked = gate.code !== 0 && publishBlocked;
  const record = {
    id: fault.id,
    target: fault.target,
    expected_block_point: fault.expectedBlockPoint,
    injected_at: new Date().toISOString(),
    gate_exit: gate.code,
    gate_failed_check: gateFailedAt,
    gate_checks: gateResult?.checks || [],
    publish_exit: publish.code,
    publish_blocked: publishBlocked,
    publish_output_head: publish.out.split(/\r?\n/).filter(Boolean).slice(0, 3).join(' | '),
    data_hash_before_injection: sandboxDataBefore,
    data_hash_after_injection: sandboxDataAfterInject,
    data_hash_after_publish_attempt: sandboxDataAfterPublish,
    write_after_injection: sandboxDataAfterPublish !== sandboxDataAfterInject,
    last_valid_run_preserved: preserved,
    blocked,
  };
  summary.push(record);

  const log = [
    `fault: ${fault.id}`,
    `target: ${fault.target}`,
    `expected block point: ${fault.expectedBlockPoint}`,
    `gate exit: ${gate.code}`,
    `gate failed check: ${gateFailedAt}`,
    `gate checks: ${JSON.stringify(record.gate_checks)}`,
    `publish exit: ${publish.code}`,
    `publish blocked: ${publishBlocked}`,
    `data hash before injection: ${sandboxDataBefore}`,
    `data hash after injection: ${sandboxDataAfterInject}`,
    `data hash after publish attempt: ${sandboxDataAfterPublish}`,
    `write after injection: ${record.write_after_injection}`,
    `last valid run preserved: ${preserved}`,
    '',
    '--- gate output ---',
    gate.out,
    '',
    '--- publish output ---',
    publish.out,
  ].join('\n');
  writeFileSync(join(LOGS, `${fault.id}.log`), log);

  console.log(`${blocked ? 'BLOCKED' : 'NOT-BLOCKED'} ${fault.id}: gate=${gate.code} (${gateFailedAt}), publish=${publish.code}, lastValidPreserved=${preserved}`);
}

const realAfter = realDataHashes();
const realUnchanged = JSON.stringify(realBefore) === JSON.stringify(realAfter);
const allBlocked = summary.every((s) => s.blocked);
const result = {
  generated_at: new Date().toISOString(),
  real_data_hash_before: realBefore,
  real_data_hash_after: realAfter,
  real_data_unchanged: realUnchanged,
  all_blocked: allBlocked,
  faults: summary,
};
writeFileSync(join(ROOT, 'assurance/fault-injection/result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(`\nfault-injection: ${summary.length} faults, allBlocked=${allBlocked}, realDataUnchanged=${realUnchanged}`);
process.exitCode = allBlocked && realUnchanged ? 0 : 1;
