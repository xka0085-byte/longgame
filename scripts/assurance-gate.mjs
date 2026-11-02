// 发布门禁：按固定顺序真实执行四项检查，任一非零退出码即整体失败。
// 结果写入 assurance/.gate/result.json，publish.mjs 会校验其结果与输入指纹。
//
// 第一项用的是 verify-data.mjs 而不是 verify.mjs：门禁跑在 publish 之前，
// 而 verify.mjs 比对的是渲染后的页面，此时页面还是上一次的，必然对不上。
// 页面与数据的比对仍由 publish.mjs 在渲染完成后再跑一次 verify.mjs。
import { spawnSync } from 'node:child_process';
import { writeGateResult } from './lib/assurance-gate.mjs';

const CHECKS = [
  ['data', 'scripts/verify-data.mjs'],
  ['contracts', 'scripts/validate-contracts.mjs'],
  ['fixtures', 'scripts/run-fixtures.mjs'],
  ['fault-injection', 'assurance/fault-injection/guard-check.mjs'],
];

const checks = [];
for (const [name, script] of CHECKS) {
  const started = Date.now();
  console.log(`\n=== gate: ${name} (${script}) ===`);
  const r = spawnSync(process.execPath, [script], { stdio: 'inherit', cwd: process.cwd() });
  const exitCode = r.status === null ? 1 : r.status;
  checks.push({ name, script, exitCode, ms: Date.now() - started });
  if (exitCode !== 0) {
    console.error(`gate: ${name} failed with exit code ${exitCode}`);
    break;
  }
}

const result = writeGateResult(checks);
console.log(`\nassurance-gate: ${result.passed ? 'PASS' : 'FAIL'} (${checks.length}/${CHECKS.length} checks executed)`);
console.log(`gate result: assurance/.gate/result.json`);
process.exitCode = result.passed ? 0 : 1;
