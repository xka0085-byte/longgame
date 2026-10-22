# mcpreflight-weekly: NOT_APPLICABLE

- 状态: NOT_APPLICABLE
- 原因: MCP 服务器预检周线由 mcpdoctor 管理与执行，longgame 仓库没有该线的采集器、原始响应或本地 data/lines 文件。缺原始输入时构造“正常/空/异常”样本会把假数据当成真实证据，因此标 NOT_APPLICABLE，不做假样本。
- 替代证据: docs/assurance/source-status.json 中的外部状态与证据计数；缺证据时记 UNKNOWN。
- 未做: 不构造正常/空/异常样本，不伪造 SHA-256 输入。
