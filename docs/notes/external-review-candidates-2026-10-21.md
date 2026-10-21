# 外部复核候选清单（2026-10-21）

用途：为 mcpreflight 与 formd 两条测量线各列 5 个可能具备独立复算或引用条件的公开对象。
边界：本文件只记录公开可查信息，未联系任何人；不含推销话术，不推测对方需求或意向；"最后活跃时间"为公开页面或 GitHub API 在 2026-10-21 的抓取结果。

---

## 一、mcpreflight（MCP 端点只读检查）

### 1. Invariant Labs — MCP-Scan

- 名字：Invariant Labs（MCP-Scan 项目）
- 链接：https://github.com/invariantlabs-ai/mcp-scan
- 相关公开工作：MCP-Scan 是面向 AI agent、MCP server 与 agent skills 的安全扫描器，会连接端点、枚举工具并检查工具定义与投毒风险；项目文档见 https://invariantlabs-ai.github.io/docs/mcp-scan/。GitHub 约 3,156 stars（2026-10-21 抓取）。
- 最后活跃时间：2026-10-21（GitHub API `pushed_at`；可能包含自动推送）。
- 为何可能愿意复算：其扫描流程与 mcpreflight 的只读端点检查高度重叠（连接、列工具、读定义），复算不需要新建采集链路，且能直接对照两套检查结果。

### 2. Model Context Protocol — MCP Inspector

- 名字：Model Context Protocol 官方项目（MCP Inspector）
- 链接：https://github.com/modelcontextprotocol/inspector
- 相关公开工作：官方 MCP server 可视化测试工具，可连接 server、列出 tools/resources/prompts 并发起调用；GitHub 约 11,112 stars。
- 最后活跃时间：2026-10-21（GitHub API `pushed_at`）。
- 为何可能愿意复算：作为协议参考实现，它能独立验证端点可达性与工具清单；若 mcpreflight 的扫描结果与 Inspector 的连接结果不一致，可作为第三方对照。

### 3. The Vulnerable MCP Project

- 名字：The Vulnerable MCP Project（社区维护）
- 链接：https://vulnerablemcp.info/ ；仓库 https://github.com/vineethsai/vulnerablemcp
- 相关公开工作：按根因分类的 MCP 漏洞数据库，覆盖提示注入、输入校验、工具投毒等类别，并映射到 Cisco AI Security Framework；站点提供漏洞条目、影响/可利用性评分与来源。
- 最后活跃时间：仓库 2026-02-16（GitHub API `pushed_at`）。站点条目由页面脚本动态加载，本次未读取到可引用的条目日期，不据此判定全站最新。
- 为何可能愿意复算：其数据库按 server 记录漏洞与受影响版本，具备逐条核对端点/工具事实的基础；但 GitHub 仓库自 2026-02-16 后无推送记录，复算前需确认条目时效。

### 4. PulseMCP — MCP Statistics

- 名字：PulseMCP（MCP 目录与生态统计）
- 链接：https://www.pulsemcp.com/statistics
- 相关公开工作：公开 MCP 生态统计页，称数据由内部数据仓库每日更新；页面给出本地/远程 server 的估算访问量、下载量等指标，并明确说明是估算而非平台精确值。具体数值由页面脚本渲染，本次抓取只读到说明文字，未取到可引用的数字。
- 最后活跃时间：2026-10-21 抓取时页面声明每日更新（本次未读取到具体更新日期）。
- 为何可能愿意复算：其日常就在做跨目录抓取与 server 级可用性测量，具备批量复核端点状态的现成管线；其页面明确把数字标为生态估算而非单一平台精确值，适合作为方法对照。

### 5. Simon Willison

- 名字：Simon Willison（独立开发者/博主）
- 链接：https://simonwillison.net/tags/model-context-protocol/
- 相关公开工作：MCP 标签下有多篇 MCP 规范变更、工具实测与可复现命令的文章；维护 LLM CLI 与 datasette-mcp 等开源项目，GitHub 约 12,648 stars。
- 最后活跃时间：MCP 标签最新文章 2026-09-20；`simonw/llm` 仓库 2026-10-18 有推送（GitHub API）。
- 为何可能愿意复算：其文章习惯给出可复制命令与原始输出，具备独立跑端点检查的技术条件；对 MCP 工具的实际可用性有持续公开记录。

---

## 二、formd（SEC Form D 备案计数）

