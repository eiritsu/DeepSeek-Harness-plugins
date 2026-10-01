// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '../../../client/ui-renderer/src/client/registry.ts'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/src/client/index.ts'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type {
  ChatNode,
  TurnProcessChatData,
  TurnProcessOwnerProps,
  TurnProcessSpec,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {
  ConversationLocation,
  ConversationLocationDataStore,
  ConversationTurnDataMap,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from '../src/client/TurnProcessShimmerView.module.css'
import { apply, inject } from '../src/client/apply.ts'
import { TurnProcessShimmerView } from '../src/client/TurnProcessShimmerView.tsx'

afterEach(cleanup)

/** Minimal chat dictionaries keeping the official ui-chat values, including
 *  its unit-only duration labels, which the plugin composes into a duration. */
const en = {
  'chat.deepDiving': 'Deep diving...',
  'chat.deepDivingFor': 'Deep diving for {duration}',
  'message.turnProcess.worked': 'Worked',
  'message.turnProcess.took': 'Took {duration}',
  'message.turnProcess.failed': 'Failed',
  'message.stopped': 'Stopped',
  'duration.secondUnit': 's',
  'duration.minuteUnit': 'm ',
  'duration.hourUnit': 'h ',
}
const zh = {
  'chat.deepDiving': '深度求索中',
  'chat.deepDivingFor': '深度求索中，用时 {duration}',
  'message.turnProcess.worked': '已完成工作',
  'message.turnProcess.took': '用时 {duration}',
  'message.turnProcess.failed': '处理失败',
  'message.stopped': '已停止',
  'duration.secondUnit': '秒',
  'duration.minuteUnit': '分',
  'duration.hourUnit': '小时',
}
function makeTranslate(dictionary: Record<string, string>): TranslateNS<'chat'> {
  return ((key: string, params?: Record<string, string | number>) => {
    let value = dictionary[key] ?? key
    for (const [name, replacement] of Object.entries(params ?? {})) {
      value = value.replaceAll(`{${name}}`, String(replacement))
    }
    return value
  }) as TranslateNS<'chat'>
}
const t = makeTranslate(en)
const tZh = makeTranslate(zh)
type ViewFixtureProps = {
  node: ChatNode<'turn-process'>
  turnProcess: TurnProcessOwnerProps
  t: TranslateNS<'chat'>
}

function ViewFixture(props: ViewFixtureProps) {
  // This renderer reads only these three values; the remaining injected Chat seats are not used.
  const rendererProps = props as Parameters<typeof TurnProcessShimmerView>[0]
  return <TurnProcessShimmerView {...rendererProps} />
}

const defaultSpec: TurnProcessSpec = {
  turn: 1,
  controlAnchorSeq: 0,
  processStartSeq: 0,
  answerAnchorSeq: null,
  answerStep: null,
  inlineReasoning: false,
  messageCount: 3,
  toolCallCount: 2,
  subagentCount: 0,
}

const defaultData: TurnProcessChatData = {
  turn: 1,
  controlAnchorSeq: 0,
  processStartSeq: 0,
  answerAnchorSeq: null,
  answerStep: null,
  inlineReasoning: false,
  messageCount: 3,
  toolCallCount: 2,
  subagentCount: 0,
}

/** Build a minimal ConversationLocation with a turn kind. */
function makeLocation(
  turnStatus: 'open' | 'closed',
  startTime: number,
  endTime?: number,
  turnEndReason?: 'completed' | 'aborted' | 'error',
): ConversationLocation {
  return {
    kind: 'turn',
    turn: {
      turn: 1,
      start: {
        type: 'turn/start',
        seq: SessionSeq(0),
        time: startTime,
        data: { turn: 1 },
      },
      end: turnEndReason !== undefined && endTime !== undefined
        ? ({
          type: 'turn/end',
          seq: SessionSeq(1),
          time: endTime,
          data: { turn: 1, reason: { kind: turnEndReason } },
        } as SessionEvent<'turn/end'>)
        : undefined,
      status: turnStatus,
      steps: [],
      data: {} as ConversationLocationDataStore<ConversationTurnDataMap>,
    },
  }
}

/** A node whose owning turn is open (running). */
function makeOpenTurnNode(now = 1_000_000_000_000, turnStart = now): ChatNode<'turn-process'> {
  return ({
    key: 'fixture:turn-process:1',
    kind: 'turn-process',
    id: '1',
    target: 'chat',
    anchorSeq: 0,
    location: makeLocation('open', turnStart),
    visibility: 'visible',
    data: { ...defaultData },
  })
}

/** A node whose owning turn is closed with a reason and a duration. */
function makeClosedTurnNode(reason: 'completed' | 'aborted' | 'error', startTime = 1_000_000_000_000 - 3_000, endTime = 1_000_000_000_000): ChatNode<'turn-process'> {
  return ({
    key: 'fixture:turn-process:1',
    kind: 'turn-process',
    id: '1',
    target: 'chat',
    anchorSeq: 0,
    location: makeLocation('closed', startTime, endTime, reason),
    visibility: 'visible',
    data: { ...defaultData },
  })
}

function makeTurnProcess(overrides: Partial<TurnProcessOwnerProps> = {}): TurnProcessOwnerProps {
  return {
    hasContent: true,
    spec: { ...defaultSpec },
    foldable: true,
    open: false,
    setOpen: (_: boolean) => {},
    ...overrides,
  }
}

/** Reads the visible button label and the aria-live status separately. */
function buttonAndStatus() {
  const button = screen.getByRole('button')
  const status = screen.getByRole('status')
  return { button, status }
}

describe('TurnProcessShimmerView', () => {
  it('shows the running label when turn is open', () => {
    render(<ViewFixture node={makeOpenTurnNode()} turnProcess={makeTurnProcess()} t={t} />)
    const { button, status } = buttonAndStatus()
    expect(button.textContent).toContain('Deep diving')
    expect(status.textContent).toBe('Deep diving...')
  })

  it('has an aria-live status announcement for the running state', () => {
    render(<ViewFixture node={makeOpenTurnNode()} turnProcess={makeTurnProcess()} t={t} />)
    const { status } = buttonAndStatus()
    expect(status.textContent).toBe('Deep diving...')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.getAttribute('aria-atomic')).toBe('true')
  })

  it('shows stopped text when the turn ends with an abort', () => {
    render(<ViewFixture node={makeClosedTurnNode('aborted')} turnProcess={makeTurnProcess()} t={t} />)
    const { button, status } = buttonAndStatus()
    expect(button.textContent).toContain('Stopped')
    expect(status.textContent).toBe('Stopped')
  })

  it('shows failed text when the turn ends with an error', () => {
    render(<ViewFixture node={makeClosedTurnNode('error')} turnProcess={makeTurnProcess()} t={t} />)
    const { button, status } = buttonAndStatus()
    expect(button.textContent).toContain('Failed')
    expect(status.textContent).toBe('Failed')
  })

  it('shows worked text after a completed turn with a duration', () => {
    render(<ViewFixture node={makeClosedTurnNode('completed')} turnProcess={makeTurnProcess()} t={t} />)
    const { button } = buttonAndStatus()
    expect(button.textContent).toContain('Took 3s')
  })

  it('shows Chinese text when tZh is provided', () => {
    render(<ViewFixture node={makeOpenTurnNode()} turnProcess={makeTurnProcess()} t={tZh} />)
    const { button, status } = buttonAndStatus()
    expect(button.textContent).toContain('深度求索中')
    expect(status.textContent).toBe('深度求索中')
  })

  it('applies the shimmer class while running and not when closed', () => {
    render(<ViewFixture node={makeOpenTurnNode()} turnProcess={makeTurnProcess()} t={t} />)
    const { button } = buttonAndStatus()
    const label = button.querySelector('span')
    if (label === null) throw new Error('turn-process label is missing')
    expect(label.className).toContain(css.labelShimmer)
  })

  it('omits the shimmer class for a closed turn', () => {
    render(<ViewFixture node={makeClosedTurnNode('completed')} turnProcess={makeTurnProcess()} t={t} />)
    const { button } = buttonAndStatus()
    const label = button.querySelector('span')
    if (label === null) throw new Error('turn-process label is missing')
    expect(label.className).not.toContain(css.labelShimmer)
  })

  it('button is disabled while the turn is running', () => {
    render(<ViewFixture node={makeOpenTurnNode()} turnProcess={makeTurnProcess()} t={t} />)
    expect((screen.getByRole<HTMLButtonElement>('button')).disabled).toBe(true)
  })

  it('button is enabled when the turn is closed and foldable', () => {
    render(<ViewFixture node={makeClosedTurnNode('completed')} turnProcess={makeTurnProcess()} t={t} />)
    expect((screen.getByRole<HTMLButtonElement>('button')).disabled).toBe(false)
  })

  it('has aria-expanded false when closed', () => {
    render(<ViewFixture node={makeClosedTurnNode('completed')} turnProcess={makeTurnProcess({ open: false })} t={t} />)
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false')
  })

  it('has aria-expanded true when open', () => {
    render(<ViewFixture node={makeOpenTurnNode()} turnProcess={makeTurnProcess({ open: true })} t={t} />)
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true')
  })

  it('toggles open on click when it can collapse', () => {
    const setOpen = vi.fn()
    render(<ViewFixture node={makeClosedTurnNode('completed')} turnProcess={makeTurnProcess({ open: false, setOpen })} t={t} />)
    fireEvent.click(screen.getByRole('button'))
    expect(setOpen).toHaveBeenCalledWith(true)
  })

  it('shows the chevron when it can collapse', () => {
    render(<ViewFixture node={makeClosedTurnNode('completed')} turnProcess={makeTurnProcess()} t={t} />)
    const svg = screen.getByRole('button').querySelector('svg')
    expect(svg).not.toBeNull()
  })

  it('omits the chevron when foldable is false', () => {
    render(<ViewFixture node={makeClosedTurnNode('completed')} turnProcess={makeTurnProcess({ foldable: false })} t={t} />)
    const svg = screen.getByRole('button').querySelector('svg')
    expect(svg).toBeNull()
  })

  it('puts turn data attributes on the button', () => {
    render(<ViewFixture node={makeOpenTurnNode()} turnProcess={makeTurnProcess()} t={t} />)
    const button = screen.getByRole('button')
    expect(button.getAttribute('data-turn-process')).toBe('1')
    expect(button.getAttribute('data-turn-process-messages')).toBe('3')
    expect(button.getAttribute('data-turn-process-tool-calls')).toBe('2')
    expect(button.getAttribute('data-turn-process-subagents')).toBe('0')
  })

  it('advances the elapsed label by one second on the fake clock', async () => {
    const startTime = 1_000_000_000_000
    const turnStart = startTime - 1_500
    vi.useFakeTimers()
    vi.setSystemTime(startTime)
    render(<ViewFixture node={makeOpenTurnNode(startTime, turnStart)} turnProcess={makeTurnProcess()} t={t} />)
    const { button } = buttonAndStatus()
    expect(button.textContent).toContain('1s')
    await vi.advanceTimersByTimeAsync(1_100)
    expect(button.textContent).toContain('2s')
    vi.useRealTimers()
  })

  it('disables the shimmer under prefers-reduced-motion', () => {
    const source = readFileSync('packages/bundle/turn-process-shimmer/src/client/TurnProcessShimmerView.module.css', 'utf8')
    expect(source).toContain('@media (prefers-reduced-motion: reduce)')
    expect(source).toContain('.labelShimmer {\n    animation: none;')
  })
})

describe('registerTurnProcessShimmer', () => {
  it('shadows the official turn-process renderer at a distinct priority', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.slots.register({
      name: 'root',
      children: { 'conversation.chat.node': { kind: 'keyed', scope: 'session' } },
    } as never, (() => null) as never)
    ctx.slots.register({ name: 'conversation.chat.node', key: 'turn-process' }, (() => null) as never)
    ctx.provide('locale', new LocaleRuntime(ctx))
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entries = ctx.slots.entries('conversation.chat.node')
    const [entry] = entries
    if (entry === undefined) throw new Error('turn-process renderer was not registered')
    expect(entry.options.key).toBe('turn-process')
    expect(entry.options.priority).toBe(-1)
    expect(entries.map(({ options }) => options.priority ?? 0)).toEqual([-1, 0])
    await fiber.dispose()
  })
})
