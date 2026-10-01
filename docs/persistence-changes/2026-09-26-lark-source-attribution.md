---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-26-lark-source-attribution

English | [中文](2026-09-26-lark-source-attribution.zh.md)

## Summary

Records Lark message attribution in persisted Session messages.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

This adds attribution metadata only; the message payload and replay behavior are unchanged. Existing Session readers retain source metadata, while Lark uses its app and platform message identifiers to avoid submitting an already logged message after resuming a persisted Session.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/bundle/lark-integration/tests/lark-conversation.spec.ts: 7 tests passed, including persisted-session redelivery suppression.

<a id="dev-note"></a>
## Dev Note

None.
