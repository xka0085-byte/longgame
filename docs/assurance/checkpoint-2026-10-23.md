# 2026-10-23 夜间核查记录

生成时间：2026-10-23 02:40 (本地 UTC-04:00，即 2026-10-23T06:40Z)
核查仓库：`C:\Users\eqzyz\agenttoll-master\longgame`
核查时 HEAD：`d1db769`（`master` 本地领先 `origin/master` 1 个提交，工作树干净）

## A. 结论摘要

| 项 | 结果 |
| --- | --- |
| nightly schedule 运行 | 找到真实 `schedule` 运行 `39857295495`，`conclusion=success`（非 workflow_dispatch） |
| fault-injection.md 日期 | `2026-10-22`（**与期望 2026-10-23 不符，记 MISMATCH**） |
| 六类注入 | 6/6 `BLOCKED`，`allBlocked=true` |
| realDataUnchanged | `true` |
| data/lines 运行前后哈希 | `UNKNOWN`（日志与文档只给结论，无具体哈希值） |
| validate-contracts | `13 contracts, 0 failures` |
| run-fixtures | `39 executable samples, 39 passed, 0 failed; 3 NOT_APPLICABLE markers, 3 passed, 0 failed` |
| assurance-gate | `PASS (4/4 checks executed)` |
| UptimeRobot 三监控 | 三个均 `status=2`（Up，API 实测） |
| 旧 gmail.com 监控 | `status=0`（Paused） |

## B. nightly cron 运行

- 运行 ID / URL：`39857295495` / https://github.com/xka0085-byte/longgame/actions/runs/39857295495
- event：`schedule`
- headBranch / headSha：`master` / `adf3d001eef57879ce653f5fc775bcd56000dbd0`
- status / conclusion：`completed` / `success`
- createdAt：`2026-10-22T21:26:38Z`（满足「晚于 2026-10-22T18:00:00Z」）
- 工作流 cron：`0 18 * * *`（UTC；注释标称 02:00 Asia/Shanghai），本次实际触发延迟约 3 小时 26 分
- 工作流 state：`active`；仓库默认分支：`master`；该工作流最近一次 schedule 运行：`2026-10-22T21:26:38Z`（`gh api .../actions/workflows/nightly-injection.yml/runs?event=schedule`）
- 轮询过程：02:18 / 02:31 / 02:39 三次查询，`--event schedule` 返回条目数恒为 1，无更新运行出现；02:40 截止时判定本次 schedule 运行即为目标运行
- 该运行自动提交：`f6583a3`（`nightly fault injection 2026-10-22`）

运行日志关键行（`gh run view 39857295495 --log` 原文摘录）：

```
2026-10-22T21:26:49.7522710Z BLOCKED truncated-data-file: gate=1 (verify), publish=1, lastValidPreserved=false
2026-10-22T21:26:49.7529579Z fault-injection: 6 faults, allBlocked=true, realDataUnchanged=true
2026-10-22T21:26:49.7613926Z nightly-injection: wrote /home/runner/work/longgame/longgame/docs/assurance/fault-injection.md, allBlocked=true, realDataUnchanged=true
```

## C. fault-injection.md 核对

- 文件日期：文件正文为「生成 2026-10-22T21:26:49.752Z」，即 `2026-10-22`，**不等于要求的 2026-10-23**（工作流用 UTC 日期，本次运行 UTC 日期仍是 10-22）。判定：MISMATCH，不记 PASS。
- 六类注入全部 BLOCKED（文件表格与日志一致）：

| 故障 | 目标 | 预期拦截点 | gate 退出码 | publish 被拦 |
| --- | --- | --- | --- | --- |
| column-rename | fixtures/grid-queue/normal.json | fixtures | 1 | 是 |
| unit-mw-to-gw | fixtures/grid-queue/normal.json | fixtures | 1 | 是 |
| empty-response | data/lines/grid-queue.json | contracts | 1 | 是 |
| http-429 | data/lines/grid-queue.json | contracts | 1 | 是 |
| duplicate-rows | data/lines/grid-queue.json | contracts | 1 | 是 |
| truncated-data-file | data/lines/grid-queue.json | contracts | 1 | 是 |

