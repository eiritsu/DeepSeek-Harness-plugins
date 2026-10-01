import { describe, expect, it, vi } from 'vitest'
import { NativeFileUploadPolicies } from '../src/client/input/native-file-upload-policies.ts'

describe('NativeFileUploadPolicies', () => {
  it('uses additive registrations and disposes only the registration it created', () => {
    const registry = new NativeFileUploadPolicies()
    const accepts = vi.fn((file: File) => file.name.endsWith('.docx'))
    const disposeFirst = registry.register('office', accepts)
    const file = new File(['doc'], 'report.docx')
    expect(registry.accepts(file)).toBe(true)
    expect(registry.accepts(new File(['x'], 'notes.txt'))).toBe(false)

    disposeFirst()
    registry.register('office', accepts)
    disposeFirst()
    expect(registry.accepts(file)).toBe(true)
    expect(() => registry.register('office', accepts)).toThrow('duplicate id "office"')
  })

  it('keeps independent owner registrations until each disposer runs', () => {
    const registry = new NativeFileUploadPolicies()
    const first = registry.register('office', file => file.name.endsWith('.docx'))
    const second = registry.register('media', file => file.name.endsWith('.mp4'))
    first()
    expect(registry.accepts(new File(['x'], 'clip.mp4'))).toBe(true)
    second()
    expect(registry.accepts(new File(['x'], 'clip.mp4'))).toBe(false)
  })

  it('rejects empty ids and keeps a replacement after clearing an older registration', () => {
    const registry = new NativeFileUploadPolicies()
    const accepts = (file: File): boolean => file.name.endsWith('.docx')
    expect(() => registry.register('  ', accepts)).toThrow('id must not be empty')
    const disposeOld = registry.register('office', accepts)
    registry.clear()
    registry.register('office', accepts)
    disposeOld()
    expect(registry.accepts(new File(['doc'], 'report.docx'))).toBe(true)
  })
})
