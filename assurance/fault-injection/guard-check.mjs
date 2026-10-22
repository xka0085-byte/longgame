// 门禁内的故障守卫自检：只用最小沙箱验证"坏输入会让对应检查器非零退出"。
// 不运行完整 gate（避免递归），不接触真实 data/lines。
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const WORK = join(ROOT, 'assurance/fault-injection/guard-work');
const LOGS = join(ROOT, 'assurance/fault-injection/logs');
mkdirSync(WORK, { recursive: true });
mkdirSync(LOGS, { recursive: true });

const shaFile = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n');

function fixtureSandbox(id) {
  const sb = join(WORK, `guard-${id}`);
  mkdirSync(join(sb, 'scripts'), { recursive: true });
  cpSync(join(ROOT, 'assurance/fixtures'), join(sb, 'assurance/fixtures'), { recursive: true });
  cpSync(join(ROOT, 'scripts/run-fixtures.mjs'), join(sb, 'scripts/run-fixtures.mjs'));
  return sb;
}

function contractSandbox(id) {
  const sb = join(WORK, `guard-${id}`);
  mkdirSync(join(sb, 'scripts'), { recursive: true });
  mkdirSync(join(sb, 'assurance/contracts/datasets'), { recursive: true });
  mkdirSync(join(sb, 'data/lines'), { recursive: true });
  cpSync(join(ROOT, 'portfolio.json'), join(sb, 'portfolio.json'));
  cpSync(join(ROOT, 'assurance/contracts/datasets'), join(sb, 'assurance/contracts/datasets'), { recursive: true });
  cpSync(join(ROOT, 'data/lines/grid-queue.json'), join(sb, 'data/lines/grid-queue.json'));
  cpSync(join(ROOT, 'scripts/validate-contracts.mjs'), join(sb, 'scripts/validate-contracts.mjs'));
  return sb;
}

function updateGridManifest(sb, file) {
  const dir = join(sb, 'assurance/fixtures/grid-queue');
  const mp = join(dir, 'manifest.json');
  const m = readJson(mp);
  for (const s of m.samples) if (s.file === file) s.sha256 = shaFile(join(dir, file));
  writeJson(mp, m);
}

function run(sb, script) {
  const r = spawnSync(process.execPath, [script], { cwd: sb, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  return { code: r.status === null ? 1 : r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

const FAULTS = [
  ['column-rename', 'fixtures', (sb) => {
    const p = join(sb, 'assurance/fixtures/grid-queue/normal.json');
    const rows = readJson(p);
    for (const r of rows) { r.capacity = r.capacity_mw; delete r.capacity_mw; }
    writeJson(p, rows); updateGridManifest(sb, 'normal.json');
  }],
  ['unit-mw-to-gw', 'fixtures', (sb) => {
    const p = join(sb, 'assurance/fixtures/grid-queue/normal.json');
    const rows = readJson(p);
    for (const r of rows) { r.capacity_mw = r.capacity_mw / 1000; r.capacity_unit = 'GW'; }
    writeJson(p, rows); updateGridManifest(sb, 'normal.json');
  }],
  ['empty-response', 'contracts', (sb) => {
    const p = join(sb, 'data/lines/grid-queue.json');
    const st = readJson(p);
    st.collect.runs.push({ date: '2026-10-21T09:00:00.000Z', eia: { url: 'https://www.eia.gov/electricity/data/eia860m/', status: 200, bytes: 0 }, eiaCounts: { operating: 0, planned: 0, retired: 0, canceled: 0, plannedMW: 0, canceledMW: 0, retiredMW: 0, file: '', bytes: 0 } });
    writeJson(p, st);
  }],
  ['http-429', 'contracts', (sb) => {
    const p = join(sb, 'data/lines/grid-queue.json');
    const st = readJson(p);
    st.collect.runs.push({ date: '2026-10-21T09:05:00.000Z', eia: { url: 'https://www.eia.gov/electricity/data/eia860m/', error: 'HTTP 429', status: 429 }, eiaCounts: null });
    writeJson(p, st);
  }],
  ['duplicate-rows', 'contracts', (sb) => {
    const p = join(sb, 'data/lines/grid-queue.json');
    const st = readJson(p);
    st.collect.runs.push(JSON.parse(JSON.stringify(st.collect.runs.at(-1))));
    writeJson(p, st);
  }],
  ['truncated-data-file', 'contracts', (sb) => {
    const p = join(sb, 'data/lines/grid-queue.json');
    writeFileSync(p, readFileSync(p, 'utf8').slice(0, 120));
  }],
];

const out = [];
for (const [id, kind, mutate] of FAULTS) {
  const sb = kind === 'fixtures' ? fixtureSandbox(id) : contractSandbox(id);
  mutate(sb);
  const script = kind === 'fixtures' ? 'scripts/run-fixtures.mjs' : 'scripts/validate-contracts.mjs';
  const r = run(sb, script);
  const blocked = r.code !== 0;
  out.push({ id, kind, script, exit: r.code, blocked });
  writeFileSync(join(LOGS, `guard-${id}.log`), `fault: ${id}\nkind: ${kind}\nscript: ${script}\nexit: ${r.code}\nblocked: ${blocked}\n\n${r.out}`);
  console.log(`${blocked ? 'BLOCKED' : 'NOT-BLOCKED'} ${id}: ${script} exit=${r.code}`);
}

const all = out.every((x) => x.blocked);
writeFileSync(join(ROOT, 'assurance/fault-injection/guard-result.json'), JSON.stringify({ at: new Date().toISOString(), all_blocked: all, faults: out }, null, 2) + '\n');
console.log(`\nfault-guard: ${out.length} faults, allBlocked=${all}`);
process.exitCode = all ? 0 : 1;
