import { describe, expect, it } from 'vitest'
import { parseCatalogInstall, shouldShowCatalogLoading } from '../src/client/PluginCatalogPanel.tsx'

describe('parseCatalogInstall', () => {
  it('accepts only supported registry and GitHub forms as data', () => {
    expect(parseCatalogInstall('@acme/dsh-example')).toBe('@acme/dsh-example')
    expect(parseCatalogInstall('github:acme/example#main')).toBe('github:acme/example#main')
    expect(parseCatalogInstall('https://github.com/acme/example')).toBe('https://github.com/acme/example')
    expect(parseCatalogInstall('https://github.com/acme/example/')).toBe('https://github.com/acme/example/')
    expect(parseCatalogInstall('dsh plugin --profile web add @acme/dsh-example')).toBe('@acme/dsh-example')
    expect(parseCatalogInstall('dsh plugin --profile web add --allow-build=node-gyp github:acme/example#main'))
      .toBe('github:acme/example#main')
    expect(parseCatalogInstall('dsh plugin --profile web add github:nexu-io/open-design#path:packages/dsh-runtime'))
      .toBe('github:nexu-io/open-design#path:packages/dsh-runtime')
  })

  it('rejects command text and unsupported source forms', () => {
    expect(parseCatalogInstall('npm install evil')).toBeUndefined()
    expect(parseCatalogInstall('dsh plugin --profile web add https://example.com/a/b')).toBeUndefined()
    expect(parseCatalogInstall('dsh plugin --profile web add file:/tmp/plugin')).toBeUndefined()
    expect(parseCatalogInstall('dsh plugin --profile web add github:example')).toBeUndefined()
    expect(parseCatalogInstall('npm install evil other')).toBeUndefined()
    expect(parseCatalogInstall('https://example.com/acme/example')).toBeUndefined()
    expect(parseCatalogInstall('github:acme/example extra')).toBeUndefined()
  })
})

describe('shouldShowCatalogLoading', () => {
  it('does not leave a spinner over a failed request', () => {
    expect(shouldShowCatalogLoading(false, false, true)).toBe(false)
    expect(shouldShowCatalogLoading(true, false, true)).toBe(false)
  })

  it('shows loading while a filtered page is being read', () => {
    expect(shouldShowCatalogLoading(true, true, false)).toBe(true)
    expect(shouldShowCatalogLoading(false, false, false)).toBe(true)
    expect(shouldShowCatalogLoading(false, true, false)).toBe(false)
  })
})