- realDataUnchanged：`true`（日志与文件一致）。
- data/lines 运行前后哈希：文件仅注明「真实数据文件哈希在注入前后一致才记未变」，**未记录具体哈希值**；日志中亦无 data/lines 哈希行 → `UNKNOWN`。

## D. 本地三项验证实际输出

`git pull --ff-only`：`Already up to date.`（退出码 0）

```
$ node scripts/validate-contracts.mjs
validate-contracts: 13 contracts, 0 failures
EXIT=0
```

```
$ node scripts/run-fixtures.mjs
run-fixtures: 39 executable samples, 39 passed, 0 failed; 3 NOT_APPLICABLE markers, 3 passed, 0 failed
EXIT=0
```

```
$ node scripts/assurance-gate.mjs
=== gate: fault-injection (assurance/fault-injection/guard-check.mjs) ===
BLOCKED column-rename: scripts/run-fixtures.mjs exit=1
BLOCKED unit-mw-to-gw: scripts/run-fixtures.mjs exit=1
BLOCKED empty-response: scripts/validate-contracts.mjs exit=1
BLOCKED http-429: scripts/validate-contracts.mjs exit=1
BLOCKED duplicate-rows: scripts/validate-contracts.mjs exit=1
BLOCKED truncated-data-file: scripts/validate-contracts.mjs exit=1
fault-guard: 6 faults, allBlocked=true
assurance-gate: PASS (4/4 checks executed)
gate result: assurance/.gate/result.json
EXIT=0
```

## E. UptimeRobot 状态（本次 API 实测）

数据来源：`https://api.uptimerobot.com/v2/getMonitors`（format=json），查询时间 2026-10-23 02:2x 本地。

| 监控 | ID | status | 含义 | 间隔 | URL |
| --- | --- | --- | --- | --- | --- |
| longgame-verify | 804383071 | 2 | Up | 300s | https://xka0085-byte.github.io/longgame/verify.html |
| longgame-status | 804383072 | 2 | Up | 300s | https://xka0085-byte.github.io/longgame/status.json |
| longgame-sb253-window | 804383073 | 2 | Up | 300s | https://xka0085-byte.github.io/longgame/lines/sb253-first-window.html |
| gmail.com（旧） | 804366318 | 0 | Paused | 300s | https://xka0085@gmail.com |

- `longgame-verify` 类型 `type=2`（keyword），`keyword_type=2`（关键词不存在才告警），`keyword_value="Assurance level"`。
- 告警联系人：`8945084` / `xka0085@gmail.com`，API `getAlertContacts` 返回 `type=2`、`status=1`（paused）；与控制台「渠道已启用」的口径差异仍未解释 → `UNKNOWN`。
- Gmail 收件箱是否实际收到测试/告警邮件：`UNKNOWN`。
- 阻塞原因：本机无读取邮箱的通道（无已授权邮箱客户端接口），且 API 侧联系人 `status=1` 与控制台不一致，无法从 API 侧闭环确认邮件投递。

## F. 仍未验证清单（UNKNOWN）

1. data/lines 注入前后的具体哈希值（文件/日志均未记录，只有 `realDataUnchanged=true` 结论）。
2. `fault-injection.md` 日期为 `2026-10-22`，与本次要求的 `2026-10-23` 不一致，原因判定依赖运行延迟，未进一步验证。
3. UptimeRobot 告警邮件是否真实进入 xka0085@gmail.com 收件箱。
4. alert contact `status=1`（paused）与控制台启用状态的差异原因。
5. 外部三线（mcpreflight-weekly / erc8004-snapshot / protocol-watch）无本地采集器，`assurance_level=1`，未做第三方独立复算。
6. 契约 `owner` 与来源许可条款仍未确认。
7. 交接文件 `handoff-longgame-followups-2026-10-22.md` 在仓库根目录与本机均未找到，本文件结构按任务要求字段组织（第 E 节原文不可读）。

## G. 本次改动

- 新增/覆盖：`docs/assurance/checkpoint-2026-10-23.md`（本文件）
- 本次改动 commit：由承载本文件的提交提供（`git log -1 --format=%H -- docs/assurance/checkpoint-2026-10-23.md`），最终 SHA 见交付回复。
- 未修改其他任何文件；`assurance-gate.mjs` 在提交前返回 `PASS (4/4 checks executed)`。
