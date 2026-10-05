import { describe, expect, it } from 'vitest'
import ICAL from 'ical.js'
import { allDaySourceDates, occurrenceKey, parseIcs } from '../src/ics.ts'
import type { IcsParseBounds } from '../src/ics.ts'
import type { IcsOwner } from '../src/ics.ts'

/** Owner prefix every case attributes its rows to. */
const OWNER: IcsOwner = { origin: 'subscription', ownerId: 'sub-1' }

/** Epoch milliseconds of `2026-10-01T00:00:00Z`. */
const OCTOBER = Date.parse('2026-10-01T00:00:00.000Z')

/** Bounds wide enough to accept every fixture, with a generous step budget. */
function bounds(overrides: Partial<IcsParseBounds> = {}): IcsParseBounds {
  return {
    from: OCTOBER,
    to: Date.parse('2026-12-01T00:00:00.000Z'),
    maxEvents: 100,
    maxOccurrences: 1_000,
    maxOccurrencesPerEvent: 1_000,
    maxExpansionIterations: 5_000,
    ...overrides,
  }
}

/**
 * Wrap VEVENT bodies in a complete VCALENDAR.
 * @param lines - Property lines, one per line.
 * @returns a parseable iCalendar document.
 */
function calendar(...lines: string[]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//dsh-calendar-test//EN',
    ...lines,
    'END:VCALENDAR',
    '',
  ].join('\r\n')
}

/**
 * Build one VEVENT.
 * @param lines - The event's own property lines.
 * @returns the component lines.
 */
function vevent(...lines: string[]): string[] {
  return ['BEGIN:VEVENT', 'DTSTAMP:20260101T000000Z', ...lines, 'END:VEVENT']
}

describe('parseIcs ordinary events', () => {
  it('returns every plain event instead of treating them all as overrides', () => {
    const text = calendar(
      ...vevent('UID:a', 'DTSTART:20261005T090000Z', 'DTEND:20261005T100000Z', 'SUMMARY:First'),
      ...vevent('UID:b', 'DTSTART:20261006T090000Z', 'DTEND:20261006T100000Z', 'SUMMARY:Second'),
      ...vevent('UID:c', 'DTSTART:20261007T090000Z', 'DTEND:20261007T100000Z', 'SUMMARY:Third'),
    )
    const result = parseIcs(text, bounds())
    expect(result.occurrences.map(occurrence => occurrence.title)).toEqual(['First', 'Second', 'Third'])
    expect(result.droppedOccurrences).toBe(0)
  })

  it('gives a whole-day event with no DTEND exactly one day of duration', () => {
    const text = calendar(...vevent('UID:allday', 'DTSTART;VALUE=DATE:20261006', 'SUMMARY:Holiday'))
    const [occurrence] = parseIcs(text, bounds()).occurrences
    expect(occurrence?.allDay).toBe(true)
    expect(occurrence?.date).toBe('2026-10-06')
    expect(occurrence?.startsAt).toBe('2026-10-06T00:00:00.000Z')
    expect(occurrence?.endsAt).toBe('2026-10-07T00:00:00.000Z')
  })

  it('bounds a long whole-day event by the caller budget rather than a fixed span', () => {
    const text = calendar(...vevent('UID:year', 'DTSTART;VALUE=DATE:20260101', 'DTEND;VALUE=DATE:20270101', 'SUMMARY:Year long'))
    const [occurrence] = parseIcs(text, bounds()).occurrences
    // RFC 5545 places no upper bound on an event's span; the caller's row
    // budget decides how many dates are materialized.
    expect(allDaySourceDates(occurrence!, 5)).toEqual([
      '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05',
    ])
  })

  it('spans a multi-day whole-day event across every covered source date', () => {
    const text = calendar(
      ...vevent('UID:allday', 'DTSTART;VALUE=DATE:20261006', 'DTEND;VALUE=DATE:20261009', 'SUMMARY:Conference'),
    )
    const [occurrence] = parseIcs(text, bounds()).occurrences
    expect(occurrence?.allDay).toBe(true)
    expect(allDaySourceDates(occurrence!, 10)).toEqual(['2026-10-06', '2026-10-07', '2026-10-08'])
  })

  it('keeps a timed event with no DTEND as a point in time', () => {
    const text = calendar(...vevent('UID:instant', 'DTSTART:20261007T120000Z', 'SUMMARY:Alarm'))
    const [occurrence] = parseIcs(text, bounds()).occurrences
    expect(occurrence?.allDay).toBe(false)
    expect(occurrence?.endsAt).toBeUndefined()
  })

  it('includes a point-in-time event that starts exactly on the range start', () => {
    const text = calendar(...vevent('UID:edge', 'DTSTART:20261001T000000Z', 'SUMMARY:Boundary'))
    expect(parseIcs(text, bounds()).occurrences.map(occurrence => occurrence.startsAt))
      .toEqual(['2026-10-01T00:00:00.000Z'])
  })

  it('excludes a point-in-time event that starts exactly on the exclusive range end', () => {
    const text = calendar(...vevent('UID:edge', 'DTSTART:20261201T000000Z', 'SUMMARY:Boundary'))
    expect(parseIcs(text, bounds()).occurrences).toEqual([])
  })

  it('substitutes a title for an event that declares none', () => {
    const text = calendar(...vevent('UID:bare', 'DTSTART:20261007T120000Z'))
    expect(parseIcs(text, bounds()).occurrences[0]?.title).toBe('(untitled event)')
  })
})

