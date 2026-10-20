# longgame 组合注册表（单一事实源）

哲学：不是找对一个，是全铺、零人工自转、让时间筛选。线是动态的，每条线三件套，采集做数据 diff，雷达每日扫各自驱动相关的外部最新消息，反应规则把命中变成动作。十年天翻地覆，线跟着世界变。

## 动态架构

- 采集：各线按节奏 diff 数据源（CARB docket、agent 密钥目录、EU 信任列表、AI Act 页面、守候对象页面），变更与首窗快照进事件流
- 雷达：每日跑，频道为 HN Algolia、Federal Register、Google News RSS，关键词在 portfolio.json 每线配置，改词只编辑 JSON 不改代码
- 反应：雷达命中与采集变更写入该线 alerts 并进月报。升级触发器命中当月做十问初筛。静默的 watch 线自动提名降级。每年三问体检，任一问连续两年答否即降级或清仓
- 管理面：加线、改词、改状态，全部只编辑 portfolio.json

## 运行档位（GitHub Actions）

- daily-radar：每日 UTC 05:00，全部线的雷达
- weekly-collect：每周一 UTC 03:00，周采集线
- monthly-report：每月 1 日 UTC 04:00，月采集线加月报与仪表盘
- 全部用内置 GITHUB_TOKEN，自动 commit

## 人工接口

每月读一次 docs 月报点头，合计一小时。

## 序列清单

| id | 状态 | 采集 | 雷达 | 驱动 |
|---|---|---|---|---|
| mcpreflight-weekly | running-external | mcpdoctor 仓库 | HN+Google News | MCP 生态普查 |
| erc8004-snapshot | running-external | mcpdoctor 仓库 | HN+Google News | agent 身份注册表链上序列 |
| protocol-watch | running-external | mcpdoctor 仓库每日 | HN+Google News | 四协议仓库 release |
| sb253-docket | active | 每周 CARB 三页 | Google News+HN | 加州披露，2026-11-10 首窗 |
| agent-dirs | active | 每周密钥目录 | HN+Google News | agent 支付轨道 |
| eidas-tsl | active | 每周 LOTL | Google News+HN | eIDAS 2.0 |
| aiact-register | auto-wait | 每月四页 hash | Google News+HN | AI Act 2027/2028 义务 |
| triggers | active | 每月五个守候对象页 | Federal Register+GN+HN | 守候清单 B/C 升级触发器 |

## 已知边界

- Google News RSS 从本机网络被拦，GitHub runner（美国 IP）预期可达，失败自动记录不炸
- agent-dirs 的目录若被 IETF/Cloudflare 做成自带历史的公共注册表，本线价值降为事件流聚合，年度体检会抓到
- SB261 被第九巡回禁令暂停，司法动向是雷达重点，价值锚在披露可见性而非执法
- HN 雷达已加相关度过滤，查询主要词必须都在标题里，防模糊匹配噪声

## 每年三问体检

一 驱动时间表是否推进。二 历史是否出现真实买方或稳定引用方。三 是否出现资金充足的回填者。任一问连续两年答否即降级或清仓。
