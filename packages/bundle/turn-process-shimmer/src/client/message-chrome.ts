/** Localized elapsed-duration label helpers, equivalent to the ui-chat message-chrome formatter. */

import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'

/** Refresh interval for whole-second live run clocks. */
export const LIVE_RUN_CLOCK_INTERVAL_MS = 1000

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** The elapsed-duration share of the conversation dictionary. */
type RunDurationTranslate =
  Translate<'duration.secondUnit' | 'duration.minuteUnit' | 'duration.hourUnit'>

/**
 * Format the live duration for the running conversation clock.
 * @param ms - elapsed milliseconds.
 * @param t - localized duration formatter.
 * @returns the localized elapsed-time label.
 */
export function formatLiveRunDuration(ms: number, t: RunDurationTranslate): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor(totalSeconds / 60) % 60
  const seconds = String(totalSeconds % 60)
  if (hours > 0) {
    return `${String(hours)}${t('duration.hourUnit')}${pad2(minutes)}${t('duration.minuteUnit')}${seconds}${t('duration.secondUnit')}`
  }
  return minutes > 0
    ? `${pad2(minutes)}${t('duration.minuteUnit')}${seconds}${t('duration.secondUnit')}`
    : `${seconds}${t('duration.secondUnit')}`
}

/**
 * Format the elapsed-time label for a completed run.
 * @param ms - elapsed milliseconds.
 * @param t - localized duration formatter.
 * @returns the localized elapsed-time label.
 */
export function formatRunDuration(ms: number, t: RunDurationTranslate): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor(total / 60) % 60
  const seconds = total % 60
  if (hours > 0) {
    return `${String(hours)}${t('duration.hourUnit')}${pad2(minutes)}${t('duration.minuteUnit')}${pad2(seconds)}${t('duration.secondUnit')}`
  }
  return total >= 60
    ? `${String(minutes)}${t('duration.minuteUnit')}${pad2(seconds)}${t('duration.secondUnit')}`
    : `${String(seconds)}${t('duration.secondUnit')}`
}