describe('parseIcs recurrence', () => {
  it('expands a multi-year daily rule into the requested window only', () => {
    const text = calendar(...vevent(
      'UID:long',
      'DTSTART:20180101T090000Z',
      'DTEND:20180101T093000Z',
      'RRULE:FREQ=DAILY',
      'SUMMARY:Daily standup',
    ))
    const result = parseIcs(text, bounds({ maxExpansionIterations: 20_000 }))
    expect(result.occurrences).toHaveLength(61)
    expect(result.occurrences[0]?.startsAt).toBe('2026-10-01T09:00:00.000Z')
    expect(result.occurrences.at(-1)?.startsAt).toBe('2026-11-30T09:00:00.000Z')
    expect(result.occurrences.every(occurrence => occurrence.recurring)).toBe(true)
  })

  it('spends the per-event budget only on occurrences inside the window', () => {
    const text = calendar(...vevent(
      'UID:long',
      'DTSTART:20180101T090000Z',
      'DTEND:20180101T093000Z',
      'RRULE:FREQ=DAILY',
      'SUMMARY:Daily standup',
    ))
    // Two slots for October: a budget spent on the 2018 history would starve it.
    const result = parseIcs(text, bounds({ maxOccurrencesPerEvent: 2, maxExpansionIterations: 20_000 }))
    expect(result.occurrences.map(occurrence => occurrence.startsAt)).toEqual([
      '2026-10-01T09:00:00.000Z',
      '2026-10-02T09:00:00.000Z',
    ])
    expect(result.droppedOccurrences).toBeGreaterThan(0)
  })

  it('reports a rule whose step budget ran out before the window began', () => {
    const text = calendar(...vevent(
      'UID:long',
      'DTSTART:20180101T090000Z',
      'DTEND:20180101T093000Z',
      'RRULE:FREQ=DAILY',
      'SUMMARY:Daily standup',
    ))
    const result = parseIcs(text, bounds({ maxExpansionIterations: 10 }))
    expect(result.occurrences).toEqual([])
    expect(result.droppedOccurrences).toBe(1)
  })

  it('applies a RECURRENCE-ID reschedule to the moved occurrence', () => {
    const text = calendar(
      ...vevent('UID:series', 'DTSTART:20261005T090000Z', 'DTEND:20261005T093000Z', 'RRULE:FREQ=DAILY;COUNT=3', 'SUMMARY:Standup'),
      ...vevent('UID:series', 'RECURRENCE-ID:20261006T090000Z', 'DTSTART:20261006T150000Z', 'DTEND:20261006T153000Z', 'SUMMARY:Moved standup'),
    )
    const result = parseIcs(text, bounds())
    expect(result.occurrences.map(occurrence => [occurrence.startsAt, occurrence.title])).toEqual([
      ['2026-10-05T09:00:00.000Z', 'Standup'],
      ['2026-10-06T15:00:00.000Z', 'Moved standup'],
      ['2026-10-07T09:00:00.000Z', 'Standup'],
    ])
    expect(result.occurrences[1]?.endsAt).toBe('2026-10-06T15:30:00.000Z')
  })

  it('withholds a cancelled override from the series', () => {
    const text = calendar(
      ...vevent('UID:series', 'DTSTART:20261005T090000Z', 'DTEND:20261005T093000Z', 'RRULE:FREQ=DAILY;COUNT=3', 'SUMMARY:Standup'),
      ...vevent('UID:series', 'RECURRENCE-ID:20261006T090000Z', 'DTSTART:20261006T090000Z', 'DTEND:20261006T093000Z', 'STATUS:CANCELLED', 'SUMMARY:Gone'),
    )
    const result = parseIcs(text, bounds())
    expect(result.occurrences.map(occurrence => occurrence.startsAt)).toEqual([
      '2026-10-05T09:00:00.000Z',
      '2026-10-07T09:00:00.000Z',
    ])
    // A cancellation is source data, not a rejected occurrence.
    expect(result.droppedOccurrences).toBe(0)
  })

  it('shows an occurrence an override far past the range moved back into it', () => {
    const text = calendar(
      ...vevent('UID:series', 'DTSTART:20261002T090000Z', 'DTEND:20261002T093000Z', 'RRULE:FREQ=DAILY', 'SUMMARY:Daily'),
      // The recurrence id is a year past the range end; the override moves that
      // occurrence back to a day inside it.
      ...vevent(
        'UID:series',
        'RECURRENCE-ID:20271004T090000Z',
        'DTSTART:20261020T140000Z',
        'DTEND:20261020T143000Z',
        'SUMMARY:Far out, moved back',
      ),
    )
    const result = parseIcs(text, bounds({ maxExpansionIterations: 20_000 }))
    const moved = result.occurrences.find(occurrence => occurrence.title === 'Far out, moved back')
    expect(moved?.startsAt).toBe('2026-10-20T14:00:00.000Z')
    // Resolving the override is not a bound rejection, so nothing is reported
    // as dropped for it.
    expect(result.droppedOccurrences).toBe(0)
  })

  it('does not show an occurrence an override moved out of the range', () => {
    const text = calendar(
      ...vevent('UID:series', 'DTSTART:20261002T090000Z', 'DTEND:20261002T093000Z', 'RRULE:FREQ=DAILY', 'SUMMARY:Daily'),
      ...vevent('UID:series', 'RECURRENCE-ID:20261005T090000Z', 'DTSTART:20261220T090000Z', 'DTEND:20261220T093000Z', 'SUMMARY:Moved away'),
    )
    const result = parseIcs(text, bounds())
    expect(result.occurrences.map(occurrence => occurrence.startsAt)).not.toContain('2026-12-20T09:00:00.000Z')
    expect(result.occurrences.map(occurrence => occurrence.title)).not.toContain('Moved away')
  })

  it('withholds a master the source cancelled, without counting it as rejected', () => {
    const text = calendar(...vevent('UID:gone', 'DTSTART:20261005T090000Z', 'DTEND:20261005T100000Z', 'STATUS:CANCELLED', 'SUMMARY:Cancelled'))
    const result = parseIcs(text, bounds())
    expect(result.occurrences).toEqual([])
    expect(result.droppedOccurrences).toBe(0)
    expect(result.droppedEvents).toBe(0)
  })

  it('does not report an infinite rule as truncated when it reaches the range end', () => {
    const text = calendar(...vevent(
      'UID:endless',
      'DTSTART:20261001T090000Z',
      'DTEND:20261001T093000Z',
      'RRULE:FREQ=DAILY',
      'SUMMARY:Endless',
    ))
    const result = parseIcs(text, bounds())
    expect(result.occurrences).toHaveLength(61)
    expect(result.droppedOccurrences).toBe(0)
  })

  it('removes an EXDATE from the expanded series', () => {
    const text = calendar(...vevent(
      'UID:series',
      'DTSTART:20261005T090000Z',
      'DTEND:20261005T093000Z',
      'RRULE:FREQ=DAILY;COUNT=4',
      'EXDATE:20261006T090000Z',
      'SUMMARY:Standup',
    ))
    const result = parseIcs(text, bounds())
    expect(result.occurrences.map(occurrence => occurrence.startsAt)).toEqual([
      '2026-10-05T09:00:00.000Z',
      '2026-10-07T09:00:00.000Z',
      '2026-10-08T09:00:00.000Z',
    ])
  })

  it('keeps the daily duration of a whole-day series on every occurrence', () => {
    const text = calendar(...vevent(
      'UID:series',
      'DTSTART;VALUE=DATE:20261005',
      'RRULE:FREQ=DAILY;COUNT=3',
      'SUMMARY:Office closed',
    ))
    const result = parseIcs(text, bounds())
    expect(result.occurrences.map(occurrence => [occurrence.date, occurrence.endsAt])).toEqual([
      ['2026-10-05', '2026-10-06T00:00:00.000Z'],
      ['2026-10-06', '2026-10-07T00:00:00.000Z'],
      ['2026-10-07', '2026-10-08T00:00:00.000Z'],
    ])
  })

  it('rejects a document beyond the configured component ceiling', () => {
    const text = calendar(
      ...vevent('UID:a', 'DTSTART:20261005T090000Z', 'SUMMARY:A'),
      ...vevent('UID:b', 'DTSTART:20261006T090000Z', 'SUMMARY:B'),
    )
    const result = parseIcs(text, bounds({ maxEvents: 1 }))
    expect(result.occurrences).toHaveLength(1)
    expect(result.droppedEvents).toBe(1)
  })

  it('counts override components against the same component ceiling', () => {
    const text = calendar(
      ...vevent('UID:a', 'DTSTART:20261002T090000Z', 'DTEND:20261002T093000Z', 'RRULE:FREQ=DAILY;COUNT=5', 'SUMMARY:A'),
      ...vevent('UID:a', 'RECURRENCE-ID:20261003T090000Z', 'DTSTART:20261003T110000Z', 'DTEND:20261003T113000Z', 'SUMMARY:Moved'),
      ...vevent('UID:a', 'RECURRENCE-ID:20261004T090000Z', 'DTSTART:20261004T120000Z', 'DTEND:20261004T123000Z', 'SUMMARY:Moved too'),
    )
    // Only the master is admitted; both overrides fall outside the ceiling and
    // are counted, so a feed of overrides cannot expand the component budget.
    const result = parseIcs(text, bounds({ maxEvents: 1 }))
    expect(result.occurrences.map(occurrence => occurrence.title)).toEqual(['A', 'A', 'A', 'A', 'A'])
    expect(result.droppedEvents).toBe(2)
  })

  it('rejects occurrences beyond the configured document ceiling', () => {
    const text = calendar(
      ...vevent('UID:a', 'DTSTART:20261005T090000Z', 'DTEND:20261005T093000Z', 'RRULE:FREQ=DAILY;COUNT=5', 'SUMMARY:A'),
      ...vevent('UID:b', 'DTSTART:20261006T090000Z', 'DTEND:20261006T093000Z', 'RRULE:FREQ=DAILY;COUNT=5', 'SUMMARY:B'),
    )
    const result = parseIcs(text, bounds({ maxOccurrences: 3 }))
    expect(result.occurrences).toHaveLength(3)
    expect(result.droppedOccurrences).toBe(7)
  })
})

