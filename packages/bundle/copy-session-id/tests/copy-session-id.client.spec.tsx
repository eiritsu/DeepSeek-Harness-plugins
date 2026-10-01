// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { zh } from '../src/client/locales.ts'
import { CopySessionIdAction } from '../src/client/CopySessionIdAction.tsx'
import type { CopySessionIdActionProps } from '../src/client/CopySessionIdAction.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const t: CopySessionIdActionProps['t'] = makeTranslate(zh)

function item(sessionId: string) {
  return <CopySessionIdAction {...{
    sessionId: sessionId as SessionId,
    t,
  } as CopySessionIdActionProps} />
}

describe('CopySessionIdMenuItem', () => {
  it('shows localized success after writing the scoped Session ID', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    render(item('session-success'))
    fireEvent.click(screen.getByRole('button', { name: zh['action.copy'] }))
    await vi.waitFor(() =>{  expect(screen.getByRole('button', { name: zh['action.copied'] })).toBeDefined() })
    expect(writeText).toHaveBeenCalledExactlyOnceWith('session-success')
  })

  it('shows localized failure and leaves the action available to retry', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockRejectedValue(new Error('denied'))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    render(item('session-denied'))
    fireEvent.click(screen.getByRole('button', { name: zh['action.copy'] }))
    const failed = await screen.findByRole('button', { name: zh['action.copyFailed'] })
    expect(failed).toBeDefined()
    expect((failed as HTMLButtonElement).disabled).toBe(false)
    expect(writeText).toHaveBeenCalledExactlyOnceWith('session-denied')
  })

  it('copies the identity belonging to each mounted Session scope', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    render(<>{item('session-one')}{item('session-two')}</>)
    const actions = screen.getAllByRole('button', { name: zh['action.copy'] })
    fireEvent.click(actions[0]!)
    fireEvent.click(actions[1]!)
    await vi.waitFor(() =>{  expect(writeText).toHaveBeenCalledTimes(2) })
    expect(writeText.mock.calls.map(call => call[0])).toEqual(['session-one', 'session-two'])
  })
})
