import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../../..')
const npmExecPath = process.env.npm_execpath

if (npmExecPath === undefined || npmExecPath === '') {
  throw new Error('Run the Lark packed-artifact smoke through `pnpm --filter @deepseek-ai/dsh-lark-integration run test:packed-artifact`')
}

const vitest = resolve(repositoryRoot, 'node_modules/vitest/vitest.mjs')
const result = spawnSync(process.execPath, [vitest, 'run', 'packages/bundle/lark-integration/tests/packed-artifact.host.spec.ts'], {
  cwd: repositoryRoot,
  env: { ...process.env, DSH_LARK_PACKED_ARTIFACT: '1' },
  stdio: 'inherit',
})

if (result.error !== undefined) throw result.error
if (result.status === null) throw new Error('Vitest did not exit normally')
process.exitCode = result.status
