# longgame 自我审计 2026-11-09

生成时间：2026-11-09T11:57:39.836Z（UTC）。这是本地 self-audit 的状态汇总与提案，不是第三方复算，也不代表任何外部验证。

## 状态表

按 freshness 严重度排序：unavailable → stale → never → fresh。缺失值用 `—` 表示，不写成 0。

| 线 | freshness | 最近尝试 (UTC) | 最近成功 (UTC) | 未更新天数 | 连续失败 | source_status | page_ok | csv_ok | 90天证据 |
|---|---|---|---|---:|---:|---|---|---|---:|
| agent-dirs | fresh | 2026-11-09 11:15:27.618Z | 2026-11-09 11:15:27.618Z | 0 | 0 | ok | true | — | 0 |
| aiact-register | fresh | 2026-11-08 01:59:19.552Z | 2026-11-08 01:59:19.552Z | 1 | 0 | ok | true | — | 0 |
| c2pa-spec | fresh | 2026-11-09 11:15:30.791Z | 2026-11-09 11:15:30.791Z | 0 | 0 | ok | true | — | 0 |
| compute-futures | fresh | 2026-11-09 11:15:29.993Z | 2026-11-09 11:15:29.993Z | 0 | 0 | partial | true | — | 0 |
| eidas-tsl | fresh | 2026-11-09 11:15:28.323Z | 2026-11-09 11:15:28.323Z | 0 | 0 | ok | true | — | 0 |
| formd-sweep | fresh | 2026-11-08 01:59:25.223Z | 2026-11-08 01:59:25.223Z | 1 | 0 | ok | true | — | 0 |
| grid-queue | fresh | 2026-11-08 01:59:35.333Z | 2026-11-08 01:59:35.333Z | 1 | 0 | ok | true | true | 0 |
| sb253-docket | fresh | 2026-11-08 11:03:49Z | 2026-11-08 11:03:49Z | 1 | 0 | partial | true | — | 0 |
| state-ai-laws | fresh | 2026-11-09 11:15:31.605Z | 2026-11-09 11:15:31.605Z | 0 | 0 | ok | true | — | 0 |
| triggers | fresh | 2026-11-08 01:59:21.088Z | 2026-11-08 01:59:21.088Z | 1 | 0 | partial | true | — | 0 |
| trust-delta | fresh | 2026-11-09 11:15:28.023Z | 2026-11-09 11:15:28.023Z | 0 | 0 | ok | true | — | 0 |
| erc8004-snapshot | external | — | — | — | — | external-managed | false | — | 0 |
| mcpreflight-weekly | external | — | — | — | — | external-managed | false | — | 2 |
| protocol-watch | external | — | — | — | — | external-managed | false | — | 0 |

统计：fresh 11，stale 0，unavailable 0，never 0。

## 异常项

- **compute-futures**：部分来源失败：partial。
- **sb253-docket**：部分来源失败：partial。
- **triggers**：部分来源失败：partial。
- **erc8004-snapshot**：无成功记录（不是 0 天），无本地采集节奏；最近状态/错误：external line; no local collector；页面不可用（missing /home/runner/work/longgame/longgame/docs/lines/erc8004-snapshot.html）。
- **mcpreflight-weekly**：无成功记录（不是 0 天），无本地采集节奏；最近状态/错误：external line; no local collector；页面不可用（missing /home/runner/work/longgame/longgame/docs/lines/mcpreflight-weekly.html）。
- **protocol-watch**：无成功记录（不是 0 天），无本地采集节奏；最近状态/错误：external line; no local collector；页面不可用（missing /home/runner/work/longgame/longgame/docs/lines/protocol-watch.html）。

## 提案（最多 3 条）

### P-20261109-01
- action: new-artifact
- target: mcpreflight-weekly
- reason: 该线已有 2 条外部证据（reply）；建议把证据固化为可引用产物，供人工判断。
- evidence_urls: <https://github.com/szaffarano/org-mcp-server/issues/232#issuecomment-6312745662>, <https://github.com/Novence-ai/mcp/issues/4#issuecomment-6309942717>
- effort: S
- risk: low

---

审计只读 portfolio.json 与 data/lines/*.json；不修改任何线，不新增线，不对外发布。提案必须由 docs/evidence.json 中的证据触发，人工决定记录在 docs/decisions.md。
