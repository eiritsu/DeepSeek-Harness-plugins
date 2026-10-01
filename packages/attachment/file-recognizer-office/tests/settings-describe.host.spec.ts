import { describe, expect, it } from 'vitest'
import { configurationFixture } from '../../../settings/settings/tests/configuration-fixture.ts'
import { apply, Config, name } from '../src/index.ts'

describe('Office Settings Host descriptor', () => {
  it('serves every volatile Office Config field under the Loader entry id', async () => {
    const host = await configurationFixture({
      schema: Config,
      entryId: name,
      apply: (ctx, config) => { apply(ctx, config as Config) },
    })
    const descriptor = host.ctx.settings.describe({ redactSecrets: true }).find(row => row.ns === name)

    expect(descriptor).toMatchObject({ ns: name, applies: 'live' })
    const serialized = JSON.stringify(descriptor?.schema)
    expect([
      'maxInputBytes', 'maxUncompressedBytes', 'maxZipEntries', 'maxExtractedChars', 'maxPdfPages',
      'maxPdfPagePixels', 'maxPdfRenderScale', 'ocrEndpoint', 'ocrModel', 'audioEndpoint', 'audioModel',
      'videoEndpoint', 'videoModel',
    ].every(field => serialized?.includes(`\"${field}\"`))).toBe(true)

    await host.ctx.fiber.dispose()
  })
})