describe('parseIcs time zones the Host will not guess', () => {
  it('refuses a time zone the document does not define', () => {
    const text = calendar(...vevent(
      'UID:tz',
      'DTSTART;TZID=Asia/Shanghai:20261005T090000',
      'DTEND;TZID=Asia/Shanghai:20261005T100000',
      'SUMMARY:Unresolvable',
    ))
    const result = parseIcs(text, bounds())
    // Guessing here would place the event differently on every machine.
    expect(result.occurrences).toEqual([])
    expect(result.unsupportedZone).toBe('The event uses an undefined time zone. Supply its VTIMEZONE or use UTC.')
    expect(result.droppedOccurrences).toBe(0)
  })

  it('refuses a floating date-time rather than reading it as UTC', () => {
    const text = calendar(...vevent('UID:float', 'DTSTART:20261005T090000', 'DTEND:20261005T100000', 'SUMMARY:Floating'))
    const result = parseIcs(text, bounds())
    expect(result.occurrences).toEqual([])
    expect(result.unsupportedZone).toMatch(/floating date-time/)
  })

  it('keeps a UTC date-time, which states its own zone', () => {
    const text = calendar(...vevent('UID:utc', 'DTSTART:20261005T090000Z', 'DTEND:20261005T100000Z', 'SUMMARY:UTC'))
    const result = parseIcs(text, bounds())
    expect(result.unsupportedZone).toBeUndefined()
    expect(result.occurrences[0]?.startsAt).toBe('2026-10-05T09:00:00.000Z')
  })

  it('keeps a whole-day value on the civil date the source states', () => {
    const text = calendar(...vevent('UID:day', 'DTSTART;VALUE=DATE:20261005', 'SUMMARY:Whole day'))
    const [occurrence] = parseIcs(text, bounds()).occurrences
    // The stored instant is the date's UTC midnight, never the process zone's
    // rendering of that date.
    expect(occurrence?.date).toBe('2026-10-05')
    expect(occurrence?.startsAt).toBe('2026-10-05T00:00:00.000Z')
    expect(occurrence?.endsAt).toBe('2026-10-06T00:00:00.000Z')
  })

  it('refuses a recurring series whose zone the document does not define', () => {
    const text = calendar(...vevent(
      'UID:series',
      'DTSTART;TZID=Asia/Shanghai:20261002T090000',
      'DTEND;TZID=Asia/Shanghai:20261002T100000',
      'RRULE:FREQ=DAILY',
      'SUMMARY:Unresolvable series',
    ))
    expect(parseIcs(text, bounds()).unsupportedZone)
      .toBe('The event uses an undefined time zone. Supply its VTIMEZONE or use UTC.')
  })

  it('never echoes the declared TZID or the document', () => {
    const text = calendar(...vevent(
      'UID:tz',
      'DTSTART;TZID=FAKE_PRIVATE_TZID:20261005T090000',
      'SUMMARY:Private payroll review with Payroll Team',
    ))
    const message = parseIcs(text, bounds()).unsupportedZone ?? ''
    expect(message).not.toContain('FAKE_PRIVATE_TZID')
    expect(message).not.toContain('payroll')
    expect(message).not.toContain('BEGIN:VEVENT')
  })
})

