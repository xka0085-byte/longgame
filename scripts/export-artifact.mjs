// 导出自包含的校验快照：门禁退出码、契约/样本清单、故障注入结论、数据文件 sha256、首次观测时间。
// 目的：让外部只需下载一个 JSON 就能重算，而不必相信页面上的说法。
// 缺任何一环一律写 null / UNKNOWN，不补数、不外推。
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const p = (f) => `${ROOT}/${f}`;
const readJson = (f) => (existsSync(p(f)) ? JSON.parse(readFileSync(p(f), 'utf8')) : null);
const sha256 = (f) => (existsSync(p(f)) ? createHash('sha256').update(readFileSync(p(f))).digest('hex') : null);

const gate = readJson('assurance/.gate/result.json');
const contracts = readJson('assurance/results/contracts.json');
const fixtures = readJson('assurance/results/fixtures.json');
const injection = readJson('assurance/fault-injection/result.json');
const portfolio = readJson('portfolio.json');

let commit = null;
try {
  commit = execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
} catch { /* 无 git 时保持 null */ }

const at = gate?.at || new Date().toISOString();
const day = at.slice(0, 10);
const runAt = (r) => r?.at || r?.date || null;

const lines = (portfolio?.series || []).map((s) => {
  const st = readJson(`data/lines/${s.id}.json`);
  const runs = st?.collect?.runs || [];
  return {
    line: s.id,
    status: s.status,
    evidence_level: s.evidence_level ?? null,
    quality_status: s.quality_status ?? null,
    verified_by_third_party: s.verified_by_third_party ?? null,
    first_observed: runAt(runs[0]),
    first_observed_basis: runs.length
      ? 'data/lines/<line>.json 的 collect.runs[0].date（该线保留的最早一次采集 run，非外推）'
      : 'UNKNOWN：该线由外部工作流托管，本仓库无本地采集记录',
    run_count: runs.length,
    last_run_at: runs.length ? runAt(runs[runs.length - 1]) : null,
    data_sha256: sha256(`data/lines/${s.id}.json`),
  };
});

const fixtureFiles = existsSync(p('assurance/fixtures'))
  ? readdirSync(p('assurance/fixtures'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) =>
        readdirSync(`${p('assurance/fixtures')}/${d.name}`)
          .filter((f) => f.endsWith('.json'))
          .map((f) => ({ file: `assurance/fixtures/${d.name}/${f}`, sha256: sha256(`assurance/fixtures/${d.name}/${f}`) })),
      )
  : [];

const artifact = {
  artifact: 'longgame assurance snapshot',
  what_this_is:
    '一次发布门禁的自包含快照。所有字段均可从公开仓库重算：gate / contracts / fixtures / fault_injection 为对应脚本输出的原样，data_sha256 为 data/lines/*.json 的 SHA-256，first_observed 取该线最早一次采集 run。',
  limits: [
    '证据等级 E0：流程与数据可公开复核，但未经第三方复算（verified_by_third_party 全为 false）。',
    'first_observed 只代表该线在本仓库保留的最早采集 run，不代表数据源的首次公开时间。',
    'gate 由项目自身脚本产出，属于自我审计，不构成外部审计结论。',
  ],
  generated_at: new Date().toISOString(),
  gate_result_at: gate?.at || 'UNKNOWN',
  commit: commit || gate?.head || null,
  gate: gate
    ? { passed: gate.passed, at: gate.at, head: gate.head, inputs_hash: gate.inputs_hash, checks: gate.checks }
    : null,
  contracts: contracts ? { at: contracts.at, contracts: contracts.contracts, assertions: contracts.assertions } : null,
  fixtures: fixtures
    ? {
        at: fixtures.at,
        samples: fixtures.samples,
        passed: fixtures.passed,
        failed: fixtures.failed,
        not_applicable: fixtures.not_applicable,
        markers_passed: fixtures.markers_passed,
        entries: fixtures.entries,
      }
    : null,
  fixture_files: fixtureFiles,
  fault_injection: injection
    ? {
        at: injection.generated_at,
        all_blocked: injection.all_blocked,
        real_data_unchanged: injection.real_data_unchanged,
        faults: (injection.faults || []).map((f) => ({
          id: f.id,
          target: f.target,
          expected_block_point: f.expected_block_point,
          gate_exit: f.gate_exit,
          gate_failed_check: f.gate_failed_check,
          publish_blocked: f.publish_blocked,
          blocked: f.blocked,
        })),
      }
    : null,
  lines,
  reproduce: [
    'git clone https://github.com/xka0085-byte/longgame && cd longgame && npm i',
    'node scripts/assurance-gate.mjs      # 产出 assurance/.gate/result.json（verify / contracts / fixtures / fault-injection 四项退出码）',
    'node scripts/run-fixtures.mjs        # 产出 assurance/results/fixtures.json，比对 fixtures.samples / passed',
    'node scripts/validate-contracts.mjs  # 产出 assurance/results/contracts.json，比对 contracts / assertions',
    'sha256sum data/lines/<line>.json     # 与 lines[].data_sha256 对齐',
  ],
};

mkdirSync(p('docs/assurance'), { recursive: true });
const out = p(`docs/assurance/artifact-${day}.json`);
writeFileSync(out, JSON.stringify(artifact, null, 2) + '\n');
console.log(`artifact: wrote docs/assurance/artifact-${day}.json`);
console.log(
  `gate=${gate ? (gate.passed ? 'PASS' : 'FAIL') : 'UNKNOWN'} contracts=${contracts?.contracts ?? '?'}/${contracts?.assertions ?? '?'} fixtures=${fixtures?.passed ?? '?'}/${fixtures?.samples ?? '?'} injection=${injection ? (injection.all_blocked ? 'ALL_BLOCKED' : 'NOT_ALL_BLOCKED') : 'UNKNOWN'}`,
);
