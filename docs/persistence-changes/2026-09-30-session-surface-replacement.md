---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-30-session-surface-replacement

English | [中文](2026-09-30-session-surface-replacement.zh.md)

## Summary

Adds durable Session events used by message surface replacement.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Existing Session logs contain none of these events and remain unaffected. New logs use `requested`, `request-started`, and `settled` to recover whether an edit can start, is uncertain, or is complete after restart. A reader that does not recognize these events cannot load logs that contain them; the event additions are classified as same-version under the Session persistence policy.

<a id="verification"></a>
## Verification

`pnpm exec vitest run packages/core/agent-loop/tests/surface-replacement.integration.spec.ts packages/bundle/session-message-edit-resend/tests/service.host.spec.ts`: 12 tests passed across 2 files. `pnpm run verify-persistence-changes`: 65 roots matched 10 records.

<a id="dev-note"></a>
## Dev Note

None.