describe('parseIcs time zones', () => {
  it('resolves an event against the document own VTIMEZONE definition', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//dsh-calendar-test//EN',
      'BEGIN:VTIMEZONE',
      'TZID:Custom/Alpha',
      'BEGIN:STANDARD',
      'DTSTART:19700101T000000',
      'TZOFFSETFROM:+0900',
      'TZOFFSETTO:+0900',
      'TZNAME:Alpha',
      'END:STANDARD',
      'END:VTIMEZONE',
      'BEGIN:VEVENT',
      'UID:tz',
      'DTSTAMP:20260101T000000Z',
      'DTSTART;TZID=Custom/Alpha:20261005T090000',
      'DTEND;TZID=Custom/Alpha:20261005T100000',
      'SUMMARY:Alpha morning',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\r\n')
    expect(parseIcs(text, bounds()).occurrences[0]?.startsAt).toBe('2026-10-05T00:00:00.000Z')
  })

  it('does not leak one document TZID definition into the next document', () => {
    const document = (offset: string, summary: string): string => [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//dsh-calendar-test//EN',
      'BEGIN:VTIMEZONE',
      'TZID:Custom/Shared',
      'BEGIN:STANDARD',
      'DTSTART:19700101T000000',
      `TZOFFSETFROM:${offset}`,
      `TZOFFSETTO:${offset}`,
      'TZNAME:Shared',
      'END:STANDARD',
      'END:VTIMEZONE',
      'BEGIN:VEVENT',
      'UID:shared',
      'DTSTAMP:20260101T000000Z',
      'DTSTART;TZID=Custom/Shared:20261005T090000',
      'DTEND;TZID=Custom/Shared:20261005T100000',
      `SUMMARY:${summary}`,
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\r\n')
    expect(parseIcs(document('+0900', 'Alpha'), bounds()).occurrences[0]?.startsAt).toBe('2026-10-05T00:00:00.000Z')
    expect(parseIcs(document('+0200', 'Beta'), bounds()).occurrences[0]?.startsAt).toBe('2026-10-05T07:00:00.000Z')
    // The shared registry is back to what it was before either document ran.
    expect(ICAL.TimezoneService.has('Custom/Shared')).toBe(false)
  })
})

