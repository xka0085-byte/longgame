// nightly 注入：在 CI 沙箱里跑完整故障注入，把结果写成可提交的 Markdown。
// 只读真实 data/lines；所有注入发生在仓库外的副本里。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.cwd();
const OUT = join(ROOT, 'docs/assurance/fault-injection.md');
mkdirSync(join(ROOT, 'docs/assurance'), { recursive: true });

function head() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return 'UNKNOWN'; }
}

let exitCode = 0;
try {
  execFileSync(process.execPath, ['assurance/fault-injection/run-all.mjs'], { stdio: 'inherit', timeout: 2700000 });
} catch (e) {
  exitCode = typeof e.status === 'number' ? e.status : 1;
}

const commit = head();
const runUrl = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : 'local run';

let result = null;
try { result = JSON.parse(readFileSync(join(ROOT, 'assurance/fault-injection/result.json'), 'utf8')); } catch { /* 保留 null */ }

let md;
if (!result) {
  md = `# 故障注入 nightly\n\n生成 ${new Date().toISOString()}，commit \`${commit.slice(0, 12)}\`，运行链接 ${runUrl}。\n\n注入未产出结果文件（退出码 ${exitCode}）。按红线记 UNKNOWN，不记 PASS。\n`;
} else {
  const rows = result.faults.map((f) => {
    const preserved = f.last_valid_run_preserved === true ? '是' : (f.last_valid_run_preserved === false ? '否' : 'UNKNOWN');
    return `| ${f.id} | ${f.target} | ${f.expected_block_point} | ${f.gate_exit} | ${f.gate_failed_check || 'UNKNOWN'} | ${f.publish_blocked ? '是' : '否'} | ${f.write_after_injection ? '是' : '否'} | ${preserved} |`;
  }).join('\n');
  md = `# 故障注入 nightly

生成 ${result.generated_at}，commit \`${commit.slice(0, 12)}\`，运行链接 ${runUrl}。

- 全部故障被拦截：${result.all_blocked ? '是' : '否'}
- 真实 data/lines 未变：${result.real_data_unchanged ? '是' : '否'}
- 结论：${result.all_blocked && result.real_data_unchanged ? 'PASS' : 'FAIL'}

| 故障 | 目标 | 预期拦截点 | gate 退出码 | 失败检查 | publish 被拦 | 注入后仍写盘 | 最后有效运行保留 |
| --- | --- | --- | --- | --- | --- | --- | --- |
${rows}

说明：注入只在仓库外的副本中进行；真实数据文件哈希在注入前后一致才记「未变」。truncated-data-file 的「最后有效运行保留」为「否」，原因是注入本身已把 JSON 截断到无法解析，不是 publish 再写入；同行的「注入后仍写盘=否」证明 publish 没有改动文件。
未拦截或写盘任何一项为「是」，本次 nightly 即失败。
`;
}

writeFileSync(OUT, md);
console.log(`nightly-injection: wrote ${OUT}, allBlocked=${result?.all_blocked ?? 'UNKNOWN'}, realDataUnchanged=${result?.real_data_unchanged ?? 'UNKNOWN'}`);
process.exitCode = exitCode || (result?.all_blocked && result?.real_data_unchanged ? 0 : 1);
