---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 8172bbfeb60efe68b8a8218b437d3563_1a588768cdbc11f1b307525400393706
    ReservedCode1: iJ7QqrRcxKFt6lVEhsDqDjFGrH98MnnhR1E9XVLREbxGU1WQeMei/3qneHEyrC4nWhgT6Y4+J/Ifh6OJ9Xnq35+Q9/tgARx1mw6jyOuHkj5JHjyrJDY6fg6IvjzZGqxCW8J73J8jTfE2Q6H5+RunLf4W2YAfXJwVePuSL4/r7Mfm8lFAdVAI2jZOWFI=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 8172bbfeb60efe68b8a8218b437d3563_1a588768cdbc11f1b307525400393706
    ReservedCode2: iJ7QqrRcxKFt6lVEhsDqDjFGrH98MnnhR1E9XVLREbxGU1WQeMei/3qneHEyrC4nWhgT6Y4+J/Ifh6OJ9Xnq35+Q9/tgARx1mw6jyOuHkj5JHjyrJDY6fg6IvjzZGqxCW8J73J8jTfE2Q6H5+RunLf4W2YAfXJwVePuSL4/r7Mfm8lFAdVAI2jZOWFI=
---

# longgame 保证系统第一阶段：审计基线

- 生成日期：2026-10-21（Asia/Shanghai）
- 分支：assurance-phase1
- 基线快照：基于 `a1dd9e80399fc8ef809a6fb2ba723cff06508000` 的工作树，加本阶段改动；本阶段改动已提交到 assurance-phase1（最终提交见分支 HEAD）
- 方法：只读检查仓库文件与本地数据；不访问外部网络；不修改 `portfolio.json`、`data/lines`、`docs`
- 术语：PASS = 本地实跑检查通过；PARTIAL = 仅覆盖部分对象或仅校验形状；UNKNOWN = 无证据或无法确认
- 哈希清单：`assurance/baseline-hashes.json`（sha256，覆盖 10 个数据线 JSON、12 个 docs 页面、13 份契约、portfolio.json、llms.txt）

## 1. 基线范围

`portfolio.json` 定义 13 条数据线；`data/lines/` 有 10 个本地数据文件；`mcpreflight-weekly`、`erc8004-snapshot`、`protocol-watch` 三条线无本地数据（由外部管理或尚未采集）。

| 类别 | 数量 | 说明 |
| --- | --- | --- |
| portfolio 系列 | 13 | 契约必须一一对应 |
| 本地数据文件 | 10 | 均有 `collect.runs` 与页面 |
| 无本地数据系列 | 3 | mcpreflight-weekly / erc8004-snapshot / protocol-watch |
| 数据契约 | 13 | `assurance/contracts/datasets/*.yaml` |
| 强制契约（enforced） | 1 | grid-queue |
| 仅契约（contract-only） | 9 | 形状已声明，无字段级数据校验器 |
| 外部（external） | 3 | 数据来源与更新不在本仓库 |

## 2. 逐项审计结论

