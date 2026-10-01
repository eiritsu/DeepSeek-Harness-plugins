/**
 * Fail when a workspace package is consumed by nobody:
 * not mounted by a patch or profile row, not imported by any live source, and
 * not carried by any build or gate tooling. Manifest dependency edges do not
 * count — a stale devDependency on a dead package is exactly the residue this
 * gate exists to surface (the deleted `ui-lark` / `ui-plugin-catalog` /
 * `ui-skill-catalog` orphans). Run: `tsx scripts/verify-package-reachability.ts`.
 */

import { globSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const GATE = 'verify-package-reachability'

/**
 * Directories whose contents never create or reflect package reachability:
 * build outputs, rendered docs, agent notes, and workspaces (native, python)
 * with their own dependency graph. `snapshots` is walked but only its
 * `cordis.yml` fixture inputs count — they are the executed profiles of
 * `test:snapshot`; recorded expectation payloads never count.
 */
const SKIPPED_DIRS = new Set([
  '.git', '.agents', 'node_modules', 'lib', 'dist', 'build', 'coverage',
  'docs', 'website', 'native', 'python', '.codex',
])

/** Fixture inputs under `snapshots/` are executed profiles; every other file there is a recorded expectation. */
const SNAPSHOT_INPUT = 'snapshots/'

/** File suffixes whose text may reference or import a package. */
const SCANNED_SUFFIXES = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.yml', '.yaml', '.json'])

/**
 * Files whose package-name mentions never mean consumption. Manifests name
 * their own dependencies — the residue this gate rejects. tsconfig aliases are
 * generated from the workspace. `.md` and `.i18n.yaml` document rather than
 * consume.
 */
function skippedFile(name: string): boolean {
  return name === 'package.json' || name === 'pnpm-lock.yaml' || name.startsWith('tsconfig')
    || name.endsWith('.md') || name.endsWith('.i18n.yaml')
}

/** Relative specifiers of `from '…'` / `import('…')` forms, for cross-package resolution. */
const RELATIVE_IMPORT = /(?:from|import)\s*['"](\.[^'"]+)['"]/g

/** One workspace package subject to the reachability rule. */
export interface PackageSubject {
  /** npm name, e.g. `@deepseek-ai/dsh-web`. */
  readonly name: string
  /** Repository-relative directory, POSIX separators. */
  readonly dir: string
}

/** One scanned repository file: repository-relative path and its text. */
export interface ScannedTextFile {
  /** Repository-relative path, POSIX separators. */
  readonly path: string
  /** Full file text. */
  readonly text: string
}

/** The reachability verdict for one evaluation. */
export interface ReachabilityVerdict {
  /** Subject names nothing consumes, sorted; allowlisted names are not included. */
  readonly orphans: readonly string[]
  /** Allowlist entries that name no scanned subject, sorted — the allowlist must rot loudly. */
  readonly unknownAllowlistEntries: readonly string[]
  /** Subject name → one sample referencing file per referencing surface kind. */
  readonly referencedBy: ReadonlyMap<string, readonly string[]>
}

/**
 * Decide reachability per subject. A subject is referenced when a scanned file
 * outside its own directory either spells its npm name or relatively imports a
 * path that resolves into its directory. Manifest-only mentions cannot make a
 * package reachable because manifests are not in the scanned file set.
 * Pure, so the spec can pin every admitted and excluded reference form.
 * @param subjects - every evaluated workspace package.
 * @param files - the scanned repository corpus.
 * @param allowlist - subject name → audit reason for packages allowed to stay unreferenced.
 * @returns orphans, stale allowlist entries, and per-subject sample references.
 */
export function evaluatePackageReachability(
  subjects: readonly PackageSubject[],
  files: readonly ScannedTextFile[],
  allowlist: ReadonlyMap<string, string>,
): ReachabilityVerdict {
  const subjectDirs = subjects.map(subject => ({ ...subject, prefix: `${subject.dir}/` }))
  const referencedBy = new Map<string, string[]>(subjects.map(subject => [subject.name, []]))
  for (const file of files) {
    const relativeTargets = file.path.endsWith('.ts') || file.path.endsWith('.tsx')
      || file.path.endsWith('.mts') || file.path.endsWith('.cts')
      ? relativeImportTargets(file.path, file.text)
      : []
    for (const subject of subjectDirs) {
      if (file.path.startsWith(subject.prefix)) continue
      const reasons: string[] = []
      if (file.text.includes(subject.name)) reasons.push(`names ${subject.name}`)
      for (const target of relativeTargets) {
        if (target.startsWith(subject.prefix)) reasons.push(`imports ${target}`)
      }
      if (reasons.length > 0) referencedBy.get(subject.name)?.push(`${file.path} (${reasons.join('; ')})`)
    }
  }
  const orphans = subjects
    .map(subject => subject.name)
    .filter(name => (referencedBy.get(name)?.length ?? 0) === 0 && !allowlist.has(name))
  const knownNames = new Set(subjects.map(subject => subject.name))
  const unknownAllowlistEntries = [...allowlist.keys()].filter(name => !knownNames.has(name)).sort()
  return { orphans: orphans.sort(), unknownAllowlistEntries, referencedBy }
}

/**
 * Resolve every relative import of one module to a repository-relative path
 * without its extension, so callers can test directory containment.
 * @param path - repository-relative importing file, POSIX separators.
 * @param text - the importing file's text.
 * @returns resolved repository-relative targets for each relative specifier.
 */
function relativeImportTargets(path: string, text: string): string[] {
  const root = process.cwd()
  const targets: string[] = []
  for (const match of text.matchAll(RELATIVE_IMPORT)) {
    const specifier = match[1] ?? ''
    if (!specifier.startsWith('.')) continue
    const resolved = relative(root, resolve(root, dirname(path), specifier)).split('\\').join('/')
    if (resolved.length > 0 && !resolved.startsWith('..')) targets.push(resolved)
  }
  return targets
}

/** Names and dirs of every two-level workspace package manifest, failing loud on an empty corpus. */
export function packageSubjects(root: string): PackageSubject[] {
  const subjects = globSync('packages/*/*/package.json', { cwd: root })
    .map((manifestPath) => {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string }
      if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
        throw new Error(`${GATE}: ${manifestPath} has no npm name.`)
      }
      return { name: manifest.name, dir: dirname(manifestPath).split('\\').join('/') }
    })
    .sort((left, right) => left.name.localeCompare(right.name))
  if (subjects.length === 0) {
    throw new Error(`${GATE}: no packages/*/*/package.json found — run the gate from the repository root.`)
  }
  return subjects
}

