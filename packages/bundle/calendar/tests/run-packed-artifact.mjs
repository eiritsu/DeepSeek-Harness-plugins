/**
 * Built-artifact smoke for the calendar bundle.
 *
 * This runs the published shape of the package: it imports only built entries,
 * boots one composed profile through the real Loader, and asserts that the Host
 * row activates, that the generated Remote descriptor carries every method the
 * Client calls, and that disabling the row runs the disposer. Nothing here
 * resolves through the repository's TypeScript paths.
 *
 * Run it with the package build in place:
 *   pnpm --filter @deepseek-ai/dsh-calendar run test:packed-artifact
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../../..')
/** Base-bundle runtimes resolve the way a profile resolves them. */
const baseRequire = createRequire(join(repositoryRoot, 'packages/bundle/base/package.json'))
/** The Loader belongs to app-boot, which owns the configuration tree. */
const appBootRequire = createRequire(join(repositoryRoot, 'packages/boot/app-boot/package.json'))

/** Every built entry the installed package ships. */
const REQUIRED = [
  'lib/index.js',
  'lib/typert.host.js',
  'lib/typert.host.d.ts',
  'lib/typert.remote-client.js',
  'lib/typert.remote-client.d.ts',
  'cordis.patch.yml',
]

/** Remote methods the calendar Client calls. */
const REMOTE_METHODS = [
  'snapshot', 'createTask', 'updateTask', 'deleteTask', 'saveEntry', 'deleteEntry',
  'addSubscription', 'updateSubscription', 'deleteSubscription', 'refreshSubscription',
  'importIcs', 'deleteImported', 'listSubscriptions', 'watch',
]

/**
 * Assert one condition the caller can read in a failure.
 * @param condition - What must hold.
 * @param message - What a failure reports.
 * @returns nothing; it throws when the condition does not hold.
 */
function check(condition, message) {
  if (!condition) throw new Error(message)
}

async function main() {
  for (const artifact of REQUIRED) {
    check(existsSync(join(packageRoot, artifact)), `missing built artifact ${artifact}; run the package build first`)
  }
  const descriptor = readFileSync(join(packageRoot, 'lib/typert.host.js'), 'utf8')
  for (const method of REMOTE_METHODS) {
    check(descriptor.includes(`calendar/${method}`), `generated Remote descriptor is missing calendar/${method}`)
  }
  check(
    readFileSync(join(packageRoot, 'lib/typert.remote-client.js'), 'utf8').includes('@deepseek-ai/dsh-calendar'),
    'the generated remote client does not carry this package identity',
  )

  const { Context } = await import(baseRequire.resolve('@deepseek-ai/cordis'))
  const { default: Loader } = await import(appBootRequire.resolve('@deepseek-ai/cordis-plugin-loader'))
  const { default: SessionStore } = await import(baseRequire.resolve('@deepseek-ai/dsh-session'))
  const { default: Storage } = await import(baseRequire.resolve('@deepseek-ai/dsh-storage'))
  const { default: TypertRegistry } = await import(baseRequire.resolve('@deepseek-ai/dsh-typert-registry'))
  const typertLoader = await import(baseRequire.resolve('@deepseek-ai/dsh-typert-loader'))

  const home = mkdtempSync(join(tmpdir(), 'dsh-calendar-smoke-'))
  const ctx = new Context()
  try {
    ctx.baseUrl = new URL('./package/', `file://${packageRoot}/`).href
    await ctx.plugin(TypertRegistry)
    await ctx.plugin(Loader)
    await ctx.plugin(SessionStore)
    await ctx.plugin(Storage)
    // One profile: the storage rows a Harness home always composes, then this
    // bundle's own row resolved from the built entry the package ships.
    await ctx.loader.create({ name: '@deepseek-ai/dsh-storage-json', config: { root: join(home, 'storages') } })
    await ctx.loader.create({ name: '@deepseek-ai/dsh-storage-domain', config: { backend: 'json' } })
    const entryId = await ctx.loader.create({ name: '@deepseek-ai/dsh-calendar', config: {} })
    await ctx.loader.await()
    await ctx.plugin({ inject: typertLoader.inject, apply: typertLoader.apply }, {})

    const service = ctx.get('calendar')
    check(service !== undefined, 'the calendar row did not activate from its shipped patch')
    const now = Date.now()
    const snapshot = await service.snapshot({
      rangeStart: new Date(now - 86_400_000).toISOString(),
      rangeEnd: new Date(now + 86_400_000).toISOString(),
    })
    // No Schedule row in this profile, so the page mounts and reports that
    // automations are unavailable instead of failing to start.
    check(snapshot.serviceAvailable === false, 'a profile without the Schedule row must report serviceAvailable false')
    check(typeof snapshot.hostTimeZone === 'string' && snapshot.hostTimeZone !== '', 'the snapshot carries no Host zone')
    check(Array.isArray(snapshot.entries), 'the snapshot carries no entries')
    console.log('packed Host entry loaded; Remote descriptor lists', REMOTE_METHODS.length, 'methods')

    await ctx.loader.update(entryId, { disabled: true })
    await ctx.loader.await()
    check(ctx.get('calendar') === undefined, 'the calendar service outlived its disabled row')
  } finally {
    await ctx.fiber.dispose()
    rmSync(home, { recursive: true, force: true })
  }
}

await main()
