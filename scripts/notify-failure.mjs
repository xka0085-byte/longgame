// notify-failure：任何 workflow 失败时立刻开一个 Issue。
//
// 此前 17 个 workflow 全是静默的：weekly-collect 在 2026-10-30 07:21 失败、
// 10-26 周一整次没跑，仓库里没有任何记录指向人。加这个步骤之后，
// "失败"至少能在 Issues 里留下一条有时间戳的痕迹。
//
// 用法（放在 workflow 最后一步）：
//   - if: failure()
//     run: node scripts/notify-failure.mjs "${{ github.workflow }}"
//
// 去重策略：同一 workflow 的失败合并到一个 Issue 里，不按次刷屏；
// 有新失败就追加评论，恢复（下一次成功）不动它，由人关闭或由 heartbeat 关。

import { raise } from './lib/github-issue.mjs';

const workflow = process.argv[2] || process.env.GITHUB_WORKFLOW || 'unknown-workflow';
const runId = process.env.GITHUB_RUN_ID || '';
const sha = (process.env.GITHUB_SHA || '').slice(0, 7);
const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
const repo = process.env.GITHUB_REPOSITORY || '';
const ref = process.env.GITHUB_REF_NAME || '';

const runUrl = runId && repo ? `${server}/${repo}/actions/runs/${runId}` : '(no run url)';

const body = [
  `**${workflow}** 在 \`${ref}\` 上失败。`,
  '',
  `- 时间：${new Date().toISOString()}`,
  `- 提交：\`${sha || 'unknown'}\``,
  `- 运行：${runUrl}`,
  `- 触发方式：${process.env.GITHUB_EVENT_NAME || 'unknown'}`,
  '',
  '这是自动登记，不代表已知根因。排查入口：上面的运行链接 → 失败步骤日志。',
  '',
  '> 恢复后请关闭此 Issue；heartbeat 若判定整链恢复，也会一并关闭。',
].join('\n');

const r = await raise(`workflow-failed: ${workflow}`, body);
console.log(`notify-failure: ${workflow} -> ${JSON.stringify(r)}`);
