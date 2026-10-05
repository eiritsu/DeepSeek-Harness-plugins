# Agent Note: Calendar over the Schedule service

Status: implemented

English | [中文](2026-10-05-calendar-over-schedule-service.zh.md)

## Problem

A person wants one calendar that shows the automations the Harness will run, the ordinary entries they keep, and the feeds they subscribe to. The automations already exist as Schedule tasks owned by a service that delivers them into a Session, and that service is an optional official bundle a profile may not enable.

Three decisions follow from that and are recorded here.

## Decision

**The calendar delegates automations and never owns them.** It reads and writes through `ctx.schedule`, so a task a person creates in the calendar and a task the model creates with `schedule_create` are the same stored row. It also owns `create`, which the Schedule service keeps Host-only, and validates the Session binding before calling it.

**The Schedule row stays the profile's responsibility.** The bundle's patch inserts only its own row. A patch insertion without an `id` always appends, so inserting the Schedule row would mount a second Schedule service — a second task store and a second delivery timer — in any profile that already has one. The service therefore reads the optional service with `ctx.get` rather than declaring it as an injection, which would otherwise leave the plugin waiting without a message. Without the row the calendar still mounts, the page still shows local entries and feeds, and every task method reports `service-unavailable` with the bundle to enable.

**The automation Session picker follows workspace visibility.** The Host offers a Session as a target only when the workspace browser would show it: subagent Sessions and Sessions the user archived are excluded, including a live Session a fallback would otherwise re-add. A cold ordinary Session stays selectable, because the Host Schedule service restores it when a reminder is due. The Client intersects the Host candidates with the same workspace rule (the current blank Session is the one retained by the main view), so the picker matches the sidebar across every workspace.

**A time the Host cannot interpret is refused, not guessed.** `ical.js` answers an unresolvable `TZID` and a floating date-time both as `floating` and then converts them through the process's own zone, so the same feed would place an event differently on every machine. Both are rejected with a fixed message that carries no document content or zone name. A whole-day `VALUE=DATE` value is a civil date the source states, and is kept as stated rather than converted through any zone.

## Alternatives considered

**Insert the Schedule row from the calendar bundle.** A profile that had not enabled it would get automations automatically. The cost is a second Schedule service wherever the row is already present, which duplicates the task store and doubles delivery. The Loader's patch index cannot express "insert only when absent", so the safe composition and the convenient one cannot both be had.

**Declare `schedule` as an injection and let the plugin wait.** This is the ordinary way to depend on a service. It produces an inert plugin with no diagnostic when a profile omits the optional bundle, which is the silent failure this bundle exists to avoid.

**Interpret a floating time in the Host zone.** It would show more events. The choice of zone would be the calendar's, not the feed's, and the same event would move depending on which machine ran the Host. Refusing states the limitation instead of hiding it.

## Consequences

A profile that wants automations enables the official Schedule bundle; without it the calendar is a viewer for local entries and feeds. A feed that omits its `VTIMEZONE` definitions is rejected whole rather than partially shown, because one event placed at a guessed instant is worse than a feed the person can fix. The refused-zone message is safe to log and to show: it names no zone, URL, credential, or document text.

A task's recorded state is what the Schedule service stores. A `lastDelivery` receipt means the reminder reached the Session inbox; it is not evidence that the Agent acted on it, and the page renders no success or failure badge for a task. The Host Schedule service restores a Session itself when a reminder comes due, so an automation created for a Session that is not open is still delivered while the application runs; an application that is not running delivers nothing until it starts again, with no catch-up sweep of the occurrences missed in between.

The Session picker never offers a lineage the sidebar hides, so an automation cannot be bound to a subagent or archived Session even while that Session is loaded. The Host reads the archive set after the Session list resolves, so a Session archived during the read is not returned as a target. The Client keeps the last raw Host candidates and re-intersects them whenever the workspace archive set changes, so archiving or restoring a Session updates the picker without a Host reload; restoring an id the last snapshot omitted issues one controlled refetch. A task already bound to a now-hidden Session keeps its stored record and still shows its linked history.

Calendar pins `ical.js` at 2.2.1. The package distributes its unmodified MPL-2.0 license text and a fixed npm source archive link with the bundle. The notices gate accepts only this package identity, version, and license combination; changing any of them requires a new license review.
