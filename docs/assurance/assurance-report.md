# longgame 保证系统第一阶段验收报告

- 报告日期：2026-10-21
- 分支：assurance-phase1
- 阶段目标：为 13 条数据线建立可执行的契约、固定样本、发布门禁、故障注入与审计基线
- 结论口径：只记录本地实跑结果；不声称第三方验证，不承诺零缺陷；UNKNOWN 不写成 PASS

## 1. 交付物

| 类别 | 路径 |
| --- | --- |
| 数据契约（13 份） | `assurance/contracts/datasets/*.yaml` |
| 契约校验器 | `scripts/validate-contracts.mjs` |
| 固定样本（12 个） | `assurance/fixtures/grid-queue/`、`assurance/fixtures/mcpreflight/` |
| 样本执行器 | `scripts/run-fixtures.mjs` |
| 发布门禁 | `scripts/assurance-gate.mjs`、`scripts/lib/assurance-gate.mjs` |
| 完整故障注入 | `assurance/fault-injection/run-all.mjs` |
| 快速故障守卫 | `assurance/fault-injection/guard-check.mjs` |
| CI 门禁工作流 | `.github/workflows/assurance-gate.yml` |
| 发布流程接入 | `.github/workflows/weekly-collect.yml`、`.github/workflows/monthly-report.yml` |
| 审计基线 | `docs/assurance/audit-baseline.md`、`assurance/baseline-hashes.json` |
| 风险登记 | `docs/assurance/risk-register.json` |
| 故障注入记录 | `docs/assurance/fault-injection.md` |
| 本报告 | `docs/assurance/assurance-report.md` |

## 2. 六项硬性验收

### A1 既有 verify 仍为 20 项检查、0 失败

- 命令：`node scripts/verify.mjs`
- 结果：`verify: 20 checks, 0 failures`，退出码 0
- 覆盖：10 条有数据线的页面数字复算 + 10 条事件流日期完整性
- 证据：`scripts/verify.mjs:20-47`
- 说明：这是仓库内自洽检查，不是第三方验证

### A2 改坏列名后门禁失败且发布被拦

- 故障：`capacity_mw` 改名为 `capacity`
- 结果：fixtures 检查退出 1；publish 退出 1，输出 `publish blocked by assurance gate`
- 证据：`assurance/fault-injection/logs/column-rename.log`
- 补充：同类单位错误（MW→GW）同样被 fixtures 拦截

### A3 注入后真实 data/lines 哈希不变

- 结果：`real_data_unchanged=true`
- 覆盖：10 个 `data/lines/*.json`
- 证据：`assurance/fault-injection/result.json` 的 `real_data_hash_before` / `real_data_hash_after`
- grid-queue 前后哈希：`d56c708837719536bd0e165ad20e337ca7e17b56e7da4da3f1606602b34c4f03`

### A4 13 份契约齐全，无编造阈值

- 命令：`node scripts/validate-contracts.mjs`
- 结果：`13 contracts, 0 failures`，退出码 0
- 与 portfolio 一一对应；缺契约或数量不为 13 直接失败
- 无法确认的 owner/license/unit/周期使用 `UNKNOWN` 并列入 `review.unresolved_assumptions`
- 证据：`scripts/validate-contracts.mjs:229-230`、各契约 `review.unresolved_assumptions`
- 限制：只有 `grid-queue` 为 enforced；9 条 contract-only，3 条 external

### A5 审计基线每条有证据路径

- 结果：`docs/assurance/audit-baseline.md` 共 28 条 AUD 记录，每条含 `证据路径:行` 与结论
- 结论分布：PASS / PARTIAL / UNKNOWN，未把无法确认项写成 PASS
- 哈希清单：`assurance/baseline-hashes.json`

### A6 发布流程接入门禁且不可绕过

- `weekly-collect.yml:19-21`：publish 前执行 `node scripts/assurance-gate.mjs`
- `monthly-report.yml:22-24`：publish 前执行同一门禁
- `assurance-gate.yml:5-8`：PR 与 push 到 main、assurance-phase1 触发
- 两个发布工作流均未使用 `continue-on-error`
- `publish.mjs:8` 调用 `assertGate()`，要求同 commit、同输入指纹、四项检查全通过

