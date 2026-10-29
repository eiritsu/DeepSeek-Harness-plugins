'use strict'

const crypto = require('node:crypto')
const { execFile } = require('node:child_process')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const DEFAULT_MANIFEST = path.join(__dirname, 'manifest.json')

/** @param {string | undefined} platform */
function normalizePlatform(platform) {
  if (platform === 'win32' || platform === 'windows') return 'windows'
  return platform ?? 'linux'
}

/** @param {string | undefined} arch */
function normalizeArch(arch) {
  if (arch === 'x64' || arch === 'amd64') return 'amd64'
  return arch ?? 'amd64'
}

/** @param {string} platform @param {string} arch @param {'release' | 'npm'} layout */
function assetKey(platform, arch, layout) {
  if (layout === 'npm') {
    const nodePlatform = platform === 'windows' ? 'win32' : platform
    // @wecom/cli publishes win32-x64 and no Windows ARM package. Windows on ARM
    // runs that x64 binary through the OS translator.
    const nodeArch = nodePlatform === 'win32' ? 'x64' : (arch === 'amd64' ? 'x64' : arch)
    return `${nodePlatform}-${nodeArch}`
  }
  return `${platform}-${arch}`
}

function defaultBinRoot() {
  const home = process.env.DSH_HOME && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME
    : path.join(os.homedir(), '.dsh')
  return path.join(home, 'im', 'cli-bin')
}

/** @param {string} binary @param {string} platform */
function binaryCandidates(binary, platform) {
  if (platform === 'windows') return binary.endsWith('.exe') ? [binary] : [`${binary}.exe`, binary]
  return [binary]
}

/** @param {string} version @param {{ sha256?: string, integrity?: string }} asset */
function markerFor(version, asset) {
  const hashLine = typeof asset.sha256 === 'string' ? `sha256:${asset.sha256}` : `integrity:${asset.integrity}`
  return `${version}\n${hashLine}\n`
}

/** @param {Buffer} buf @param {{ sha256?: string, integrity?: string }} asset */
function assertHash(buf, asset) {
  if (typeof asset.sha256 === 'string') {
    const actual = crypto.createHash('sha256').update(buf).digest('hex')
    if (actual !== asset.sha256) throw new Error(`cli-hash-mismatch: expected ${asset.sha256} got ${actual}`)
    return
  }
  const actual = `sha512-${crypto.createHash('sha512').update(buf).digest('base64')}`
  if (actual !== asset.integrity) throw new Error(`cli-hash-mismatch: expected ${asset.integrity} got ${actual}`)
}

/**
 * @param {string} dir
 * @param {string} version
 * @param {{ sha256?: string, integrity?: string }} asset
 * @param {readonly string[]} names
 */
async function verifiedBinary(dir, version, asset, names) {
  let marker = ''
  try {
    marker = await fs.readFile(path.join(dir, '.verified'), 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return undefined
    throw error
  }
  if (marker !== markerFor(version, asset)) return undefined
  const found = await findBinary(dir, names)
  return found
}

/** @param {string} dir @param {readonly string[]} names */
async function findBinary(dir, names) {
  const wanted = new Set(names)
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch (error) {
      if (error && error.code === 'ENOENT') continue
      throw error
    }
    for (const entry of entries) {
      if (entry.name === '.verified') continue
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (wanted.has(entry.name)) return full
    }
  }
  return undefined
}

