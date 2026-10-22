---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 8172bbfeb60efe68b8a8218b437d3563_1b980b7ecdbc11f1b307525400393706
    ReservedCode1: /3c7ZKEBMOcEUO1HHD2XXVQCQmDgcXFWBHeNkRrwimEBLwP4AzzATS1e4AIIzp/eJC/g9xl3qABDMUjPlmyOlBKibrhTeUd3ckTZbTurrkgyzZ27S6T+iMDbtmJrilx0ZIHRU2/O2n6uzqM97lVJ5/k9APaGjV6Wsiz2fJydZpSZdM6GXM3Zq92fZEg=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 8172bbfeb60efe68b8a8218b437d3563_1b980b7ecdbc11f1b307525400393706
    ReservedCode2: /3c7ZKEBMOcEUO1HHD2XXVQCQmDgcXFWBHeNkRrwimEBLwP4AzzATS1e4AIIzp/eJC/g9xl3qABDMUjPlmyOlBKibrhTeUd3ckTZbTurrkgyzZ27S6T+iMDbtmJrilx0ZIHRU2/O2n6uzqM97lVJ5/k9APaGjV6Wsiz2fJydZpSZdM6GXM3Zq92fZEg=
---

# longgame 故障注入记录（第一阶段）

- 执行日期：2026-10-21
- 执行人：本地自动化脚本
- 执行环境：Windows 10，Node.js，Python 3
- 仓库：assurance-phase1 工作树
- 完整套件：`assurance/fault-injection/run-all.mjs`
- 快速守卫：`assurance/fault-injection/guard-check.mjs`
- 原始结果：`assurance/fault-injection/result.json`
- 汇总日志：`assurance/fault-injection/run-output.log`
- 单场景日志：`assurance/fault-injection/logs/*.log`

## 1. 方法

1. 记录真实仓库 `data/lines/*.json` 的 sha256（注入前）。
2. 将仓库复制到**仓库外**沙箱：`%TEMP%\longgame-fault-injection`。复制时排除 `.git`、`node_modules`、`assurance/fault-injection/work`、`guard-work`、`logs`、`assurance/.gate`。
3. 在沙箱内注入单一种类故障。
4. 依次执行 `scripts/assurance-gate.mjs` 与 `scripts/publish.mjs`。
5. 判定：gate 非零退出、publish 被门禁拒绝、沙箱数据未被 publish 改写。
6. 记录真实仓库注入前后的哈希，确认生产数据未变。
7. 每个场景使用独立沙箱；若目录已存在则复制到带时间戳的新目录，避免残留。

## 2. 结果汇总

完整套件结果：6 个故障，`all_blocked=true`，`real_data_unchanged=true`。

| 故障 | 注入位置 | 预期拦截点 | gate 退出/失败项 | publish | 注入后是否被改写 | 最后有效运行保留 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| column-rename | `assurance/fixtures/grid-queue/normal.json`：`capacity_mw` 改名为 `capacity` | fixtures | 1 / fixtures | 退出 1，被门禁拒绝 | 否 | 是 | BLOCKED |
| unit-mw-to-gw | 同文件：MW 数值除以 1000，单位改为 GW | fixtures | 1 / fixtures | 退出 1，被门禁拒绝 | 否 | 是 | BLOCKED |
| empty-response | `data/lines/grid-queue.json`：追加 0 字节、全零计数的运行 | contracts | 1 / verify | 退出 1，被门禁拒绝 | 否 | 是 | BLOCKED |
| http-429 | 同文件：追加 HTTP 429、`eiaCounts=null` 的运行 | contracts | 1 / contracts | 退出 1，被门禁拒绝 | 否 | 是 | BLOCKED |
| duplicate-rows | 同文件：复制最后一条运行，制造重复 | contracts | 1 / contracts | 退出 1，被门禁拒绝 | 否 | 是 | BLOCKED |
| truncated-data-file | 同文件：截断为前 120 字节 | contracts | 1 / verify | 退出 1，被门禁拒绝 | 否 | 不可计算（false） | BLOCKED（发布被拦，未写回） |

## 3. 关键证据

### 3.1 真实数据未被修改

`result.json` 中 `real_data_hash_before` 与 `real_data_hash_after` 的 10 个文件哈希完全一致，`real_data_unchanged=true`。其中 `grid-queue.json` 前后均为：

```
d56c708837719536bd0e165ad20e337ca7e17b56e7da4da3f1606602b34c4f03
```

### 3.2 发布确实被门禁拒绝

每个场景的 publish 退出码均为 1，输出包含：

```
publish blocked by assurance gate: ...
```

说明 `publish.mjs` 在读取数据之前就被 `assertGate()` 拦下，而不是写入后再回滚。

### 3.3 截断场景的说明

`truncated-data-file` 的 `last_valid_run_preserved` 记录为 `false`，原因是注入后 JSON 已不可解析，无法计算“最后有效运行”的哈希；这**不等于**数据已被覆盖。同一记录的 `write_after_injection=false`，且 publish 退出码为 1。报告与风险登记中按“不可计算”处理，未写成“保留成功”。

## 4. 快速守卫与完整注入的区别

`guard-check.mjs` 只验证两个关键校验器对 6 类输入的拒绝行为，运行快，已接入 `scripts/assurance-gate.mjs`。它不能替代 `run-all.mjs` 的沙箱全链路注入。

- 快速守卫结果：6 faults，`allBlocked=true`，见 `assurance/fault-injection/guard-result.json`。
- 完整注入结果：6 faults，`allBlocked=true`，`realDataUnchanged=true`，见 `assurance/fault-injection/result.json`。

CI 的 assurance-gate 跑的是快速守卫；完整注入需单独执行：

```
node assurance/fault-injection/run-all.mjs
```

## 5. 覆盖边界

已覆盖：

- 契约字段改名
- 单位错误（MW 与 GW 混用）
- 空响应/全零运行
- HTTP 429
- 重复行
- 数据文件截断

未覆盖：

- 上游 schema 渐进漂移（多一列、少一列但不在必需集合内）
- 时区跨日与重复调度
- GitHub Actions 并发、权限、网络超时
- 外部数据线（3 条无本地数据）
- 第三方数据源内容正确性

以上未覆盖项不能推断为无风险。
*（内容由AI生成，仅供参考）*
