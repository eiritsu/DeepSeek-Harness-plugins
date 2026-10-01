/** Boot the materialized target runtime without access to a user's Harness profile. */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { readPrimaryRuntime, workspaceDependencyPaths } from '../../../packages/skill/tool-workspace-dependencies/src/index.ts'
import { DesktopHostProcess } from '../src/host-process.ts'
import { createPluginProfile } from '../src/project-manager.ts'
import { runtimeArchivePath } from '../../desktop-host/src/office-engine.ts'

const INDEPENDENT_PLUGIN_BUNDLES = [
  '@deepseek-ai/dsh-file-recognizer-office',
  '@deepseek-ai/dsh-community-plugin-catalog',
  '@deepseek-ai/dsh-community-skill-catalog',
  '@deepseek-ai/dsh-lark-integration',
  '@deepseek-ai/dsh-model-catalog',
  '@deepseek-ai/dsh-copy-session-id',
  '@deepseek-ai/dsh-turn-process-shimmer',
  '@deepseek-ai/dsh-session-archive',
  '@deepseek-ai/dsh-experimental-computer-use-cua-native',
] as const

const REQUIRED_WEB_BOOT_ENTRIES = [
  '@deepseek-ai/dsh-api-session-controller',
  '@deepseek-ai/dsh-client-ui-session',
  '@deepseek-ai/dsh-client-ui-workspace',
] as const

/** Official optional bundle used to verify profile selection and Host activation. */
export const DESKTOP_OPTIONAL_BUNDLE_SMOKE = '@deepseek-ai/dsh-experimental-voice-input-bundle'
/** Host fibers contributed by the official voice-input bundle. */
export const DESKTOP_OPTIONAL_BUNDLE_HOST_MODULES = {
  [DESKTOP_OPTIONAL_BUNDLE_SMOKE]: [
    '@deepseek-ai/dsh-experimental-speech-to-text',
    '@deepseek-ai/dsh-experimental-speech-to-text-sensevoice',
    '@deepseek-ai/dsh-experimental-api-speech-to-text',
  ],
} as const

/** Require the packaged Host's Web injection graph to include the session UI providers. */
export function assertDesktopWebBootGraph(injections: readonly unknown[] | undefined): void {
  const boot = injections?.find((injection) => {
    if (injection === null || typeof injection !== 'object') return false
    const record = injection as Record<string, unknown>
    return record.kind === 'global' && record.name === '__DSH_BOOT__'
  })
  if (boot === undefined || typeof boot !== 'object') {
    throw new Error('desktop runtime: Host omitted the Web boot graph')
  }
  const value = (boot as Record<string, unknown>).value
  if (value === null || typeof value !== 'object' || !Array.isArray((value as Record<string, unknown>).entries)) {
    throw new Error('desktop runtime: Host supplied an invalid Web boot graph')
  }
  const entries = (value as { entries: unknown[] }).entries
  const ids = new Set(entries.flatMap((entry) => {
    if (entry === null || typeof entry !== 'object' || typeof (entry as Record<string, unknown>).id !== 'string') return []
    return [(entry as { id: string }).id]
  }))
  const missing = REQUIRED_WEB_BOOT_ENTRIES.filter(id => !ids.has(id))
  if (missing.length > 0) {
    throw new Error(`desktop runtime: Web boot graph omits ${missing.join(', ')}`)
  }
}

/** Require that the Desktop installation does not advertise independently installed plugins. */
export function assertDesktopOptionalBundles(value: unknown): void {
  if (!Array.isArray(value)) throw new Error('desktop runtime: Plugin Manager returned no optional bundle list')
  const names = new Set(value.flatMap((bundle) => {
    if (bundle === null || typeof bundle !== 'object' || typeof (bundle as Record<string, unknown>).name !== 'string') return []
    return [(bundle as { name: string }).name]
  }))
  const advertised = INDEPENDENT_PLUGIN_BUNDLES.filter(name => names.has(name))
  if (advertised.length > 0) throw new Error(`desktop runtime: independent plugins are in-box: ${advertised.join(', ')}`)
}

