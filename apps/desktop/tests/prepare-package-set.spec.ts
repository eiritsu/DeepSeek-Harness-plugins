import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  assertDesktopHostPackageFiles,
  assertDesktopBundlePackageFiles,
  selectDesktopPackageClosure,
  type PackedDesktopPackage,
} from '../scripts/prepare-package-set.ts'

function packed(name: string, manifest: Record<string, unknown> = {}): PackedDesktopPackage {
  return { tarball: `${name}.tgz`, manifest: { name, version: '1.0.0', ...manifest } }
}

describe('desktop package-set selection', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('does not select a packaging target when imported as a library', async () => {
    vi.stubEnv('DSH_DESKTOP_TARGET_PLATFORM', 'linux')
    vi.stubEnv('DSH_DESKTOP_TARGET_ARCH', 'x64')
    vi.resetModules()
    await expect(import('../scripts/prepare-package-set.ts')).resolves.toHaveProperty('prepareDesktopPackageSet')
  })

  it('includes only the available internal production closure', () => {
    const available = new Map<string, PackedDesktopPackage>([
      ['@deepseek-ai/dsh', packed('@deepseek-ai/dsh', {
        dependencies: { '@deepseek-ai/dsh-base': '^1.0.0', external: '^2.0.0' },
        optionalDependencies: { '@deepseek-ai/platform-package': '1.0.0', '@deepseek-ai/missing-platform': '1.0.0' },
      })],
      ['@deepseek-ai/dsh-desktop-host', packed('@deepseek-ai/dsh-desktop-host', {
        dependencies: { '@deepseek-ai/dsh': '^1.0.0' },
      })],
      ['@deepseek-ai/dsh-base', packed('@deepseek-ai/dsh-base', {
        peerDependencies: { '@deepseek-ai/cordis': '^1.0.0' },
      })],
      ['@deepseek-ai/cordis', packed('@deepseek-ai/cordis')],
      ['@deepseek-ai/platform-package', packed('@deepseek-ai/platform-package')],
      ['@deepseek-ai/unused', packed('@deepseek-ai/unused')],
    ])
    expect(selectDesktopPackageClosure(available).map(entry => entry.manifest.name)).toEqual([
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh',
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-desktop-host',
      '@deepseek-ai/platform-package',
    ])
  })

  it('leaves independent plugins to external profile installation', () => {
    const root = resolve(import.meta.dirname, '../../..')
    const manifest = JSON.parse(readFileSync(resolve(root, 'apps/cli/package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    const independentPackages = [
      '@deepseek-ai/dsh-file-recognizer-office',
      '@deepseek-ai/dsh-community-plugin-catalog',
      '@deepseek-ai/dsh-lark-integration',
      '@deepseek-ai/dsh-tools-connections',
      '@deepseek-ai/dsh-community-skill-catalog',
      '@deepseek-ai/dsh-file-recognizer-office',
      '@deepseek-ai/dsh-model-catalog',
      '@deepseek-ai/dsh-copy-session-id',
      '@deepseek-ai/dsh-turn-process-shimmer',
      '@deepseek-ai/dsh-session-archive',
      '@deepseek-ai/dsh-experimental-computer-use-cua-native',
    ]
    for (const name of independentPackages) expect(manifest.dependencies).not.toHaveProperty(name)
  })

  it('copies official optional bundle roots into the local package set closure', () => {
    const names = ['@deepseek-ai/dsh-experimental-voice-input-bundle']
    const available = new Map<string, PackedDesktopPackage>([
      ['@deepseek-ai/dsh', packed('@deepseek-ai/dsh', { dependencies: Object.fromEntries(names.map(name => [name, 'workspace:*'])) })],
      ['@deepseek-ai/dsh-desktop-host', packed('@deepseek-ai/dsh-desktop-host', { dependencies: { '@deepseek-ai/dsh': '^1.0.0' } })],
      ...names.map(name => [name, packed(name)] as const),
    ])
    expect(selectDesktopPackageClosure(available).map(entry => entry.manifest.name)).toEqual([
      '@deepseek-ai/dsh', ...names, '@deepseek-ai/dsh-desktop-host',
    ].sort((left, right) => left.localeCompare(right)))
  })

  it.each([
    '@deepseek-ai/dsh-base', '@deepseek-ai/cordis', '@deepseek-ai/node-addon-system',
  ])('rejects required prepared package %s absent from the packed release inputs', (dependency) => {
    const available = new Map<string, PackedDesktopPackage>([
      ['@deepseek-ai/dsh', packed('@deepseek-ai/dsh', {
        dependencies: { [dependency]: '^1.0.0' },
      })],
      ['@deepseek-ai/dsh-desktop-host', packed('@deepseek-ai/dsh-desktop-host', {
        dependencies: { '@deepseek-ai/dsh': '^1.0.0' },
      })],
    ])
    expect(() => selectDesktopPackageClosure(available)).toThrow(/unpacked package/u)
    expect(() => selectDesktopPackageClosure(new Map([
      ['@deepseek-ai/dsh', packed('@deepseek-ai/dsh')],
    ]))).toThrow(/omit @deepseek-ai\/dsh-desktop-host/u)
  })

  it('leaves independently published Office packages to npm resolution', () => {
    const available = new Map<string, PackedDesktopPackage>([
      ['@deepseek-ai/dsh', packed('@deepseek-ai/dsh', {
        dependencies: {
          '@deepseek-ai/libreoffice-kit': '0.0.1',
          '@deepseek-ai/libreoffice-kit-wasm': '0.0.1',
        },
      })],
      ['@deepseek-ai/dsh-desktop-host', packed('@deepseek-ai/dsh-desktop-host')],
    ])
    expect(selectDesktopPackageClosure(available).map(entry => entry.manifest.name)).toEqual([
      '@deepseek-ai/dsh', '@deepseek-ai/dsh-desktop-host',
    ])
  })

  it('keeps opt-in CUA composition and provider packages out of the Desktop CLI roots', () => {
    const root = resolve(import.meta.dirname, '../../..')
    const manifest = JSON.parse(readFileSync(resolve(root, 'apps/cli/package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    expect(manifest.dependencies).not.toHaveProperty('@deepseek-ai/dsh-experimental-computer-use-cua-native')
    expect(manifest.dependencies).not.toHaveProperty('@deepseek-ai/dsh-experimental-computer-use-cua-driver-native')
    expect(manifest.dependencies).not.toHaveProperty('@deepseek-ai/dsh-computer-use')
    expect(manifest.dependencies).not.toHaveProperty('@trycua/cua-driver')
  })

  it('requires both Desktop Host and public CLI entries', () => {
    const files = [
      'package/lib/index.js',
      'package/lib/cli.js',
    ]
    expect(() => {
      assertDesktopHostPackageFiles(files)
    }).not.toThrow()
    expect(() => {
      assertDesktopHostPackageFiles(files.slice(1))
    }).toThrow(/lib\/index\.js/u)
    expect(() => { assertDesktopHostPackageFiles(files.slice(0, 1)) }).toThrow(/lib\/cli\.js/u)
  })

  it('requires bundle runtime entries and patch files from the packed archive', () => {
    const manifest = { name: '@deepseek-ai/dsh-tools-connections', main: './lib/index.js',
      dsh: { bundle: { patch: './cordis.patch.yml' } } }
    expect(() => {
      assertDesktopBundlePackageFiles(manifest.name, manifest, ['package/lib/index.js', 'package/cordis.patch.yml'])
    }).not.toThrow()
    expect(() => {
      assertDesktopBundlePackageFiles(manifest.name, manifest, ['package/cordis.patch.yml'])
    }).toThrow(/lib\/index\.js/u)
  })
})
