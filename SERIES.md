# longgame 组合注册表（单一事实源）

哲学：不是找对一个，是全铺、零人工自转、让时间筛选。任何序列上线前先验证数据源可达，上线后 cron 自转，人工接口只有每月读一次月报。

## 维护预算

全部序列每周或每月 cron 自动跑。人工每月合计一小时，读月报点头。任何 B/C 守候对象触发信号命中，当月做十问初筛再决定是否升级。

## 序列清单

| id | 状态 | 节奏 | 驱动 | 不可回填资产 |
|---|---|---|---|---|
| mcpreflight-weekly | running（mcpdoctor 仓库） | 每周一 UTC 02:00 | MCP 生态普查 | 2026-10 起逐周握手与 x402 状态序列 |
| erc8004-snapshot | running（mcpdoctor 仓库） | 每周 | agent 身份注册表链上计数 | 2026-10 起持有与转账周度序列 |
| protocol-watch | running（mcpdoctor 仓库） | 每日 | 四协议仓库 release | 事件流 |
| sb253-docket | active（本仓库） | 每周 | 加州 SB253/261，2026-11-10 首窗 | 首窗快照与逐年披露轨迹 |
| agent-dirs | active（本仓库） | 每周 | agent 支付轨道起步 | 密钥注册轮换吊销事件流 |
| eidas-tsl | active（本仓库） | 每周 | eIDAS 2.0 钱包推开 | 中等，TSL 历史无人攒 |
| aiact-register | auto-wait（本仓库） | 每月 | AI Act 义务 2027/2028 | 官方机器可读数据落地侦测 |
| triggers | active（本仓库） | 每月 | 守候清单 B/C 触发信号 | 触发命中当月十问初筛 |

## 守候触发信号速查（triggers.mjs 覆盖）

- CFTC 对算力期货的批复（CME 延审中）
- Cloudflare Monetization Gateway 转 GA
- H.R. 8915 人格权法案推进
- Lloyd's Lab 新一期收录 AI 参数险团队
- aiSure 触发品类扩展、第二家 agent 首单新闻
- IRS 或 FinCEN 就 agent 收入发规则
- Coloprice 公开首份成交价报告
- x402 规范 v1.0
- Parametrix 宣布监控 LLM API

## 每年三问体检

一 驱动时间表是否推进。二 历史是否出现真实买方或稳定引用方。三 是否出现资金充足的回填者。任一问连续两年答否即降级或清仓。

## 已知风险登记

- sb253-docket：SB261 被第九巡回禁令暂停（2025-11-18），CARB 不执法，首年宽限期。监视义务不变，价值锚在披露可见性
- agent-dirs：目录被 IETF/Cloudflare 做成公共注册表的趋势存在，若注册表自带历史则本序列价值降为事件流聚合
- eidas-tsl：买方多要当前状态，历史付费意愿存疑，定位组合配角
