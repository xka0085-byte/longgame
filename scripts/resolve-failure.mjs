// resolve-failure：本 workflow 成功跑完后，关掉它之前自动登记的 workflow-failed Issue。
//
// 为什么需要它：notify-failure.mjs 只在失败时开/更新 Issue，#5 与 #2 就是这样留下的；
// 但恢复后没有任何代码去关，Issue 正文却写着"恢复后请关闭"，等于把收口交给人的记性。
// 告警的价值取决于列表里还剩几条真的红着——所以恢复要能自动收口。
//
// 用法（放在 workflow 最后一步，成功路径）：
//   - if: success()
//     run: node scripts/resolve-failure.mjs "${{ github.workflow }}"
//
// 与 notify-failure.mjs 共用 [auto-health] 标题前缀，靠标题匹配同一个 Issue；
// 没有对应 Issue 时 resolve 什么都不做，不会凭空造一条。

import { resolve } from './lib/github-issue.mjs';

const workflow = process.argv[2] || process.env.GITHUB_WORKFLOW || 'unknown-workflow';
const note = [
  `恢复：${new Date().toISOString()} 的运行已成功，自动关闭。`,
  '',
  process.env.GITHUB_RUN_ID ? `运行：${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : '',
].filter(Boolean).join('\n');

const r = await resolve(`workflow-failed: ${workflow}`, note);
console.log(`resolve-failure: ${workflow} -> ${JSON.stringify(r)}`);