/** Require that clean Desktop defaults do not activate independent plugins. */
export function assertDesktopNoIndependentPlugins(value: unknown): void {
  if (!Array.isArray(value)) throw new Error('desktop runtime: Plugin Manager returned no plugin rows')
  const active = value.flatMap((candidate) => {
    if (candidate === null || typeof candidate !== 'object') return []
    const row = candidate as Record<string, unknown>
    return row.enabled === true && typeof row.moduleName === 'string' && INDEPENDENT_PLUGIN_BUNDLES.includes(row.moduleName as typeof INDEPENDENT_PLUGIN_BUNDLES[number])
      ? [row.moduleName]
      : []
  })
  if (active.length > 0) throw new Error(`desktop runtime: clean defaults activated independent plugins: ${active.join(', ')}`)
}

/** Require model-catalog activation only when a fixture explicitly installs and enables it. */
export function assertDesktopExternalModelCatalogActive(value: unknown): void {
  if (value === null || typeof value !== 'object') throw new Error('desktop runtime: invalid external catalog fixture')
  const fixture = value as Record<string, unknown>
  if (!Array.isArray(fixture.bundles) || !Array.isArray(fixture.plugins)) {
    throw new Error('desktop runtime: external catalog fixture omitted its installed bundle or Host rows')
  }
  const bundle = fixture.bundles.find(candidate => candidate !== null && typeof candidate === 'object'
    && (candidate as Record<string, unknown>).name === '@deepseek-ai/dsh-model-catalog') as Record<string, unknown> | undefined
  const plugin = fixture.plugins.find(candidate => candidate !== null && typeof candidate === 'object'
    && (candidate as Record<string, unknown>).moduleName === '@deepseek-ai/dsh-model-catalog') as Record<string, unknown> | undefined
  if (bundle?.installed !== true || bundle.enabled !== true || plugin?.enabled !== true || plugin.fiberPhase !== 'active') {
    throw new Error('desktop runtime: explicitly installed model-catalog did not activate')
  }
}

/** Validate the unmodified Desktop profile against independently installed plugin defaults. */
export function assertDesktopCleanBaseline(value: unknown): void {
  if (value === null || typeof value !== 'object') throw new Error('desktop runtime: invalid clean-baseline inventory')
  const inventory = value as Record<string, unknown>
  assertDesktopNoIndependentPlugins(inventory.plugins)
  assertDesktopOptionalBundles(inventory.bundles)
}

/**
 * Check Host startup, its matching frontend, external plugins and real Office-to-PDF conversion.
 * @param root - Materialized dsh resources.
 * @param node - Prepared target Electron executable.
 * @param environment - Credential-scrubbed build environment and private native cache.
 * @param resourcesRuntime - Bundled interpreters outside the application archive.
 * @returns Resolves after checks and teardown; rejects on a check or teardown failure.
 */
