# 2026-10-23 核查记录

生成时间：2026-10-23T13:20+08:00
仓库 HEAD：`f6583a3`（本地与远端 `master` 一致，工作树干净）

## 1. nightly cron

- 运行 ID / URL：`39857295495` / https://github.com/xka0085-byte/longgame/actions/runs/39857295495
- event：`schedule`（真实定时触发，不是 `workflow_dispatch`）
- conclusion：`success`
- createdAt / startedAt：`2026-10-22T21:26:38Z`
- 本地时间：`2026-10-23 05:26:38 CST`
- cron 设定：`0 18 * * *` UTC（02:00 CST）；本次实际延迟约 3 小时 26 分
- headBranch / headSha：`master` / `adf3d00`
- fault-injection.md 日期：`2026-10-22`（工作流使用 UTC 日期；对应本地 2026-10-23 05:26）
- realDataUnchanged：`true`
- 故障注入结果：6 类全部 `BLOCKED`
- 自动提交：`f6583a3`（更新 `docs/assurance/fault-injection.md`）
- data/lines 前后哈希：由 nightly 结果记录为未变（`realDataUnchanged=true`），未做本地独立复算

## 2. 样本口径

- verify：`20 checks, 0 failures`
- validate-contracts：`13 contracts, 0 failures`
- run-fixtures：`39 executable samples, 39 passed, 0 failed; 3 NOT_APPLICABLE markers, 3 passed, 0 failed`
- assurance-gate：`PASS (4/4 checks executed)`
- `assurance/results/fixtures.json`：`samples=39, passed=39, not_applicable=3, entries=42`

## 3. UptimeRobot

| 监控 | ID | 状态 | 间隔 | URL |
| --- | --- | --- | --- | --- |
| longgame-verify | 804383071 | Up | 300s | https://xka0085-byte.github.io/longgame/verify.html |
| longgame-status | 804383072 | Up | 300s | https://xka0085-byte.github.io/longgame/status.json |
| longgame-sb253-window | 804383073 | Up | 300s | https://xka0085-byte.github.io/longgame/lines/sb253-first-window.html |

- 旧 `gmail.com` 监控：`804366318`，已暂停（`status=0`），未删除。
- `longgame-verify` 配置：关键词 `Assurance level`，方向 `ALERT_NOT_EXISTS`（关键词不存在时启动事件）；URL 为 GitHub Pages，不是 `raw.githubusercontent.com`。
- 邮箱联系人：`8945084` / `xka0085@gmail.com`。API `getAlertContacts` 返回 `status=1`（paused），控制台渠道显示启用，incident 记录显示 `Email sent ... SUCCESS`。
- 测试告警：控制台 `Test Notification` 返回 sent；**Gmail 收件箱是否实际收到：UNKNOWN，待用户确认**。
- Main API Key：待用户确认邮件后删除；本记录生成时未删除。

## 4. 仍未验证（UNKNOWN）

- Gmail 收件箱是否实际收到 UptimeRobot 测试/告警邮件。
- UptimeRobot API 的 alert contact `status=1` 与控制台渠道启用状态的口径差异原因。
- 外部三线（mcpreflight-weekly、erc8004-snapshot、protocol-watch）无本地采集器，`assurance_level=1`。
- 无第三方独立复算，任何线不得标 Level 3+。
- 契约 `owner` / 来源许可条款仍 UNKNOWN。
- 月报为时点快照，未接历史趋势。
