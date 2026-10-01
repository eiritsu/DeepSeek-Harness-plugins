#!/usr/bin/env node
import { constants as fsConstants } from 'node:fs'
import { chmod, lstat, mkdir, open, realpath, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { stringify } from 'yaml'
import { convert } from './convert-legacy-config.mjs'

const args = parseArgs(process.argv.slice(2))
if (args.help) {
  process.stdout.write('Usage: node migrate-legacy-config.mjs --patch FILE --settings FILE [--credentials FILE] [--selection-context FILE] --output-dir NEW_DIR\n')
  process.exit(0)
}
if (args.patch === undefined || args.settings === undefined || args.outputDir === undefined) {
  throw new Error('Required arguments: --patch, --settings, and --output-dir.')
}

const patchText = await readSelectedFile(args.patch)
const settingsText = await readSelectedFile(args.settings)
const credentialsText = args.credentials === undefined ? '' : await readSelectedFile(args.credentials)
let selectionContext
if (args.selectionContext !== undefined) {
  try { selectionContext = JSON.parse(await readSelectedFile(args.selectionContext)) }
  catch { throw new Error('The selection context is not valid JSON.') }
}

const converted = convert({ patchText, legacyText: settingsText, credentialsText, selectionContext })
const archive = {
  format: 'dsh-configuration-and-skills-backup',
  version: 1,
  createdAt: new Date().toISOString(),
  configs: converted.patch.map(row => ({
    id: row.id,
    packageName: row.name,
    config: row.config,
    secrets: [],
  })),
  bundles: [],
  skillRoots: [],
  skillDirectories: [],
  skillFiles: [],
  unsupported: pendingEntries(converted),
}

const target = resolve(args.outputDir)
const parent = await realpath(dirname(target))
if (target === parent) throw new Error('Output directory must be a new child directory.')
await mkdir(target, { mode: 0o700 })
await chmod(target, 0o700)
try {
  await writeNewFile(resolve(target, 'dsh-configuration-and-skills-backup-v1.json'), `${JSON.stringify(archive, null, 2)}\n`)
  await writeNewFile(resolve(target, 'migration-report.json'), `${JSON.stringify(safeReport(converted), null, 2)}\n`)
  if (Object.keys(converted.credentials.refs).length > 0 || converted.credentials.records !== undefined) {
    await writeNewFile(resolve(target, 'credentials-to-review.yaml'), stringify(converted.credentials))
  }
} catch (error) {
  throw new Error(`Output was incomplete; remove only the newly created directory to retry: ${target}`, { cause: error })
}
process.stdout.write(`Created ${target}\n`)
process.stdout.write('Import dsh-configuration-and-skills-backup-v1.json through the optional Configuration and Skills Backup Settings page. Review migration-report.json. credentials-to-review.yaml, when present, is not part of the archive and must be applied separately through the official credential store.\n')

function parseArgs(argv) {
  const result = {}
  for (let index = 0; index < argv.length; index++) {
    const option = argv[index]
    if (option === '--help' || option === '-h') { result.help = true; continue }
    const key = ({ '--patch': 'patch', '--settings': 'settings', '--credentials': 'credentials', '--selection-context': 'selectionContext', '--output-dir': 'outputDir' })[option]
    if (key === undefined || result[key] !== undefined || argv[index + 1] === undefined || argv[index + 1].startsWith('--')) {
      throw new Error('Invalid or duplicate command-line option.')
    }
    result[key] = argv[++index]
  }
  return result
}

async function readSelectedFile(path) {
  const absolute = resolve(path)
  const handle = await open(absolute, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0))
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.size > 16 * 1024 * 1024) throw new Error('Selected input is not a supported regular file.')
    const text = await handle.readFile({ encoding: 'utf8' })
    const after = await handle.stat()
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new Error('Selected input changed while it was read.')
    }
    return text
  } finally { await handle.close() }
}

async function writeNewFile(path, contents) {
  const handle = await open(path, 'wx', 0o600)
  try { await handle.writeFile(contents, 'utf8'); await handle.sync() }
  finally { await handle.close() }
  await chmod(path, 0o600)
}

function pendingEntries(result) {
  const rows = new Map()
  for (const item of result.pending) {
    const id = `${item.id}:${item.field}`
    rows.set(id, { kind: 'unknown-schema', id, reason: `Pending legacy field: ${item.reason}` })
  }
  for (const item of result.report) {
    if (item.status === 'migrated') continue
    const id = `${item.id}:${item.field}`
    rows.set(id, { kind: 'unknown-schema', id, reason: `${item.status}: ${item.reason}` })
  }
  return [...rows.values()]
}

function safeReport(result) {
  return {
    format: 'dsh-legacy-config-migration-report',
    version: 1,
    convertedEntries: result.patch.map(({ id, name, config }) => ({ id, packageName: name, fields: Object.keys(config).sort() })),
    pending: pendingEntries(result),
    credentialReferenceCount: Object.keys(result.credentials.refs).length,
    credentialsFileProduced: Object.keys(result.credentials.refs).length > 0 || result.credentials.records !== undefined,
    note: 'No source values or credential values are included in this report.',
  }
}