| ID | 检查项 | 证据路径:行 | 结论 | 说明 |
| --- | --- | --- | --- | --- |
| AUD-01 | 13 条数据线均有契约 | `scripts/validate-contracts.mjs:229`、`assurance/contracts/datasets/` | PASS | 缺任一契约即 fail；实跑 13 份、0 失败 |
| AUD-02 | 契约文件数量被硬约束为 13 | `scripts/validate-contracts.mjs:230` | PASS | 数量不等于 13 直接非零退出 |
| AUD-03 | 契约必需字段：id/version/owner/source/schema/units/freshness/failure_policy/publish/review | `scripts/validate-contracts.mjs:166-227` | PASS | 逐字段检查，owner/license/unit 允许 UNKNOWN |
| AUD-04 | enforced 契约必须对所有失败项 fail | `scripts/validate-contracts.mjs:214-218`、`assurance/contracts/datasets/grid-queue.yaml:3` | PASS | 八个 `on_*` 策略全部必须为 fail |
| AUD-05 | grid-queue 字段级校验（字段类型、最小值、主键去重、来源主机、计数与 MW 不变量） | `scripts/validate-contracts.mjs:233-297`、`scripts/validate-contracts.mjs:299` | PASS | 对真实 `data/lines/grid-queue.json` 执行 |
| AUD-06 | grid-queue 最新运行含采集错误/解析错误/无计数时禁止发布 | `scripts/validate-contracts.mjs:254-259` | PASS | 对应 empty-response / http-429 故障均被拦 |
| AUD-07 | 其余 9 条本地线的契约仅为形状校验，无字段级数据校验器 | `scripts/validate-contracts.mjs:298-301`、各契约 `status: "contract-only"` | PARTIAL | 未注册 checker 时只告警，不阻断；这是本阶段已知缺口 |
| AUD-08 | 3 条外部线无本地数据 | `portfolio.json`、`assurance/contracts/datasets/mcpreflight-weekly.yaml:3` 等 | UNKNOWN | 无本地样本可核对；契约声明 external，不能标记为已保证 |
| AUD-09 | 页面数字可从原始数据独立复算 | `scripts/verify.mjs:20-44` | PASS | 10 条有数据线逐条重算；实跑 20 checks、0 failures |
| AUD-10 | 每条采集事件必须带日期 | `scripts/verify.mjs:41-47` | PASS | 10 条有数据线参与，缺日期即 fail |
| AUD-11 | 202/204/空正文不得当作成功，也不得覆盖上一份有效数据 | `scripts/line.mjs:81-88` | PASS | 标记 `unavailable` 后 continue，保留旧数据并写事件 |
| AUD-12 | CSV/Excel 解析缺表、缺列、非数字 MW 必须非零退出 | `scripts/lib/eia_parse.py:17-20`、`:33`、`:43`、`:86` | PASS | 缺任一 sheet/列或 MW 非数字均 `sys.exit(1)` |
| AUD-13 | 采集失败必须以非零退出阻断流水线 | `scripts/run-all.mjs:27`、`:51`、`:61-63` | PASS | failures 计数大于 0 即退出 1 |
| AUD-14 | 单线采集失败同样非零退出 | `scripts/line.mjs:64`、`:249-251` | PASS | pages/dirs/edgar/eia860m/lotl 分支均置 collectFailure |
| AUD-15 | 损坏的数据文件必须阻断发布，不能静默跳过 | `scripts/publish.mjs:19-22` | PASS | JSON 解析失败抛错 |
| AUD-16 | 无完整有效运行时不输出数字 | `scripts/publish.mjs:38-44` | PASS | 排除 unavailablePages/missingFields，无 good 返回 null |
| AUD-17 | 发布前强制校验门禁结果 | `scripts/publish.mjs:5`、`:8`、`scripts/lib/assurance-gate.mjs:58-77` | PASS | 同 commit、同输入指纹、四项全通过才放行 |
| AUD-18 | 门禁输入指纹覆盖数据/契约/样本/portfolio | `scripts/lib/assurance-gate.mjs:22-37` | PASS | 任一文件变化使旧门禁结果失效 |
| AUD-19 | CI 发布流程接入门禁 | `.github/workflows/weekly-collect.yml:19-21`、`.github/workflows/monthly-report.yml:22-24` | PASS | publish 之前串行执行 gate，无 continue-on-error |
| AUD-20 | 独立门禁工作流 | `.github/workflows/assurance-gate.yml:5-8`、`:27` | PASS | PR/push 到 main、assurance-phase1 触发 |
| AUD-21 | 固定样本含独立依据与 sha256 | `assurance/fixtures/grid-queue/manifest.json`、`assurance/fixtures/mcpreflight/manifest.json`、`scripts/run-fixtures.mjs` | PASS | 12 样本；实跑 12/12，期望拒绝样本均按预期失败 |
| AUD-22 | 六种故障注入均被拦住且真实数据未变 | `assurance/fault-injection/result.json`、`assurance/fault-injection/run-output.log` | PASS | 6/6 BLOCKED；真实 data/lines 哈希前后一致 |
| AUD-23 | 故障注入的沙箱隔离 | `assurance/fault-injection/run-all.mjs:14`、`:39-56` | PASS | 工作目录在仓库外；复制时排除 .git/node_modules/logs/.gate |
| AUD-24 | 截断数据文件场景不能证明“保留最后有效数据” | `assurance/fault-injection/result.json` 中 `truncated-data-file.last_valid_run_preserved=false` | PARTIAL | 注入后文件不可读，无法计算；但 `write_after_injection=false`，发布被拦且未写回 |
| AUD-25 | 门禁工作流里的 fault-injection 是快速守卫，不是完整注入 | `scripts/assurance-gate.mjs:10`、`assurance/fault-injection/guard-check.mjs` | PARTIAL | CI 跑 6 个快速场景；完整沙箱注入需单独执行 `run-all.mjs` |
| AUD-26 | 第三方独立验证 | 无 | UNKNOWN | 当前仅为仓库内自洽检查，不构成外部审计或第三方验证 |
| AUD-27 | 长期运行稳定性（跨周/跨月调度、上游格式漂移） | 无历史运行数据 | UNKNOWN | 本阶段只有单次本地实跑，不能推断长期无故障 |
| AUD-28 | GitHub 分支保护是否强制要求该门禁 | 仓库外配置，无证据 | UNKNOWN | 本地文件不能证明远端保护规则已开启 |

## 3. 关键基线哈希

完整清单见 `assurance/baseline-hashes.json`。以下为摘要：

| 对象 | sha256 |
| --- | --- |
| portfolio.json | 见 baseline-hashes.json |
| data/lines/grid-queue.json | `d56c708837719536bd0e165ad20e337ca7e17b56e7da4da3f1606602b34c4f03` |
| data/lines 文件数 | 10 |
| docs 页面数 | 12 |
| 契约数 | 13 |

## 4. 已知偏差与限制

1. `contract-only` 的 9 条线只校验契约结构，不校验真实数据字段；不能把它们计入“已强制保证”。
2. 3 条外部线没有本地数据，任何关于其正确性的结论都是 UNKNOWN。
3. 故障注入覆盖 6 类已知故障，不覆盖上游 schema 渐进漂移、时区跨日、GitHub Actions 权限/并发等故障。
4. `truncated-data-file` 的 `last_valid_run_preserved` 为 false 是“不可计算”而非“已被覆盖”；同一记录中 `write_after_injection=false`。
5. 本基线不修改任何生产数据；所有哈希均取自当前工作树。
*（内容由AI生成，仅供参考）*
