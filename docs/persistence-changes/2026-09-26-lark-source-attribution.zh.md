---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-26-lark-source-attribution

[English](2026-09-26-lark-source-attribution.md) | 中文

## 概述

在持久化的 Session 消息中记录 Lark 来源归属信息。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-26-lark-source-attribution
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-21-user-question-reply"
    after: "13871e2a4a1ba128e8968840aff7e177c9b7e072ecab882f93e13dc7d442b2c5"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-09-21-user-question-reply"
    after: "caddd59030a1aeee76389112afb65752aba56ea81d693cecc1f0843c5db00145"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-09-21-user-question-reply"
    after: "720a00a80efd52257715e6a4b02531f75e3343df221586b2fe5f372c41bdc8d4"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-09-21-user-question-reply"
    after: "d55d3065a293df1e1ca00ac693cbd9be9981101149edd4fae10ffe310ca4b5cd"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

此变更仅增加归属元数据，不改变消息载荷或回放行为。现有 Session reader 会保留来源元数据；Lark 使用应用及平台消息标识，在恢复已持久化 Session 后避免再次提交已记录的消息。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/bundle/lark-integration/tests/lark-conversation.spec.ts：7 个测试通过，其中包括恢复持久化 Session 后抑制重复投递的测试。

<a id="dev-note"></a>
## 开发备注

无。
