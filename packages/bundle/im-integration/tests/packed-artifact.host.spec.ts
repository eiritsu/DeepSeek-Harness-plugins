import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { pnpmInvocation } from '../../../../scripts/pnpm-invocation.ts'

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

describe('IM integration packed runtime', () => {
  it('ships the verifier scripts and no CLI executable', { timeout: 120_000 }, () => {
    const destination = mkdtempSync(join(tmpdir(), 'dsh-im-pack-'))
    try {
      const invocation = process.env.npm_execpath
        ? pnpmInvocation(['pack', '--pack-destination', destination])
        : { command: 'pnpm', args: ['pack', '--pack-destination', destination] }
      execFileSync(invocation.command, invocation.args, { cwd: packageRoot, stdio: 'pipe', timeout: 60_000 })
      const archives = readdirSync(destination).filter(name => name.endsWith('.tgz'))
      expect(archives).toHaveLength(1)
      const archive = join(destination, archives[0]!)
      const names = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n')
      for (const entry of [
        'package/scripts/vendor/install.cjs',
        'package/scripts/vendor/run.cjs',
        'package/scripts/vendor/manifest.json',
        'package/scripts/vendor/lark/run.cjs',
        'package/scripts/vendor/wecom/run.cjs',
        'package/scripts/vendor/dingtalk/run.cjs',
        'package/THIRD_PARTY_NOTICES.md',
      ]) {
        expect(names, `missing ${entry}`).toContain(entry)
      }
      expect(names.some(name => /\/(lark-cli|wecom-cli|dws)(\.exe)?$/.test(name))).toBe(false)
      const listing = execFileSync('tar', ['-tvzf', archive], { encoding: 'utf8' }).trim().split('\n')
      for (const line of listing) {
        const mode = line.slice(0, 10)
        if (mode.startsWith('-') && mode.includes('x')) {
          throw new Error(`packed file is executable: ${line}`)
        }
      }
    } finally {
      rmSync(destination, { recursive: true, force: true })
    }
  })
})
