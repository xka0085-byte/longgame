# SB 253 数据源归属核实（2026-10-21）

检索时间：2026-10-21T08:40Z–08:50Z（UTC）／2026-10-21 16:40–16:50（UTC+8）
检索方式：本机 HTTP 客户端（Node fetch，UA `longgame-portfolio/0.2 personal research`）、PowerShell `Invoke-WebRequest`（UA 为桌面版 Chrome 131）、以及带浏览器引擎的正文抓取（浏览器引擎渲染后的正文与页面标题）。全程只读，未提交任何内容、未发送邮件。

## 结论

1. `https://ww2.arb.ca.gov/approved-comments?entity_id=47456` 是 **SB 261 的 docket**，不是 SB 253 的 docket。
   依据有两条，互相独立：
   - 该页渲染后的正文标题为 `Climate-Related Financial Risk Reports (SB 261) Docket`；
   - CARB 的 SB 261 官方 docket 页在正文里明确把这一 URL 指为「已审核并公开发布的 SB 261 提交」所在处，措辞为「Submissions that have been reviewed and released to the public SB 261 docket can be found here」，链接目标正是 `//ww2.arb.ca.gov/approved-comments?entity_id=47456`。
2. SB 253 的首窗（2026-11-10 截止）**没有对应的 approved-comments docket**。官方给出的提交入口是：
   - 自愿使用的 2026 Report Intake Platform（ArcGIS Survey123）：`https://survey123.arcgis.com/share/2a74000ea23b450ebf35c0f6f434445b?portalUrl=https://gis.carb.arb.ca.gov/portal`；
   - 或者以电邮方式提交：`climatedisclosure@arb.ca.gov`。
   CARB 明示该平台「Use of this platform is not mandatory」，且首窗截止日为 2026-11-10。
3. **查不到的部分，不推断**：在本次读取的所有 CARB 页面中，没有找到任何「已收到 / 已发布的 SB 253 2026 报告清单」页面或数据集。SB 261 有公开 docket，SB 253 首窗提交是否会被公开发布、以什么形式发布，本次未找到官方说明，因此不做判断。

## 逐条证据

| # | URL | HTTP 状态 | 页面标题 | 说明 |
|---|---|---|---|---|
| 1 | `https://ww2.arb.ca.gov/approved-comments?entity_id=47456` | 202，正文 0 字节（Node fetch 与 PowerShell 均如此，2026-10-21T07:37Z 与 08:45Z 两次） | 原始响应无标题；浏览器引擎渲染后文档标题为 `Approved Comments \| California Air Resources Board`，正文首个小标题为 `Climate-Related Financial Risk Reports (SB 261) Docket` | 声明为 SB 261 docket |
| 2 | `https://ww2.arb.ca.gov/public-comments/climate-related-financial-risk-reports-sb-261-docket` | 200（浏览器引擎；标题与正文均可读） | `Climate-Related Financial Risk Reports (SB 261) Docket` | 正文把 #1 指为 SB 261 公开 docket，是判定 #1 归属的关键依据 |
| 3 | `https://ww2.arb.ca.gov/our-work/programs/corporate-ghg-reporting/corporate-disclosure-climate-data` | 200（浏览器引擎） | `Corporate Disclosure of Climate Data` | SB 253 口径：Scope 1/2 报告截止 2026-11-10；给出 2026 Report Intake Platform 与邮件提交两条路径；明示平台非强制 |
| 4 | `https://ww2.arb.ca.gov/our-work/programs/california-corporate-greenhouse-gas-reporting-and-climate-related-financial-risk` | 200（浏览器引擎） | `California Corporate Greenhouse Gas (GHG) Reporting and Climate Related Financial Risk Disclosure Programs` | 明确 SB 253 = 企业温室气体报告，SB 261 = 气候相关财务风险披露；页面含 2026 Report Submission 段落并链接同一 Survey123 平台 |
| 5 | `https://survey123.arcgis.com/share/2a74000ea23b450ebf35c0f6f434445b` | 200，4,835 字节 | `ArcGIS Survey123` | 返回的是单页应用外壳，未渲染出表单字段；只确认该入口可达，未读取表单内容 |
| 6 | `https://ww2.arb.ca.gov/public-comments` | 202，正文极短（浏览器引擎只取到一段说明文字） | `Public Comments - Workshops Community Meetings & Other Input Opportunities` | 列表由前端脚本加载，本次抓取未取得条目；因此不能据此断言「没有 SB 253 docket」以外的更多结论 |
| 7 | `https://ww2.arb.ca.gov/climatedisclosure` | 307（重定向至 #4 的程序主页，渲染后正文与 #4 一致） | 同 #4 | 仅为确认入口别名 |

## 关于 202 与「数据源不可用」

同一 URL 在不同时刻返回不同状态，说明 202 不是站点故障，而是对非浏览器客户端的拦截：

- 2026-10-20T13:47:38Z：采集器以 200 取得正文 68,754 字节（当时三页均 200）；
- 2026-10-21T07:37:28Z：同一采集器三页全部 202 + 0 字节；
- 2026-10-21T08:40Z 前后：PowerShell（Chrome UA）五个 CARB URL 全部 202 + 0 字节，而浏览器引擎渲染后正文可读。

因此采集侧把这类响应的语义定为「本次抓取没有拿到内容」，标记 `data-source-unavailable`，而不是「页面已变」或「内容为零」。

已知历史误差：`data/lines/sb253-docket.json` 里 2026-10-21T07:37:28Z 那一轮的三条 `content changed` 事件，是修复前的采集器把 202 空响应当成内容变化写下的，属于误报。该轮记录保留未改（不改写历史），此处如实标注。

## 对现有配置的影响

- `portfolio.json` 中 `sb253-docket` 的页面 id 仍为 `sb261-docket` / `sb253-reporting` / `sb253-program`，与本次核实一致：第一条确实是 SB 261 docket，后两条是 SB 253 程序页。
- 未新增 SB 253 报告提交页作为采集对象：Survey123 是单页应用，匿名抓取只会得到空壳，加进去只会持续产生「不可用」噪音，且首窗 2026-11-10 尚未到期，暂无公开提交数据可采。
- 未做任何提交、订阅或对外联系动作。
