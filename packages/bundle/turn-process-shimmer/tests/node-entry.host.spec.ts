import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

describe('Turn process shimmer Node entry', () => {
  it('exports a Host plugin body for Loader activation', () => {
    expect(apply).toBeTypeOf('function')
  })
})
