---
description: "A calendar profile layer for Schedule automations, local entries, and user-supplied iCalendar subscriptions in Web and Desktop."
kind: "package-bundle"
---

# @deepseek-ai/dsh-calendar

Calendar view over Schedule automations, local entries, and user-supplied iCalendar subscriptions, for the Web and Desktop applications.

English | [中文](README.zh.md)

## Summary

A calendar page for the Web and Desktop applications that combines your Schedule automations, local entries, and user-supplied iCalendar subscriptions in one view. When the official Schedule bundle is enabled it reads and writes those automations; without it the page still shows local data and subscriptions, and every task action reports the missing service.

## Table of Contents

- [Use this package](#use-this-package)
- [What it shows](#what-it-shows)
- [Subscriptions, imports, and time zones](#subscriptions-imports-and-time-zones)
- [Configuration](#configuration)
- [Data and permissions](#data-and-permissions)
- [Verifying an install](#verifying-an-install)
- [Further exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Install the packaged asset through **Plugins → Install** in Web or Desktop, or add its local path to a profile:

```sh
dsh plugin --profile <profile> add /absolute/path/to/deepseek-ai-dsh-calendar-0.2.0-rc.2.tgz
```

The package is validated against Eiritsu's `@deepseek-ai/dsh` **0.2.0-rc.2** distribution, in Web and Desktop. Other Harness releases are unverified: the package mounts the `0.2.0-rc.2` Remote and storage interfaces, so a release that serves different interfaces does not work.

The bundle adds one row, `calendar`, to the profile. It needs the storage services every profile already composes (`@deepseek-ai/dsh-storage-domain` with a backend).

**Automations need the official Schedule bundle.** The calendar reads and writes automations through `ctx.schedule`, which this bundle does not mount: a patch insertion without an `id` always appends, so inserting that row here would start a second Schedule service — a second task store and a second delivery timer — in any profile that already has one. Enable `@deepseek-ai/dsh-schedule`, for example through `@deepseek-ai/dsh-experimental-schedule-bundle`, to get automations. Without it the calendar still mounts, the page still shows local entries, imports, and subscriptions, and every task action reports `service-unavailable` instead of failing to start.

A task the model creates with `schedule_create` and a task a person creates in the calendar are the same stored row, and the calendar reads both.

## What it shows

One snapshot returns, for a requested range and zone: the Host clock and zone, every Schedule task with its recorded state, the occurrences those tasks have inside the range, the local entries, and the entries read from each subscription and import.

A task reports `active` or `inactive` and, when it has one, a `lastDelivery` receipt. **A receipt records that the reminder reached the Session inbox. It is not a report that the Agent acted on it**, and the page renders no success or failure badge for a task.

The Host Schedule service resolves and restores a Session itself when a reminder comes due, so an automation created for a Session that is not open is still delivered while the application is running. Listing sessions for a new automation never activates an Agent. **A fully exited application delivers nothing until it starts again**, and a reminder that came due while it was closed is delivered then, without a catch-up sweep of the occurrences missed in between.

The Session picker offers what the workspace browser shows: ordinary Sessions in any workspace, including cold ones the Host has not restored, but never a subagent Session or one the user archived; among blank Sessions only the current one appears. A task already bound to a Session that later becomes hidden keeps its stored record and its linked history.

## Subscriptions, imports, and time zones

A subscription is an `https:` or `http:` URL the user obtained themselves; the Host never discovers one. Redirects are followed only to the protocol the user chose, each fetch has a deadline and a byte ceiling, and the response is expanded under configured bounds. A failing subscription keeps its last good entries and reports its failure on itself, so a feed that stops answering does not blank the page.

Imported iCalendar text is stored as its own calendar and, like a subscription, is read-only. **Neither source is ever written back**: no `VEVENT` is added, changed, or deleted upstream, and neither source starts an Agent. A subscription's own configuration — its name, URL, and refresh interval — is editable on the configuration page; upstream events are not. There is no free-busy and no organizer reply.

`ical.js` resolves `RRULE`, `EXDATE`, `RECURRENCE-ID` overrides, whole-day `VALUE=DATE` values, and UTC times. A document's own `VTIMEZONE` definitions apply to that document only, so two feeds that define the same zone name differently cannot contaminate each other.

Two cases are **refused rather than guessed**, because `ical.js` would otherwise convert them through the process's own zone and place the same event differently on every machine:

- a date-time whose `TZID` the document does not define;
- a floating date-time, which states no zone at all.

Both produce a fixed message that states the refusal and carries no document content or zone name, so a private feed's contents stay out of a log line and out of a Client message. A whole-day value is never affected: it is the source calendar's own civil date, kept as stated.

## Configuration

Every bound is a field on the `calendar` row, editable from the profile patch or the Plugins detail page. A change takes effect on the next read without restarting the Host.

| Field | Default | Meaning |
|---|---|---|
| `fetchTimeoutMs` | `15000` | Deadline for one subscription fetch, covering connect, redirects, and body. |
| `maxResponseBytes` | `2097152` | Largest accepted response body. |
| `defaultRefreshIntervalSeconds` | `3600` | Interval a new subscription receives when the request omits one. |
| `minRefreshIntervalSeconds` | `300` | Shortest interval a client may request. |
| `maxRefreshIntervalSeconds` | `86400` | Longest interval a client may request. |
| `retentionDays` | `90` | How far back a feed is expanded. |
| `maxEventsPerSubscription` | `1000` | Largest accepted number of `VEVENT` components read from one feed. |
| `maxOccurrencesPerEvent` | `366` | Largest accepted number of occurrences one event contributes to a range. |
| `maxExpansionIterations` | `5000` | Largest accepted number of rule steps evaluated for one event. |
| `maxOccurrencesPerSubscription` | `5000` | Largest accepted number of stored occurrences one source contributes. |
| `expansionHorizonDays` | `180` | How far ahead of the Host clock a feed is expanded. |
| `maxImportedCalendars` | `25` | Largest accepted number of stored imports. |
| `maxEntriesPerSnapshot` | `5000` | Largest accepted number of entries one snapshot returns. |
| `maxOccurrencesPerTask` | `400` | Largest accepted number of occurrences one task contributes. |
| `maxOccurrences` | `2000` | Largest accepted number of task occurrences one snapshot returns. |

A bound that rejects occurrences is reported rather than hidden: `subscription.droppedEntryCount` for a feed, `calendar.droppedEntryCount` for an import, and `snapshot.occurrencesTruncated` or `snapshot.entriesTruncated` for a snapshot's own ceilings. A recurring rule that simply reaches the end of a range is not truncation.

## Data and permissions

The calendar owns one storage domain named `calendar` with three tables: `subscriptions`, `entries`, and `imports`. It reopens them on the next start, so a subscription and its entries survive a restart. Disabling the plugin or closing the profile stops the refresh timer, aborts every fetch in flight, and closes the domain; no timer, request, or stream outlives the plugin.

A subscription's URL is shown on the configuration page, where the user entered it, and is never written to a log. A log line names the subscription and its failure code, never the feed's URL or body.

Network access is limited to the URLs a user adds, with the scheme they chose. There is no credential storage and no telemetry.

No invariant companion is published because the calendar owns no independently observable relation: the store projects the same durable rows and live refresh state that it already holds, and the real-composition Host tests cover opening, refreshing, and disposal.

## Verifying an install

The built package is smoke-tested from its own build output, with no repository path resolution:

```sh
pnpm --filter @deepseek-ai/dsh-calendar run test:packed-artifact
```

It asserts that every built artifact is present, that the generated Remote descriptor carries all fourteen methods, and that a profile row built from the shipped entry activates, answers a snapshot, and unwinds when the row is disabled. It requires the package build in place (`tsc -b tsconfig.host.json` then `tsdown --env.DSH_BUILD_FACE host`); it does not run in the unit suite, which stays on the source plane.

## Further exploration

- [`src/ics.ts`](src/ics.ts) reads iCalendar text: zone registration, recurrence, overrides, and the refusal of an uninterpretable time.
- [`src/subscriptions.ts`](src/subscriptions.ts) owns the serialized write chain, the refresh timer, and the per-subscription generation that discards a stale fetch.
- [`src/service.ts`](src/service.ts) is the Remote surface, including the optional-Schedule behavior and the snapshot's range rules.
- [`cordis.patch.yml`](cordis.patch.yml) is the profile-facing row and its configuration.

## Model Experience

None, as the calendar contributes no prompt section, tool schema, or Session event; the only reminder is delivered by the native Schedule service.

#### KV Cache effect

The calendar makes no model request, so it cannot change a cached prefix.

## Known Limitations and Deferred Work

- **No pause or resume.** Delete a task and create it again; a task is either active or ended.
- **No workday or holiday rules.** A holiday calendar is an ordinary subscription. Nothing here claims to encode make-up workdays or any other jurisdiction's calendar law.
- **No new Session per run.** A reminder always arrives in the Session it was bound to.
- **Sources are read-only.** Subscription and imported entries cannot be edited or deleted individually; remove the source to remove its entries.
- **Floating times and undefined zones are refused**, as described above, rather than interpreted in a chosen zone.
- **`VALARM`, `ATTACH`, and other component details are not rendered**, and a subscription is never written back.
- **A stopped application is not punctual.** A reminder due while the application is not running is delivered when it starts again.

### Dev Note

None.
