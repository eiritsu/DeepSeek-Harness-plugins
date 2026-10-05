import { describe, expect, it } from 'vitest'
import type { CalendarEntryErrorCode, CalendarImportErrorCode, CalendarSubscriptionErrorCode, CalendarTaskErrorCode } from '../src/types.ts'
import {
  entryFailureKey, importFailureKey, subscriptionFailureKey, taskFailureKey,
} from '../src/client-api.ts'
import { WEEKDAY_KEYS, configEn, configZh, en, zh, type CalendarConfigKey, type CalendarKey } from '../src/client/locales.ts'

const SUBSCRIPTION_CODES: readonly CalendarSubscriptionErrorCode[] = [
  'invalid-url', 'unsupported-protocol', 'not-found', 'request-failed', 'timeout',
  'response-too-large', 'redirect-rejected', 'invalid-ics', 'service-unavailable', 'internal-error',
]
const TASK_CODES: readonly CalendarTaskErrorCode[] = [
  'invalid_prompt', 'invalid_selector', 'invalid_rule', 'invalid_time_zone', 'not_future',
  'time_out_of_range', 'frequency_too_high', 'schedule_not_found', 'schedule_ended',
  'schedule_conflict', 'session_not_found', 'service-unavailable', 'internal_error',
]
const ENTRY_CODES: readonly CalendarEntryErrorCode[] = ['invalid-title', 'invalid-time', 'invalid-range', 'not-found', 'readonly', 'internal-error']
const IMPORT_CODES: readonly CalendarImportErrorCode[] = ['invalid-name', 'invalid-ics', 'response-too-large', 'internal-error']

describe('calendar dictionaries', () => {
  it('keeps English and Chinese key-identical with no empty copy', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    for (const key of Object.keys(en) as CalendarKey[]) expect(en[key].length).toBeGreaterThan(0)
    expect(Object.keys(configEn).sort()).toEqual(Object.keys(configZh).sort())
    for (const key of Object.keys(configEn) as CalendarConfigKey[]) expect(configEn[key].length).toBeGreaterThan(0)
  })

  it('names every weekday and resolves every failure-code key', () => {
    for (const key of WEEKDAY_KEYS) expect(zh[key]).toBeDefined()
    for (const code of SUBSCRIPTION_CODES) expect(zh[subscriptionFailureKey(code)]).toBeDefined()
    for (const code of TASK_CODES) expect(zh[taskFailureKey(code)]).toBeDefined()
    for (const code of ENTRY_CODES) expect(zh[entryFailureKey(code)]).toBeDefined()
    for (const code of IMPORT_CODES) expect(zh[importFailureKey(code)]).toBeDefined()
  })
})
