/** Locale-bound labels shared by the calendar page, detail, and form. */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ScheduleRecord } from '@deepseek-ai/dsh-schedule/client'
import { formatInterval, formatWeekdays, recordTimeZone, type CalendarViewItem } from './calendar-model.ts'
import { WEEKDAY_KEYS, type CalendarKey } from './locales.ts'

type CalendarTranslate = TranslateNS<'calendar'>

/** Locale keys for the fixed-rate interval units. */
const UNIT_KEYS = { minute: 'unit.minute', hour: 'unit.hour', second: 'unit.second' } as const

/**
 * Locale key naming one item's source.
 * @param item - display item.
 * @returns the source label key.
 */
export function sourceLabelKey(item: CalendarViewItem): CalendarKey {
  if (item.source !== 'task') {
    return item.source === 'subscription' ? 'source.subscription'
      : item.source === 'import' ? 'source.import'
        : 'source.local'
  }
  return item.recurring ? 'source.task' : 'source.once'
}

/** CSS-independent source bucket used for coloring one item. */
export function sourceBucket(item: CalendarViewItem): 'task' | 'once' | 'subscription' | 'import' | 'local' {
  if (item.source !== 'task') return item.source
  return item.recurring ? 'task' : 'once'
}

/**
 * Render one stored rule as localized copy.
 * @param record - stored Schedule record.
 * @param t - calendar-namespace translate.
 * @param locale - active locale for weekday and number formatting.
 * @returns the rule label.
 */
export function ruleLabel(record: ScheduleRecord, t: CalendarTranslate, locale: string): string {
  switch (record.kind) {
    case 'after':
    case 'at':
      return t('rule.at')
    case 'daily':
      return t('rule.daily', { time: record.time.slice(0, 5) })
    case 'weekly':
      return t('rule.weekly', {
        weekdays: formatWeekdays(record.weekdays, locale, weekday => t(WEEKDAY_KEYS[weekday - 1] ?? 'grid.weekday.1')),
        time: record.time.slice(0, 5),
      })
    case 'every': {
      const interval = formatInterval(record.everySeconds, unit => t(UNIT_KEYS[unit]))
      return t('rule.every', interval)
    }
    case 'cron':
      return t('rule.cron', { expression: record.expression })
  }
}

/** Explicit zone of one record, defaulting when the record stores none. */
export function recordZone(record: ScheduleRecord, fallback: string): string {
  return recordTimeZone(record) ?? fallback
}
