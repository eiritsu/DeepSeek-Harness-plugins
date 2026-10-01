import { describe, expect, it } from 'vitest'
import {
  assertDesktopCleanBaseline,
  DESKTOP_OPTIONAL_BUNDLE_SMOKE,
  DESKTOP_OPTIONAL_BUNDLE_HOST_MODULES,
  assertDesktopExternalModelCatalogActive,
  assertDesktopNoIndependentPlugins,
  assertDesktopOptionalBundles,
  assertDesktopWebBootGraph,
} from '../scripts/smoke-runtime.ts'
import { OPTIONAL_BUNDLES } from '../../../packages/boot/app-boot/src/profile.ts'

const entries = [
  '@deepseek-ai/dsh-api-session-controller',
  '@deepseek-ai/dsh-client-ui-session',
  '@deepseek-ai/dsh-client-ui-workspace',
].map(id => ({ id }))

describe('Desktop Web boot smoke', () => {
  it('rejects independent plugins injected by clean Desktop defaults', () => {
    expect(() =>{  assertDesktopNoIndependentPlugins([
      { moduleName: '@deepseek-ai/dsh-api-session-controller', enabled: true, fiberPhase: 'active' },
    ]) }).not.toThrow()
    expect(() =>{  assertDesktopNoIndependentPlugins([
      { moduleName: '@deepseek-ai/dsh-model-catalog', enabled: true, fiberPhase: 'active' },
    ]) }).toThrow(/clean defaults activated independent plugins.*dsh-model-catalog/u)
  })

  it('checks bundle availability and plugin activation in a separate external-install fixture', () => {
    const externalInstall = {
      bundles: [{ name: '@deepseek-ai/dsh-model-catalog', installed: true, enabled: true }],
      plugins: [{ moduleName: '@deepseek-ai/dsh-model-catalog', enabled: true, fiberPhase: 'active' }],
    }
    expect(() =>{  assertDesktopExternalModelCatalogActive(externalInstall) }).not.toThrow()
    expect(() =>{  assertDesktopExternalModelCatalogActive({
      ...externalInstall,
      bundles: [{ name: '@deepseek-ai/dsh-model-catalog', installed: false, enabled: true }],
    }) }).toThrow(/explicitly installed model-catalog did not activate/u)
  })

  it('requires session Host and UI module rows in the injected graph', () => {
    expect(() =>{  assertDesktopWebBootGraph([{ kind: 'global', name: '__DSH_BOOT__', value: { entries } }]) }).not.toThrow()
  })

  it('rejects a graph whose session provider failed to register', () => {
    expect(() =>{  assertDesktopWebBootGraph([{ kind: 'global', name: '__DSH_BOOT__', value: { entries: [] } }]) })
      .toThrow(/dsh-api-session-controller/u)
  })

  it('rejects a missing injected boot graph', () => {
    expect(() =>{  assertDesktopWebBootGraph([]) }).toThrow(/omitted the Web boot graph/u)
  })

  it('keeps independently installed packages out of the clean baseline and bundle list', () => {
    const names = [
      '@deepseek-ai/dsh-file-recognizer-office', '@deepseek-ai/dsh-community-plugin-catalog',
      '@deepseek-ai/dsh-community-skill-catalog',
      '@deepseek-ai/dsh-lark-integration', '@deepseek-ai/dsh-model-catalog',
      '@deepseek-ai/dsh-copy-session-id', '@deepseek-ai/dsh-turn-process-shimmer',
      '@deepseek-ai/dsh-session-archive',
    ]
    const selected = new Set([
      '@deepseek-ai/dsh-file-recognizer-office', '@deepseek-ai/dsh-community-plugin-catalog',
      '@deepseek-ai/dsh-community-skill-catalog', '@deepseek-ai/dsh-model-catalog',
      '@deepseek-ai/dsh-copy-session-id', '@deepseek-ai/dsh-turn-process-shimmer',
      '@deepseek-ai/dsh-session-archive',
    ])
    const bundles = names.map(name => ({ name, installed: false, enabled: selected.has(name) }))
    expect(() =>{  assertDesktopOptionalBundles(bundles.filter(bundle => bundle.name === DESKTOP_OPTIONAL_BUNDLE_SMOKE)) }).not.toThrow()
    expect(() =>{  assertDesktopOptionalBundles(bundles) }).toThrow(/independent plugins are in-box.*dsh-file-recognizer-office/u)
    expect(() =>{  assertDesktopCleanBaseline({
      plugins: [{ moduleName: '@deepseek-ai/dsh-client-ui-session', enabled: true }],
      bundles: [{ name: '@deepseek-ai/dsh-model-catalog', installed: false, enabled: false }],
    }) }).toThrow(/independent plugins are in-box.*dsh-model-catalog/u)
    expect(() =>{  assertDesktopCleanBaseline({ plugins: [], bundles: [] }) }).not.toThrow()
  })

  it('uses an official packaged optional bundle whose Host activation does not download a model', () => {
    expect(OPTIONAL_BUNDLES).toContain(DESKTOP_OPTIONAL_BUNDLE_SMOKE)
    expect(DESKTOP_OPTIONAL_BUNDLE_HOST_MODULES[DESKTOP_OPTIONAL_BUNDLE_SMOKE]).toEqual([
      '@deepseek-ai/dsh-experimental-speech-to-text',
      '@deepseek-ai/dsh-experimental-speech-to-text-sensevoice',
      '@deepseek-ai/dsh-experimental-api-speech-to-text',
    ])
    expect(() =>{  assertDesktopOptionalBundles([{
      name: DESKTOP_OPTIONAL_BUNDLE_SMOKE, installed: false, enabled: false,
    }]) }).not.toThrow()
  })

  it('does not advertise the independently installed CUA composer as an app optional bundle', () => {
    expect(OPTIONAL_BUNDLES).not.toContain('@deepseek-ai/dsh-experimental-computer-use-cua-native')
  })
})
