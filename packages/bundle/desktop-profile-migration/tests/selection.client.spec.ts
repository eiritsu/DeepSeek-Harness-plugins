import { describe, expect, it, vi } from 'vitest'
import { applyMigrationSelection, splitInstalledCandidates, type BundleEnableResult, type MigrationSelectionOperations } from '../src/client/selection.ts'
import type { DesktopProfileMigrationState } from '../src/types.ts'

const FIRST = '@deepseek-ai/dsh-community-plugin-catalog'
const SECOND = '@deepseek-ai/dsh-community-skill-catalog'

function state(selected: readonly string[] = []): DesktopProfileMigrationState {
  return { eligible: true, complete: false, selected, candidates: [FIRST, SECOND].filter(name => !selected.includes(name)) }
}

function operations(overrides: Partial<MigrationSelectionOperations> = {}): MigrationSelectionOperations {
  return {
    setBundleEnabled: vi.fn(async (): Promise<BundleEnableResult> => ({ ok: true, value: { application: 'applied' } })),
    read: vi.fn(async () => state()),
    complete: vi.fn(async (_expected: readonly string[], chosen: readonly string[]) => ({ ...state([...chosen]), complete: true })),
    ...overrides,
  }
}

describe('explicit Desktop migration selection', () => {
  it('offers only installed optional candidates without altering existing selections', () => {
    const prior = ['base', '@deepseek-ai/dsh-experimental-desktop-app']
    expect(splitInstalledCandidates([FIRST, SECOND], [
      { name: FIRST, installed: true }, { name: SECOND, installed: false },
    ])).toEqual({ installed: [FIRST], missing: [SECOND] })
    expect(prior).toEqual(['base', '@deepseek-ai/dsh-experimental-desktop-app'])
  })

  it('stops on the first failed enable and does not claim completion', async () => {
    const ops = operations({
      setBundleEnabled: vi.fn(async (): Promise<BundleEnableResult> => ({ ok: true, value: { application: 'applied' } }))
        .mockResolvedValueOnce({ ok: true, value: { application: 'applied' } })
        .mockResolvedValueOnce({ ok: true, value: { application: 'failed' } }),
      read: vi.fn(async () => state([FIRST])),
    })
    const result = await applyMigrationSelection([], [FIRST, SECOND], ops)
    expect(result).toEqual({ kind: 'partial', state: state([FIRST]), failedName: SECOND })
    expect(ops.complete).not.toHaveBeenCalled()
    expect(ops.setBundleEnabled).toHaveBeenCalledTimes(2)
  })

  it('re-reads authoritative selection after errors and restart-required outcomes', async () => {
    const ops = operations({
      setBundleEnabled: vi.fn(async (): Promise<BundleEnableResult> => ({ ok: true, value: { application: 'restart-required' } })),
    })
    await expect(applyMigrationSelection([], [FIRST], ops)).resolves.toMatchObject({ kind: 'complete', restartRequired: true })
    expect(ops.complete).toHaveBeenCalledExactlyOnceWith([FIRST], [FIRST])

    const failed = operations({
      setBundleEnabled: vi.fn(async (): Promise<BundleEnableResult> => ({ ok: false, error: { message: 'failed' } })),
      read: vi.fn(async () => state([FIRST])),
    })
    await expect(applyMigrationSelection([], [FIRST], failed)).resolves.toEqual({ kind: 'partial', state: state([FIRST]), failedName: FIRST })
    expect(failed.complete).not.toHaveBeenCalled()
  })

  it.each(['cancelled', 'overridden'])('does not record %s as a successful enable', async (application) => {
    const ops = operations({ setBundleEnabled: vi.fn(async () => ({ ok: true as const, value: { application } })) })
    await expect(applyMigrationSelection([], [FIRST], ops)).resolves.toMatchObject({ kind: 'partial' })
    expect(ops.complete).not.toHaveBeenCalled()
  })
})
