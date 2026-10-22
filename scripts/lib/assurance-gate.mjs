// 门禁结果读写：publish/deploy 只能在同一份输入通过 gate 之后执行。
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const ROOT = process.cwd();
export const GATE_FILE = join(ROOT, 'assurance/.gate/result.json');

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// 门禁输入指纹：生产数据、契约、固定样本、portfolio。任一变化都会让旧门禁结果失效。
export function inputsHash() {
  const files = [
    join(ROOT, 'portfolio.json'),
    ...walk(join(ROOT, 'data/lines')),
    ...walk(join(ROOT, 'assurance/contracts/datasets')),
    ...walk(join(ROOT, 'assurance/fixtures')),
  ].filter((f) => existsSync(f) && !f.includes('assurance/.gate'));
  const h = createHash('sha256');
  for (const f of files.sort()) {
    h.update(relative(ROOT, f).replace(/\\/g, '/'));
    h.update('\0');
    h.update(readFileSync(f));
    h.update('\0');
  }
  return h.digest('hex');
}

export function headCommit() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); }
  catch { return 'UNKNOWN'; }
}

export function writeGateResult(checks) {
  mkdirSync(join(ROOT, 'assurance/.gate'), { recursive: true });
  const passed = checks.every((c) => c.exitCode === 0);
  const result = {
    passed,
    at: new Date().toISOString(),
    head: headCommit(),
    inputs_hash: inputsHash(),
    checks,
  };
  writeFileSync(GATE_FILE, JSON.stringify(result, null, 2) + '\n');
  return result;
}

export function assertGate() {
  const die = (msg) => {
    console.error(`publish blocked by assurance gate: ${msg}`);
    process.exit(1);
  };
  if (!existsSync(GATE_FILE)) die('no gate result; run node scripts/assurance-gate.mjs first');
  let r;
  try { r = JSON.parse(readFileSync(GATE_FILE, 'utf8')); }
  catch (e) { die(`gate result is unreadable: ${e.message}`); }
  if (r.passed !== true) die('gate result is not passed');
  if (!Array.isArray(r.checks) || r.checks.length === 0 || r.checks.some((c) => c.exitCode !== 0)) {
    die('gate result contains a failed check');
  }
  const head = headCommit();
  if (r.head !== head) die(`gate was run on ${String(r.head).slice(0, 12)}, current HEAD is ${String(head).slice(0, 12)}`);
  const current = inputsHash();
  if (r.inputs_hash !== current) die('data/contracts/fixtures changed since the gate ran');
  return r;
}