/** Walk the repository collecting the text of every file that may reference a package. */
export function scanReferenceFiles(root: string): ScannedTextFile[] {
  const files: ScannedTextFile[] = []
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) visit(path)
        continue
      }
      if (!SCANNED_SUFFIXES.has(entry.name.slice(entry.name.lastIndexOf('.')))) continue
      if (skippedFile(entry.name)) continue
      if (relative(root, path).startsWith(SNAPSHOT_INPUT) && entry.name !== 'cordis.yml') continue
      try {
        if (statSync(path).size > 2_000_000) continue
      } catch {
        // The file can vanish between readdir and stat; a missing file cannot reference anything.
        continue
      }
      files.push({ path: relative(root, path).split('\\').join('/'), text: readFileSync(path, 'utf8') })
    }
  }
  visit(root)
  return files
}

/**
 * Packages this repository deliberately keeps alive without an in-repo
 * consumer, each with the audit reason that justifies it. All four are
 * documented opt-in plugins no shipped composition mounts; deleting or
 * mounting one is a product decision, not gate residue.
 */
const ORPHAN_ALLOWLIST: Readonly<Record<string, string>> = {
  '@deepseek-ai/dsh-web-search-perplexity': 'Documented opt-in search provider deployments mount by name; the Python SDK runtime ships it, and its model-facing tool lives in dsh-tool-web, so no tooling imports it either.',
  '@deepseek-ai/dsh-session-title-all-prompts-llm': 'Opt-in ctx.sessionTitle cadence variant deployments mount over the default; no in-repo composition mounts it.',
  '@deepseek-ai/dsh-storage-sqlite': 'Opt-in storage backend registered as `sqlite` for deployments that need one queryable database; no in-repo composition mounts it.',
  '@deepseek-ai/dsh-host-product-telemetry-otel': 'Opt-in OTLP/HTTP telemetry exporter that applications mount and drive explicitly; no in-repo composition mounts it.',
}

/** Below this many scanned files the corpus is narrowed (wrong root, broken checkout) and no verdict can be meaningful. */
export const MIN_CORPUS_FILES = 100

/**
 * Reject a scanned corpus too small to trust, so a wrong working directory or
 * a broken checkout fails loud instead of flagging every package an orphan.
 * @param files - the scanned corpus.
 */
export function assertScannableCorpus(files: readonly ScannedTextFile[]): void {
  if (files.length < MIN_CORPUS_FILES) {
    throw new Error(`${GATE}: scanned only ${String(files.length)} files — the corpus is narrowed, so the verdict would be meaningless.`)
  }
}

function main(): void {
  const root = process.cwd()
  const subjects = packageSubjects(root)
  const files = scanReferenceFiles(root)
  assertScannableCorpus(files)
  const allowlist = new Map(Object.entries(ORPHAN_ALLOWLIST))
  const { orphans, unknownAllowlistEntries, referencedBy } = evaluatePackageReachability(subjects, files, allowlist)
  const referencedCount = subjects.filter(subject => (referencedBy.get(subject.name)?.length ?? 0) > 0).length
  if (unknownAllowlistEntries.length === 0 && orphans.length === 0) {
    console.log(`${GATE}: ${String(subjects.length)} workspace package(s) reachable`
      + ` (${String(referencedCount)} referenced, ${String(allowlist.size)} allowlisted opt-in) across ${String(files.length)} scanned files.`)
    return
  }
  console.error(`${GATE}: package reachability broken.\n`)
  for (const name of orphans) {
    const dir = subjects.find(subject => subject.name === name)?.dir ?? ''
    console.error(`  ${name} (${dir}) is consumed by nobody: not mounted by a patch or profile row,`)
    console.error('    not imported by any live source, and not carried by tooling. Delete it or move its')
    console.error('    responsibility into a consumer; if it must stay, add an audited ORPHAN_ALLOWLIST entry.')
  }
  for (const name of unknownAllowlistEntries) {
    console.error(`  ORPHAN_ALLOWLIST names '${name}', which is not a packages/*/*/ package. Remove the entry.`)
  }
  process.exit(1)
}

if (import.meta.filename === resolve(process.argv[1] ?? '')) main()