/** @param {string} archive @param {string} dest */
function extractArchive(archive, dest) {
  const args = archive.endsWith('.zip') ? ['-xf', archive, '-C', dest] : ['-xzf', archive, '-C', dest]
  return new Promise((resolve, reject) => {
    execFile('tar', args, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

/** @param {string} url @param {Record<string, unknown>} options */
async function fetchBuffer(url, options) {
  if (typeof options.download === 'function') return options.download(url)
  const fetchImpl = typeof options.fetch === 'function' ? options.fetch : fetch
  const response = await fetchImpl(url)
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
  return Buffer.from(await response.arrayBuffer())
}

/** @param {{ repo: string, tag: string, name: string }} gitee @param {Record<string, unknown>} options */
async function giteeAssetUrl(gitee, options) {
  const fetchImpl = typeof options.fetch === 'function' ? options.fetch : fetch
  const api = `https://gitee.com/api/v5/repos/${gitee.repo}/releases/tags/${gitee.tag}`
  let response
  try {
    response = await fetchImpl(api)
  } catch (error) {
    // The Gitee release API is only a mirror lookup. A network failure leaves the pinned URLs.
    void error
    return undefined
  }
  if (!response.ok) return undefined
  const body = await response.json()
  const assets = body && Array.isArray(body.assets) ? body.assets : []
  const found = assets.find((asset) => asset && asset.name === gitee.name)
  return found && typeof found.browser_download_url === 'string' ? found.browser_download_url : undefined
}

/** @param {{ urls?: string[], gitee?: { repo: string, tag: string, name: string } }} asset @param {Record<string, unknown>} options */
async function downloadAsset(asset, options) {
  /** @type {unknown} */
  let lastError
  for (const url of asset.urls ?? []) {
    try {
      return await fetchBuffer(url, options)
    } catch (error) {
      lastError = error
    }
  }
  if (asset.gitee) {
    const mirror = await giteeAssetUrl(asset.gitee, options)
    if (typeof mirror === 'string') {
      try {
        return await fetchBuffer(mirror, options)
      } catch (error) {
        lastError = error
      }
    }
  }
  if (lastError instanceof Error) throw lastError
  throw new Error('cli-download-failed')
}

/** @param {string} lockPath */
async function lockIsStale(lockPath) {
  let text = ''
  try {
    text = await fs.readFile(lockPath, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return true
    throw error
  }
  const pid = Number(text.trim())
  if (!Number.isInteger(pid) || pid <= 0) return true
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    return error && error.code === 'ESRCH'
  }
}

/**
 * @template T
 * @param {string} lockPath
 * @param {Record<string, unknown>} options
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withLock(lockPath, options, fn) {
  await fs.mkdir(path.dirname(lockPath), { recursive: true })
  const waitMs = typeof options.lockWaitMs === 'number' ? options.lockWaitMs : 120_000
  const sleep = typeof options.sleep === 'function'
    ? options.sleep
    : (/** @type {number} */ ms) => new Promise((resolve) => { setTimeout(resolve, ms) })
  const pollMs = typeof options.lockPollMs === 'number' ? options.lockPollMs : 20
  const started = Date.now()
  for (;;) {
    try {
      const handle = await fs.open(lockPath, 'wx')
      try {
        await handle.writeFile(String(process.pid))
        return await fn()
      } finally {
        await handle.close()
        await fs.rm(lockPath, { force: true })
      }
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error
      if (await lockIsStale(lockPath)) {
        await fs.rm(lockPath, { force: true })
        continue
      }
      if (Date.now() - started > waitMs) throw new Error('cli-install-lock-timeout')
      await sleep(pollMs)
    }
  }
}

/**
 * Download, verify, and publish one pinned CLI binary.
 * A verified marker for the same version is reused. Checksums come from the
 * shipped manifest, never from a file downloaded beside the archive.
 * @param {string} channel
 * @param {Record<string, unknown>} [options]
 * @returns {Promise<string>} absolute path of the verified binary
 */
async function ensureChannelBinary(channel, options = {}) {
  const manifestPath = typeof options.manifestPath === 'string' ? options.manifestPath : DEFAULT_MANIFEST
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  const spec = manifest.channels && manifest.channels[channel]
  if (!spec) throw new Error(`cli-channel-unknown: ${channel}`)
  const platform = normalizePlatform(typeof options.platform === 'string' ? options.platform : process.platform)
  const arch = normalizeArch(typeof options.arch === 'string' ? options.arch : process.arch)
  const key = assetKey(platform, arch, spec.layout === 'npm' ? 'npm' : 'release')
  const asset = spec.assets && spec.assets[key]
  if (!asset) throw new Error(`cli-asset-unavailable: ${channel} ${key}`)
  const binRoot = typeof options.binRoot === 'string' ? options.binRoot : defaultBinRoot()
  const dest = path.join(binRoot, channel, spec.version)
  const names = binaryCandidates(spec.binary, platform)
  const ready = await verifiedBinary(dest, spec.version, asset, names)
  if (ready) return ready
  return withLock(path.join(binRoot, channel, '.install.lock'), options, async () => {
    const again = await verifiedBinary(dest, spec.version, asset, names)
    if (again) return again
    const buf = await downloadAsset(asset, options)
    assertHash(buf, asset)
    const stage = path.join(binRoot, channel, `.staging-${process.pid}-${crypto.randomBytes(4).toString('hex')}`)
    await fs.mkdir(stage, { recursive: true })
    const archivePath = path.join(stage, asset.archive)
    try {
      await fs.writeFile(archivePath, buf)
      if (typeof options.extract === 'function') await options.extract(archivePath, stage)
      else await extractArchive(archivePath, stage)
      const binary = await findBinary(stage, names)
      if (!binary) throw new Error(`cli-binary-missing: ${channel}`)
      try {
        await fs.chmod(binary, 0o755)
      } catch (error) {
        if (!error || (error.code !== 'EPERM' && error.code !== 'ENOTSUP')) throw error
      }
      await fs.writeFile(path.join(stage, '.verified'), markerFor(spec.version, asset), { mode: 0o600 })
      await fs.rm(archivePath, { force: true })
      await fs.rm(dest, { recursive: true, force: true })
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await fs.rename(stage, dest)
      const published = await verifiedBinary(dest, spec.version, asset, names)
      if (!published) throw new Error(`cli-install-unpublished: ${channel}`)
      return published
    } catch (error) {
      await fs.rm(stage, { recursive: true, force: true })
      throw error
    }
  })
}

module.exports = {
  ensureChannelBinary,
  assetKey,
  normalizePlatform,
  normalizeArch,
}