describe('parseIcs rejection', () => {
  it('rejects a document whose root component is not a VCALENDAR', () => {
    expect(() => parseIcs(['BEGIN:VEVENT', 'UID:x', 'DTSTART:20261005T090000Z', 'END:VEVENT', ''].join('\r\n'), bounds()))
      .toThrow(/not a VCALENDAR/)
  })

  it('rejects text the iCalendar parser cannot read at all', () => {
    expect(() => parseIcs('not a calendar', bounds())).toThrow()
  })
})

describe('occurrenceKey', () => {
  it('gives a whole-day occurrence one key per covered date', () => {
    const text = calendar(...vevent('UID:allday', 'DTSTART;VALUE=DATE:20261006', 'DTEND;VALUE=DATE:20261008', 'SUMMARY:Conference'))
    const [occurrence] = parseIcs(text, bounds()).occurrences
    expect(allDaySourceDates(occurrence!, 10).map(date => occurrenceKey(OWNER, occurrence!, date))).toEqual([
      's:sub-1:allday@2026-10-06T00:00:00.000Z#2026-10-06',
      's:sub-1:allday@2026-10-06T00:00:00.000Z#2026-10-07',
    ])
  })

  it('gives a timed occurrence one key for its instant', () => {
    const text = calendar(...vevent('UID:timed', 'DTSTART:20261005T090000Z', 'DTEND:20261005T100000Z', 'SUMMARY:Call'))
    const [occurrence] = parseIcs(text, bounds()).occurrences
    expect(occurrenceKey(OWNER, occurrence!)).toBe('s:sub-1:timed@2026-10-05T09:00:00.000Z')
  })
})
