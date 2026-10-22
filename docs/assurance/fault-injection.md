# 故障注入 nightly

生成 2026-10-22T21:26:49.752Z，commit `adf3d001eef5`，运行链接 https://github.com/xka0085-byte/longgame/actions/runs/39857295495。

- 全部故障被拦截：是
- 真实 data/lines 未变：是
- 结论：PASS

| 故障 | 目标 | 预期拦截点 | gate 退出码 | 失败检查 | publish 被拦 | 注入后仍写盘 | 最后有效运行保留 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| column-rename | fixtures/grid-queue/normal.json | fixtures | 1 | fixtures | 是 | 否 | 是 |
| unit-mw-to-gw | fixtures/grid-queue/normal.json | fixtures | 1 | fixtures | 是 | 否 | 是 |
| empty-response | data/lines/grid-queue.json | contracts | 1 | verify | 是 | 否 | 是 |
| http-429 | data/lines/grid-queue.json | contracts | 1 | contracts | 是 | 否 | 是 |
| duplicate-rows | data/lines/grid-queue.json | contracts | 1 | contracts | 是 | 否 | 是 |
| truncated-data-file | data/lines/grid-queue.json | contracts | 1 | verify | 是 | 否 | 否 |

说明：注入只在仓库外的副本中进行；真实数据文件哈希在注入前后一致才记「未变」。truncated-data-file 的「最后有效运行保留」为「否」，原因是注入本身已把 JSON 截断到无法解析，不是 publish 再写入；同行的「注入后仍写盘=否」证明 publish 没有改动文件。
未拦截或写盘任何一项为「是」，本次 nightly 即失败。
