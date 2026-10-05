/** Month grid: six week rows of day cells with event chips and an overflow control. */
import type { ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { monthMatrix, formatClock, subscriptionColor, type CalendarViewItem, type MonthCell } from './calendar-model.ts'
import { WEEKDAY_KEYS } from './locales.ts'
import css from './CalendarPage.module.css'

/** Maximum event chips drawn inside one day cell before the overflow control. */
const MAX_CHIPS = 3

/** Props of the month grid; all data arrives from the page. */
export interface MonthGridProps {
  readonly year: number
  readonly month: number
  readonly today: string
  readonly selectedDate: string
  readonly itemsByDate: ReadonlyMap<string, readonly CalendarViewItem[]>
  readonly locale: string
  readonly timeZone: string
  readonly t: TranslateNS<'calendar'>
  readonly onSelectDate: (dateKey: string) => void
  readonly onOpenItem: (item: CalendarViewItem) => void
}

/**
 * Render one month as a Monday-first grid with real `row`/`gridcell` structure.
 * @param props - month anchor, bucket map, and interaction callbacks.
 * @returns the grid region.
 */
export function MonthGrid(props: MonthGridProps): ReactNode {
  const { year, month, today, selectedDate, itemsByDate, locale, timeZone, t, onSelectDate, onOpenItem } = props
  const rows = weeks(monthMatrix(year, month))
  return (
    <div className={css.grid} role="grid" aria-label={t('grid.label')}>
      <div className={css.gridHead} role="row">
        {WEEKDAY_KEYS.map((key, index) => (
          <span key={key} role="columnheader" className={css.gridHeadCell}>{t(key, { weekday: index + 1 })}</span>
        ))}
      </div>
      <div className={css.gridBody}>
        {rows.map((row, index) => (
          <div key={row[0]?.dateKey ?? index} role="row" className={css.gridRow}>
            {row.map(cell => (
              <DayCell
                key={cell.dateKey}
                cell={cell}
                items={itemsByDate.get(cell.dateKey) ?? []}
                today={today}
                selected={cell.dateKey === selectedDate}
                locale={locale}
                timeZone={timeZone}
                t={t}
                onSelectDate={onSelectDate}
                onOpenItem={onOpenItem}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

interface DayCellProps {
  readonly cell: MonthCell
  readonly items: readonly CalendarViewItem[]
  readonly today: string
  readonly selected: boolean
  readonly locale: string
  readonly timeZone: string
  readonly t: TranslateNS<'calendar'>
  readonly onSelectDate: (dateKey: string) => void
  readonly onOpenItem: (item: CalendarViewItem) => void
}

function DayCell(props: DayCellProps): ReactNode {
  const { cell, items, today, selected, locale, timeZone, t, onSelectDate, onOpenItem } = props
  const shown = items.slice(0, MAX_CHIPS)
  const overflow = items.length - shown.length
  return (
    <div
      role="gridcell"
      aria-selected={selected}
      className={cellClass(cell.inMonth, cell.dateKey === today, selected)}
    >
      <button
        type="button"
        className={css.day}
        aria-pressed={selected}
        aria-label={`${t('grid.day', { month: cell.dateKey.slice(5, 7), day: cell.day })} · ${t('grid.dayCount', { count: items.length })}`}
        onClick={() => { onSelectDate(cell.dateKey) }}
      >
        {cell.day}
      </button>
      <ul className={css.cellEvents}>
        {shown.map(item => (
          <li key={item.id} className={css.cellEvent}>
            <button
              type="button"
              className={classes(css.chip, chipSourceClass(item))}
              style={chipStyle(item)}
              title={item.title}
              aria-label={t('event.open', { title: item.title })}
              onClick={() => { onOpenItem(item) }}
            >
              {item.allDay || item.startsAt === undefined
                ? item.title
                : `${formatClock(item.startsAt, timeZone, locale)} ${item.title}`}
            </button>
          </li>
        ))}
        {overflow > 0
          ? (
            <li className={css.cellEvent}>
              <button type="button" className={css.chipMore} onClick={() => { onSelectDate(cell.dateKey) }}>
                {t('recent.more', { count: overflow })}
              </button>
            </li>
          )
          : null}
      </ul>
    </div>
  )
}

function weeks(cells: readonly MonthCell[]): MonthCell[][] {
  const rows: MonthCell[][] = []
  for (let index = 0; index < cells.length; index += 7) rows.push(cells.slice(index, index + 7))
  return rows
}

function classes(...names: readonly (string | undefined)[]): string {
  return names.filter((name): name is string => name !== undefined).join(' ')
}

function cellClass(inMonth: boolean, isToday: boolean, selected: boolean): string {
  return classes(
    css.cell,
    inMonth ? undefined : css.cellOutside,
    isToday ? css.cellToday : undefined,
    selected ? css.cellSelected : undefined,
  )
}

function chipSourceClass(item: CalendarViewItem): string | undefined {
  if (item.source === 'task') return item.recurring ? css.chipTask : css.chipOnce
  if (item.source === 'subscription') return css.chipSubscription
  if (item.source === 'import') return css.chipImport
  return css.chipLocal
}

function chipStyle(item: CalendarViewItem): { borderInlineStartColor?: string } | undefined {
  if (item.source === 'task') return undefined
  const color = item.color ?? (item.subscriptionId === undefined ? undefined : subscriptionColor(item.subscriptionId))
  return color === undefined ? undefined : { borderInlineStartColor: color }
}