背景基线：SEC DERA 的 Regulation D 统计按季度更新，2025 年年度口径为 34,553 起 Reg D offering、合计 2.4 万亿美元（SEC 新闻稿 2026-29，2026-03-17）。以下候选均为独立于本项目的公开测量者。

### 1. Crowdfunded Wealth

- 名字：Crowdfunded Wealth
- 链接：https://www.crowdfundedwealth.com/articles/form-d-filing-how-to-read-2026
- 相关公开工作：2026-10-17 文章《How to Read a Form D Filing: Items 1 to 16, and What 62,963 Filings Show》，自行从 SEC Form D 数据集统计 2025-10-01 至 2026-09-30 的 62,963 份 D/D-A 备案，按文件号去重得 57,641 个 offering，并拆分新备案、修订、首售日期与逾期比例。
- 最后活跃时间：2026-10-17。
- 为何可能愿意复算：其文章已公开完整口径（时间窗、去重键、D 与 D/A 拆分、逾期定义），与本项目 formd-sweep 的月度计数可直接互相复算；作者也明确标注"our arithmetic from SEC data sets"。

### 2. Pipeline Road

- 名字：Pipeline Road（私募基金形成简报）
- 链接：https://pipelineroad.com/news/20261016-fund-formation-brief
- 相关公开工作：按日发布 Form D 备案简报，逐日统计备案数量、策略分布、offering target、已售金额与投资者数；2026-10-16 的简报统计当日 4 份私募基金 Form D、合计 400 万美元已售。
- 最后活跃时间：2026-10-16。
- 为何可能愿意复算：其日报管线直接解析 Form D 原始字段，能按日回算月度合计；对本项目"本月十个关键词合计"的口径可提供逐日拆解对照。

### 3. Angel Investors Network

- 名字：Angel Investors Network
- 链接：https://angelinvestorsnetwork.com/market-analysis/sec-form-d-private-placements-2026-data
- 相关公开工作：2026-08-12 文章《SEC Form D Data: Private Placements Raised 2.4 Trillion in 2025》，引用 SEC DERA 的 2025 年 Reg D 统计（34,553 起、2.4 万亿美元），并与 IPO 募资规模对比，讨论 506(b)/506(c) 与合格投资者限制。
- 最后活跃时间：2026-08-12。
- 为何可能愿意复算：其分析同时使用 SEC 年度汇总与 Form D 明细，具备把年度口径拆回月度/关键词口径的数据基础。

### 4. FlareSight

- 名字：FlareSight（创业融资数据项目）
- 链接：https://flaresight.org/blog/q1-2026-startup-funding-report
- 相关公开工作：发布《Q1 2026 Startup Funding Report: What 2,508 SEC Filings Show》（2026-05-23），并称其从 SEC 备案构建"每日更新"的创业融资数据库；另发布 SEC EDGAR 检索方法说明。
- 最后活跃时间：报告页标注 2026-05-23；本次直连返回 HTTP 429，未能复核页面日期。其数据库页面自称每日更新，同样未能在本次抓取中核到具体更新时间。
- 为何可能愿意复算：其项目本身就以 SEC filing 为数据源做计数与去重，复算 formd-sweep 的关键词子集只需套用现有抽取流程。

### 5. Weirworks — SEC Form D Funding Tracker（Apify Actor）

- 名字：Weirworks（Apify 上的 Form D 采集器作者）
- 链接：https://apify.com/weirworks/sec-form-d-funding
- 相关公开工作：维护"SEC Form D Funding Tracker"采集器，按日抓取 Form D，输出公司、行业、募资额、已售额、投资者数、豁免类型、高管与 placement agent 等字段，支持按行业/州/金额/日期过滤。Apify API 显示该 Actor 创建于 2026-10-03，累计 41 次运行、1 个用户；近 30 天 17 次运行中 15 次成功、2 次失败。
- 最后活跃时间：2026-10-20（Apify API `lastRunStartedAt`）。
- 为何可能愿意复算：其输出是结构化、可过滤的 Form D 明细，能直接导出并与本项目月度合计比对；属于同类测量工具而非评论者，复算结果可验证采集口径差异。

---

## 备注

- 以上"为何可能愿意复算"均基于其已公开的工作内容与技术条件，不代表其意愿、兴趣或对本项目的态度；未进行任何联系。
- GitHub `pushed_at` 可能由自动提交触发，不等同于人工实质性更新。
- PulseMCP 的访问量/下载量为估算值；Crowdfunded Wealth、Pipeline Road、FlareSight 的统计均为其自行口径，引用时需保留原始定义。
