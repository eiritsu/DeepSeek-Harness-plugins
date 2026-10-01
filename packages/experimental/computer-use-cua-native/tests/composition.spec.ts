import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

describe('dsh-experimental-computer-use-cua-native bundle', () => {
  it('adds only the official computer-use service and native provider', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const hostConfig = ts.readConfigFile(resolve(root, '../../..', 'tsconfig.host.json'), file => ts.sys.readFile(file)).config as {
      references?: Array<{ path?: string }>
    }
    expect(hostConfig.references?.map(reference => reference.path)).toContain('./packages/experimental/computer-use-cua-native')
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dependencies).toEqual({
      '@deepseek-ai/dsh-computer-use': 'workspace:*',
      '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native': 'workspace:*',
    })
    const patches = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    ) as Array<{ insert?: Array<{ id?: string; name?: string }> }>
    expect(patches.flatMap(patch => patch.insert ?? [])).toEqual([
      { id: 'computer-use', name: '@deepseek-ai/dsh-computer-use' },
      { id: 'computer-use-cua-driver-native', name: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native' },
    ])
  })
})