## 3. 支撑性检查结果

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 契约校验 | `node scripts/validate-contracts.mjs` | 13 contracts, 0 failures |
| 固定样本 | `node scripts/run-fixtures.mjs` | 12 samples, 12 passed, 0 failed |
| 快速故障守卫 | `node assurance/fault-injection/guard-check.mjs` | 6 faults, allBlocked=true |
| 完整故障注入 | `node assurance/fault-injection/run-all.mjs` | 6 faults, allBlocked=true, realDataUnchanged=true |
| 页面复算 | `node scripts/verify.mjs` | 20 checks, 0 failures |

## 4. 本阶段修复项

1. `scripts/run-all.mjs`：采集/雷达失败累加 `failures`，结尾非零退出，避免失败被吞。
2. `scripts/line.mjs`：各采集分支置 `collectFailure`，末尾失败则退出 1；202/204/空正文仍标记 `unavailable` 并保留旧数据。
3. `scripts/publish.mjs`：损坏数据文件抛错阻断；无完整有效运行时不输出数字。
4. `scripts/lib/eia_parse.py`：缺表、缺列、非数字 MW 一律非零退出，不再回退 0.0。
5. `scripts/verify.mjs`：支持 `LONGGAME_DOCS`，可校验候选产物目录。
6. 发布工作流：weekly/monthly 在 publish 前接入门禁；新增独立 `assurance-gate.yml`。
7. `assurance-gate.yml`：修复非 UTF-8/LF 写入导致的 `on:` 被吞问题，统一为 UTF-8 + LF。

## 5. 未实现项

| 项 | 现状 | 影响 |
| --- | --- | --- |
| 9 条 contract-only 线的字段级 checker | 未实现 | 这些线只校验契约形状，不校验真实数据字段 |
| 3 条 external 线的本地数据与校验 | 无本地数据 | 正确性只能标 UNKNOWN |
| 完整 `run-all.mjs` 注入接入 CI | 未接入 | CI 只跑快速守卫；完整注入需单独执行 |
| 门禁失败主动告警 | 未实现 | 依赖 GitHub Actions 默认通知 |
| 独立不可变数据快照 | 未实现 | 回滚依赖 git 提交 |

## 6. 未知项

1. 3 条外部线（mcpreflight-weekly / erc8004-snapshot / protocol-watch）的数据正确性与可用性：UNKNOWN。
2. 跨周/跨月长期运行稳定性：UNKNOWN，本阶段只有单次本地实跑。
3. GitHub 远端分支保护是否强制要求 assurance-gate：UNKNOWN，本地文件无法证明。
4. GitHub Actions 上的实际执行结果：未在远端触发，不能把本地结果当作 CI 已通过。
5. 上游数据源未来变更：UNKNOWN；当前只能保证变更时失败阻断，不能保证适配。

## 7. 阻塞项

本阶段无阻塞交付的缺陷。以下为需要后续处理的风险，不构成本次交付阻塞：

- R-001：9 条线无字段级校验
- R-002：3 条外部线无本地证据
- R-010：CI 未跑完整注入
- R-012：分支保护未知
- R-013：无第三方独立审计

详见 `docs/assurance/risk-register.json`。

## 8. 验收结论

第一阶段要求的脚本、契约、样本、门禁、故障注入与文档均已落地，并完成本地实跑：

- 六项硬性验收全部满足（A1-A6）
- 完整故障注入 6/6 被拦截，真实数据哈希未变
- 发布路径在本地与 CI 配置两层接入门禁
- 仍存在明确边界：仅 1 条线 enforced、3 条线无本地数据、无第三方审计、无长期运行数据

因此本阶段的准确表述是：**本地自洽检查与已知故障注入通过，发布门禁可阻断已知失败模式**。不得表述为“系统已验证无缺陷”或“零风险”。
