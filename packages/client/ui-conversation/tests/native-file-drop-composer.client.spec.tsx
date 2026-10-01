// @vitest-environment jsdom
/**
 * Cross-module regression: a Finder drop and the file picker both reach the
 * mounted Conversation composer, and the registered native-file upload
 * policies — not the drop source — decide whether a native-path DOCX becomes
 * an `@` reference chip or an uploading FileCard. ui-attachment registers its
 * own drop listeners and rail; ui-conversation assembles the composer.
 */
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { act, cleanup, fireEvent } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ISession } from '@deepseek-ai/dsh-api-session-controller/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import {
  SlotTestRuntime, stubConfigForm, usePinnedBrowserLanguages,
} from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { apply as applyAttachments, inject as injectAttachments } from '../../ui-attachment/src/client/index.ts'
import './control-row-dom.ts'

usePinnedBrowserLanguages('zh-CN')

const ROOT = 'root-1' as SessionId

// jsdom implements no Range geometry (Lexical's scroll-into-view measures the
// caret with one once the surface is genuinely contenteditable).
Range.prototype.getBoundingClientRect = () => ({
  top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}),
})

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function docx(name: string): File {
  return new File([Uint8Array.of(1, 2, 3)], name, {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
}

/** A desktop transfer: Chromium omits the `Files` token for a Finder drop. */
function finderTransfer(...files: readonly File[]): { [key: string]: unknown } {
  return {
    types: ['public.file-url'],
    files,
    items: files.map(file => ({
      kind: 'file', getAsFile: () => file, webkitGetAsEntry: () => ({ isDirectory: false }),
    })),
    dropEffect: 'none',
  }
}

async function bench() {
  const runtime = await SlotTestRuntime.create()
  const rootUpload = vi.fn((..._args: unknown[]) => Promise.resolve({
    ok: true as const,
    value: {
      receiptId: 'root-receipt' as never,
      file: { attachmentId: 'root-file' as never, name: 'converted.docx', bytes: 3 },
    },
  }))
  runtime.fileUpload.upload = vi.fn((_sessionId: SessionId, ...args: unknown[]) => rootUpload(...args))
  const developerTools = createSnapshotStore(true)
  runtime.ctx.provide('configForms', {
    developerTools: {
      enabled: developerTools,
      setEnabled: async (enabled: boolean) => { developerTools.set(enabled) },
    },
    get: () => stubConfigForm().scope,
  } as never)
  const openSession = (id: SessionId): void => { runtime.sessions.retainFor(runtime.ctx, id, { source: 'mainView' }) }
  runtime.ctx.provide('uiWorkspace', {
    openWorkspace: vi.fn(async (_workspaceId: WorkspaceId, beforeOpen: (id: SessionId) => void) => {
      beforeOpen(ROOT)
    }),
    openSession: vi.fn(openSession),
  } as never)
  const session = {
    loadOlder: vi.fn<ISession['loadOlder']>(() => Promise.resolve()),
    prompt: vi.fn<ISession['prompt']>(() => Promise.resolve({ ok: true, value: { accepted: true } })),
    cancel: vi.fn<ISession['cancel']>(() => Promise.resolve({ ok: true, value: { accepted: true } })),
  }
  await runtime.sessions.add({ id: ROOT, summary: { title: 'R', displayTitle: 'R', cwd: '/proj' }, session })
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  // The shell's 'main' slot is where the assembly registers its subtree; the
  // conversation entry renders the composer bar this spec drives.
  await runtime.declare({ 'main': { kind: 'keyed', scope: 'root' } })
  await runtime.mount({ inject: [...inject], apply })
  await runtime.mount({ inject: [...injectAttachments], apply: applyAttachments })
  onTestFinished(() => runtime.dispose())
  openSession(ROOT)
  await runtime.flush()
  const slot = runtime.renderSlot('main', {}, { entryKey: 'conversation' })
  const input = runtime.ctx.conversation.input.for(runtime.sessions.scope(ROOT)!)
  return {
    runtime, rootUpload, container: slot.container, queries: slot.view,
    draft: (): string => input.state.getSnapshot().draft, setDraft: (text: string) => { input.setDraft(text) },
  }
}

/** The draft-attachment rail, or null while no draft attachment exists. */
function rail(queries: Awaited<ReturnType<typeof bench>>['queries']): HTMLElement | null {
  return queries.queryByRole('group', { name: '待发送附件' })
}

describe('native-path attachment intake across the drop and picker entries', () => {
  it('cites a Finder-dropped DOCX, then uploads it as a FileCard once Office registers a policy', async () => {
    vi.stubGlobal('__DSH_HOST_PATHS__', { pathFor: (file: File) => `/proj/${file.name}` })
    const b = await bench()

    // Without a policy the draft cites the native path as a chip in the editor,
    // and nothing reaches the rail or the upload queue.
    const dropped = docx('report.docx')
    expect(fireEvent.drop(document.body, { dataTransfer: finderTransfer(dropped) })).toBe(false)
    await vi.waitFor(() => { expect(b.draft()).toBe('@report.docx ') })
    expect(rail(b.queries)).toBeNull()
    expect(b.container.querySelector('[data-composer-input] [title="report.docx"]')).not.toBeNull()
    expect(b.rootUpload).not.toHaveBeenCalled()

    // The hidden picker input reaches the same intake and takes the same verdict.
    b.setDraft('')
    const picked = docx('picked.docx')
    const input = b.container.querySelector<HTMLInputElement>('input[type="file"]')!
    act(() => { fireEvent.change(input, { target: { files: [picked] } }) })
    await vi.waitFor(() => { expect(b.draft()).toBe('@picked.docx ') })
    expect(rail(b.queries)).toBeNull()

    // An accepted policy moves the same file to the rail: no chip, and the
    // upload carries the original browser File under its own name.
    const removePolicy = b.runtime.ctx.nativeFileUploadPolicies.register(
      'dsh-file-recognizer-office', file => file.name.endsWith('.docx'),
    )
    onTestFinished(removePolicy)
    b.setDraft('')
    const converted = docx('converted.docx')
    expect(fireEvent.drop(document.body, { dataTransfer: finderTransfer(converted) })).toBe(false)
    await vi.waitFor(() => { expect(rail(b.queries)?.textContent).toContain('converted.docx') })
    expect(b.draft()).toBe('')
    expect(b.container.querySelector('[data-composer-input] [title="converted.docx"]')).toBeNull()
    await vi.waitFor(() => {
      expect(b.rootUpload).toHaveBeenCalledWith(
        converted, 'converted.docx', expect.any(AbortSignal), expect.any(Function),
      )
    })
  })

  it('keeps a dropped directory a reference while a file policy claims only files', async () => {
    vi.stubGlobal('__DSH_HOST_PATHS__', { pathFor: (file: File) => `/proj/${file.name}` })
    const b = await bench()
    const removePolicy = b.runtime.ctx.nativeFileUploadPolicies.register(
      'dsh-file-recognizer-office', file => file.name.endsWith('.docx'),
    )
    onTestFinished(removePolicy)
    const folder = new File([], 'my project')
    expect(fireEvent.drop(document.body, { dataTransfer: {
      types: ['Files'],
      files: [folder],
      items: [{ kind: 'file', getAsFile: () => folder, webkitGetAsEntry: () => ({ isDirectory: true }) }],
      dropEffect: 'none',
    } })).toBe(false)
    await vi.waitFor(() => { expect(b.draft()).toBe('@"my project/" ') })
    expect(rail(b.queries)).toBeNull()
    expect(b.rootUpload).not.toHaveBeenCalled()
  })
})
