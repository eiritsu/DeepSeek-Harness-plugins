/** Decorative occupant of the calendar sidebar entry. */
import type { ReactNode } from 'react'
import { IconAlarmClockOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'

/** The sidebar supplies only the requested edge and selection state. */
export interface CalendarPanelIconProps {
  readonly size: number
  readonly active?: boolean
}

/**
 * Render the calendar glyph at the sidebar's requested size.
 * @param props - requested square edge.
 * @returns decorative alarm-clock glyph.
 */
export function CalendarPanelIcon({ size }: CalendarPanelIconProps): ReactNode {
  return <IconAlarmClockOutlineRegular size={size} />
}
