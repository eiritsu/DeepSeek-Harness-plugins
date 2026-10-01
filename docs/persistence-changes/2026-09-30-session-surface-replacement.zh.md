---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-30-session-surface-replacement

[English](2026-09-30-session-surface-replacement.md) | 中文

## 概述

新增消息表面替换操作使用的持久化 Session 事件。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-30-session-surface-replacement
baseline: false
changes:
  - root: "event:agent/surface-replacement/request-started"
    previous: null
    after: "e8226ef81dcbc1884ae59bbdfd4bcf435d16b6b782174280a447ac7ebad656b2"
    decision: same-version
  - root: "event:agent/surface-replacement/requested"
    previous: null
    after: "7877f3e374c957d55cb18bfd2abc633788e6e1db64dda8d2ea5b19fd2708aa69"
    decision: same-version
  - root: "event:agent/surface-replacement/settled"
    previous: null
    after: "3402c8aae43b8ab01eb1e17e2507ed9a1c1e9176fc104322d7670d461cc117d6"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

现有 Session 日志不包含这些事件，因此不受影响。新日志通过 `requested`、`request-started` 和 `settled` 在重启后恢复编辑操作是否可安全启动、结果不确定或已完成。不认识这些事件的读取器无法加载包含它们的日志；依据 Session 持久化策略，这些事件新增被判定为同版本兼容。

<a id="verification"></a>
## 验证

`pnpm exec vitest run packages/core/agent-loop/tests/surface-replacement.integration.spec.ts packages/bundle/session-message-edit-resend/tests/service.host.spec.ts`：2 个文件共 12 项测试通过。`pnpm run verify-persistence-changes`：65 个 roots 与 10 条记录匹配。

<a id="dev-note"></a>
## 开发备注

无。
