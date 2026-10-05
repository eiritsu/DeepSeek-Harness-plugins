/** Upcoming list beside the month grid: date-grouped entries. */
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { formatClock, formatDateKey, groupByDate, type CalendarViewItem } from './calendar-model.ts'
import { sourceLabelKey } from './labels.ts'
import css from './CalendarPage.module.css'

/** Props of the upcoming list. */
export interface RecentListProps {
  readonly items: readonly CalendarViewItem[]
  readonly today: string
  readonly locale: string
  readonly timeZone: string
  readonly t: TranslateNS<'calendar'>
  readonly onOpenItem: (item: CalendarViewItem) => void
}

/**
 * Render upcoming items grouped by display date.
 * @param props - upcoming items and interaction callback.
 * @returns the list section.
 */
export function RecentList(props: RecentListProps): ReactNode {
  const { items, today, locale, timeZone, t, onOpenItem } = props
  if (items.length === 0) return <p className={css.listEmpty}>{t('recent.empty')}</p>
  const byDate = groupByDate(items)
  return (
    <div className={css.recent}>
      {[...byDate.entries()].map(([date, bucket]) => (
        <section key={date} className={css.recentGroup}>
          <h3 className={css.recentDate}>{date === today ? t('recent.today') : formatDateKey(date, locale)}</h3>
          <ul className={css.recentList}>
            {bucket.map(item => (
              <li key={item.id}>
                <button
                  type="button"
                  className={css.recentRow}
                  aria-label={t('event.open', { title: item.title })}
                  onClick={() => { onOpenItem(item) }}
                >
                  <span className={css.recentTime}>
                    {item.startsAt === undefined || item.allDay ? t('detail.allday') : formatClock(item.startsAt, timeZone, locale)}
                  </span>
                  <span className={css.recentTitle}>{item.title}</span>
                  <span className={css.recentSource}>{t(sourceLabelKey(item))}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
