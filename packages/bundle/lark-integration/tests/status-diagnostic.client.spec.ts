import { describe, expect, it } from 'vitest'
import { statusDiagnosticCode } from '../src/client/status-diagnostic.ts'

describe('Lark status stream diagnostics', () => {
  it('exposes a safe gateway code without the Remote message or details', () => {
    expect(statusDiagnosticCode({
      isDSHRemoteError: true,
      code: 'gateway/service-unavailable',
      message: 'secret-bearing diagnostic',
      details: { endpoint: 'larkStatus/watch', credential: 'hidden' },
    })).toBe('gateway/service-unavailable')
  })

  it('does not expose arbitrary codes or transport messages', () => {
    expect(statusDiagnosticCode({
      isDSHRemoteError: true,
      code: 'private-key-123',
      message: 'secret-bearing diagnostic',
    })).toBe('RemoteError')
    const error = new Error('secret-bearing diagnostic')
    error.name = 'TypeError'
    expect(statusDiagnosticCode(error)).toBe('TypeError')
    expect(statusDiagnosticCode({ name: 'secret-bearing diagnostic' })).toBe('TransportError')
  })
})