export async function smokeDesktopRuntime(
  root: string, node: string, environment: NodeJS.ProcessEnv, resourcesRuntime: string,
): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-smoke-'))
  const profile = join(home, 'profiles', 'desktop')
  const createHost = (): DesktopHostProcess => new DesktopHostProcess(node, root, profile, undefined,
    { ...environment, DSH_HOME: home }, undefined, join(resourcesRuntime, 'primary-runtime'),
    { pnpm: join(resourcesRuntime, 'pnpm', 'bin', 'pnpm.cjs'), nodeBin: join(resourcesRuntime, 'bin') })
  let host = createHost()
  let timer: ReturnType<typeof setTimeout> | undefined
  const startHost = async () => {
    try {
      return await Promise.race([host.start(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reject(new Error('desktop runtime: Host readiness exceeded 120 seconds')) }, 120_000)
      })])
    } finally {
      clearTimeout(timer)
    }
  }
  const cookieFor = async (url: string): Promise<string> => {
    const login = await fetch(url, { redirect: 'manual' })
    return login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  }
  try {
    createPluginProfile(profile)
    const pluginName = 'desktop-runtime-smoke-plugin'
    const plugin = join(profile, 'node_modules', pluginName)
    mkdirSync(plugin, { recursive: true })
    const primary = join(resourcesRuntime, 'primary-runtime')
    const dependencies = workspaceDependencyPaths(primary, await readPrimaryRuntime(primary))
    await promisify(execFile)(dependencies.python, ['-I', '-B',
      fileURLToPath(new URL('../tests/fixtures/office-conversion-inputs.py', import.meta.url)), home],
    { env: environment, timeout: 120_000, windowsHide: true })
    const inputs = ['docx', 'xlsx', 'pptx'].map(extension => ({ extension,
      bytes: readFileSync(join(home, `input.${extension}`)).toString('base64') }))
    writeFileSync(join(plugin, 'package.json'), JSON.stringify({
      name: pluginName, version: '1.0.0', type: 'module', exports: './index.js',
      dsh: { bundle: { patch: './bundle.yml' } },
    }))
    writeFileSync(join(plugin, 'index.js'), String.raw`
import { inspect } from 'node:util'
export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/desktop-smoke',
    handler(_request, response) { response.end('plugin route ready') } }))
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/desktop-smoke-baseline',
    async handler(_request, response) {
      try {
        if (ctx.pluginManager === undefined) throw new Error('Plugin Manager service is not mounted')
        response.end(JSON.stringify({
          plugins: await ctx.pluginManager.listPlugins(),
          bundles: await ctx.pluginManager.listBundles(),
        }))
      } catch (error) {
        response.statusCode = 500
        response.end(error instanceof Error ? error.message : 'unknown failure')
      }
    } }))
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/desktop-smoke-optional-packages',
    async handler(request, response) {
      const redact = value => String(value)
        .replace(/Bearer\s+\S+/giu, 'Bearer [redacted]')
        .replace(/\b(api[_-]?key|token|secret)\b\s*[:=]\s*\S+/giu, '$1=[redacted]')
        .replace(/\b[A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|SECRET)\s*[:=]\s*\S+/giu, '[redacted]')
        .replace(/\b(?:sk|fc)-[A-Za-z0-9_-]{12,}\b/giu, '[redacted]')
        .replace(/(?:\/(?:Users|private|tmp)\/|[A-Z]:\\)[^\s"'<>]*/gu, '[path]').slice(0, 500)
      try {
        const summarize = result => ({
          application: result.application,
          changed: result.changed,
          stage: result.stage,
          target: result.target,
          error: result.error === undefined ? undefined : {
            code: result.error.code,
            diagnostic: result.error.diagnostic === undefined ? undefined : redact(result.error.diagnostic),
          },
        })
        if (ctx.pluginManager === undefined) throw new Error('Plugin Manager service is not mounted')
        const names = ${JSON.stringify([DESKTOP_OPTIONAL_BUNDLE_SMOKE])}
        const hostModules = ${JSON.stringify(DESKTOP_OPTIONAL_BUNDLE_HOST_MODULES)}
        const mode = new URL(request.url, 'http://localhost').searchParams.get('mode')
        if (mode === 'enable') {
          const results = []
          for (const name of names) {
            const selected = (await ctx.pluginManager.listBundles()).find(bundle => bundle.name === name)
            if (selected?.installed !== false || selected.enabled !== false) {
              throw new Error(name + ' was not available as an unselected installation package')
            }
            const result = await ctx.pluginManager.setBundleEnabled(name, true)
            results.push(summarize(result))
            if (result.error !== undefined || !['applied', 'restart-required'].includes(result.application)) {
              throw new Error('Plugin Manager enable result: ' + JSON.stringify(summarize(result)))
            }
          }
          response.end(JSON.stringify({ results }))
        } else if (mode === 'verify-enabled-disable') {
          const bundles = await ctx.pluginManager.listBundles()
          const activeRows = await ctx.pluginManager.listPlugins()
          for (const name of names) {
            const bundle = bundles.find(candidate => candidate.name === name)
            const expectedModules = hostModules[name] ?? [name]
            const missing = expectedModules.flatMap(moduleName => {
              const row = activeRows.find(candidate => candidate.moduleName === moduleName)
              return row?.enabled === true && row.fiberPhase === 'active' ? [] : [{
                moduleName, enabled: row?.enabled, fiberPhase: row?.fiberPhase,
              }]
            })
            if (bundle?.enabled !== true || missing.length > 0) {
              throw new Error('Plugin Manager did not mount ' + name + ': ' + JSON.stringify({
                bundleEnabled: bundle?.enabled, missing,
              }))
            }
          }
          const results = []
          for (const name of names) {
            const result = await ctx.pluginManager.setBundleEnabled(name, false)
            results.push(summarize(result))
            if (result.error !== undefined || !['applied', 'restart-required'].includes(result.application)) {
              throw new Error('Plugin Manager disable result: ' + JSON.stringify(summarize(result)))
            }
          }
          response.end(JSON.stringify({ results }))
        } else if (mode === 'verify-disabled') {
          const bundles = await ctx.pluginManager.listBundles()
          const missing = names.filter(name => {
            const bundle = bundles.find(candidate => candidate.name === name)
            return bundle === undefined || bundle.installed !== false || bundle.enabled !== false
          })
          if (missing.length > 0) throw new Error('Optional packages did not return to disabled state: ' + missing.join(', '))
          response.end(JSON.stringify(bundles))
        } else {
          throw new Error('unsupported optional-package smoke mode')
        }
      } catch (error) {
        response.statusCode = 500
        response.end(JSON.stringify({ error: redact(error instanceof Error ? error.message : 'unknown failure') }))
      }
    } }))
  for (const input of ${JSON.stringify(inputs)}) {
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/desktop-smoke-office/' + input.extension,
      async handler(_request, response) {
        try {
          const bytes = Buffer.from(input.bytes, 'base64')
          const result = await ctx.officeToPdf.convert({ extension: input.extension, priority: 'foreground',
            source: { key: 'desktop-smoke-' + input.extension, version: 'fixture', bytes: bytes.length,
              async read() { return { bytes, version: 'fixture' } } } })
          response.end(Buffer.from(result.pdf))
        } catch (error) {
          response.statusCode = 500
          response.end(inspect(error, { depth: 5 }))
        }
      } }))
  }
}
`)
    await promisify(execFile)(process.execPath, ['--check', join(plugin, 'index.js')], { timeout: 10_000, windowsHide: true })
    writeFileSync(join(plugin, 'bundle.yml'), '- insert:\n    - id: desktop-runtime-smoke-plugin\n      name: desktop-runtime-smoke-plugin\n      inject: [webServer, officeToPdf, pluginManager]\n')
    const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      dsh: { profile: { bundles: string[] } }
    }
    manifest.dependencies[pluginName] = '1.0.0'
    manifest.dsh.profile.bundles.push(pluginName)
    writeFileSync(join(profile, 'package.json'), JSON.stringify(manifest))
    const profilePath = join(profile, 'cordis.patch.yml')
    writeFileSync(profilePath, '- id: webserver\n  config:\n    host: 127.0.0.1\n    port: 0\n')
    const writtenManifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      dsh: { profile: { bundles: string[] } }
    }
    const patch = readFileSync(profilePath, 'utf8')
    if (writtenManifest.dependencies[pluginName] !== '1.0.0' || !writtenManifest.dsh.profile.bundles.includes(pluginName)
      || !readFileSync(join(plugin, 'bundle.yml'), 'utf8').includes(`name: ${pluginName}`)
      || !patch.includes('id: webserver')) {
      throw new Error('desktop runtime: temporary smoke profile was not materialized')
    }
    let ready = await startHost()
    assertDesktopWebBootGraph(ready.injections)
    let cookie = await cookieFor(ready.url)
    const assertCleanBaseline = async () => {
      const baseline = await fetch(new URL('/desktop-smoke-baseline', ready.url), { headers: { cookie } })
      if (!baseline.ok) throw new Error(`desktop runtime: clean-baseline diagnostics failed: ${await baseline.text()}`)
      assertDesktopCleanBaseline(await baseline.json())
    }
    const requestOptional = async (mode: string): Promise<Response> => fetch(
      new URL(`/desktop-smoke-optional-packages?mode=${mode}`, ready.url), { headers: { cookie } },
    )
    await assertCleanBaseline()
    const response = await fetch(new URL('/', ready.url), { headers: { cookie } })
    if (response.status !== 200 || !(await response.text()).includes('<html')) {
      throw new Error('desktop runtime: packaged frontend smoke failed')
    }
    const pluginResponse = await fetch(new URL('/desktop-smoke', ready.url), { headers: { cookie } })
    const pluginBody = await pluginResponse.text()
    if (pluginResponse.status !== 200 || pluginBody !== 'plugin route ready') {
      throw new Error(`desktop runtime: plugin HTTP route failed (status ${pluginResponse.status}): ${pluginBody.slice(0, 300)}`)
    }
    const enabledResponse = await requestOptional('enable')
    if (!enabledResponse.ok) throw new Error(`desktop runtime: optional package management failed (status ${enabledResponse.status}): ${await enabledResponse.text()}`)
    const enabledResult = await enabledResponse.json() as { results: Array<{ application: string }> }
    if (enabledResult.results.some(result => result.application === 'restart-required')) {
      await host.stop()
      host = createHost()
      ready = await startHost()
      cookie = await cookieFor(ready.url)
      assertDesktopWebBootGraph(ready.injections)
      await assertCleanBaseline()
    }
    const disableResponse = await requestOptional('verify-enabled-disable')
    if (!disableResponse.ok) throw new Error(`desktop runtime: optional bundle mount failed: ${await disableResponse.text()}`)
    const disableResult = await disableResponse.json() as { results: Array<{ application: string }> }
    if (disableResult.results.some(result => result.application === 'restart-required')) {
      await host.stop()
      host = createHost()
      ready = await startHost()
      cookie = await cookieFor(ready.url)
      assertDesktopWebBootGraph(ready.injections)
      await assertCleanBaseline()
    }
    const disabledResponse = await requestOptional('verify-disabled')
    if (!disabledResponse.ok) throw new Error(`desktop runtime: optional bundle disable failed: ${await disabledResponse.text()}`)
    assertDesktopOptionalBundles(await disabledResponse.json())
    for (const { extension } of inputs) {
      const converted = await fetch(new URL(`/desktop-smoke-office/${extension}`, ready.url), {
        headers: { cookie }, signal: AbortSignal.timeout(120_000),
      })
      if (!converted.ok) throw new Error(`desktop runtime: ${extension} conversion failed: ${await converted.text()}`)
      const pdf = Buffer.from(await converted.arrayBuffer())
      if (!/^%PDF-\d\.\d/u.test(pdf.subarray(0, 8).toString())
        || !pdf.subarray(-1024).toString().trimEnd().endsWith('%%EOF')) {
        throw new Error(`desktop runtime: invalid ${extension} PDF output`)
      }
    }
    if (runtimeArchivePath(root) === undefined) {
      if (dependencies.node === undefined) throw new Error('desktop runtime: primary runtime did not include Node.js')
      const cli = join(root, 'node_modules', '@deepseek-ai', 'libreoffice-kit', 'lib', 'cli.js')
      if (!existsSync(cli)) throw new Error('desktop runtime: Office CLI is missing from the prepared app')
      const cliOptions = { cwd: home, env: { ...environment, PATH: '' }, timeout: 120_000, windowsHide: true }
      const capabilities = await promisify(execFile)(dependencies.node, [cli, 'capabilities'], cliOptions)
      const cliOutput = join(home, 'cli.pdf')
      await promisify(execFile)(dependencies.node, [cli, 'convert', '--input', join(home, 'input.docx'), '--output', cliOutput], cliOptions)
      const cliPdf = readFileSync(cliOutput)
      const cliPath = (JSON.parse(capabilities.stdout) as { runtime?: { cliPath?: unknown } }).runtime?.cliPath
      if (cliPath !== cli || cliPdf.subarray(0, 5).toString() !== '%PDF-') {
        throw new Error('desktop runtime: Office CLI did not return capabilities and a PDF')
      }
    }
    console.log('desktop runtime: Web boot graph, optional package management, Office conversion and CLI passed')
  } finally {
    clearTimeout(timer)
    await host.stop()
    rmSync(home, { recursive: true, force: true })
  }
}
