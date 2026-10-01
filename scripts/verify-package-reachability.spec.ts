/**
 * The reachability gate's detection boundary, pinned on hand-built inputs:
 * which reference forms admit a package (a name mention, a cross-package
 * relative import, an executed snapshot fixture profile) and which never can
 * (manifest dependency edges, docs, build output, recorded expectations),
 * plus the allowlist and narrowed-corpus guards. Run against the real
 * workspace, the gate itself covers freshness of the 333-package verdict.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertScannableCorpus,
  evaluatePackageReachability,
  MIN_CORPUS_FILES,
  packageSubjects,
  scanReferenceFiles,
  type PackageSubject,
  type ScannedTextFile,
} from './verify-package-reachability.ts'

/** A referenced subject with sources, overridable per case. */
const B: PackageSubject = { name: '@deepseek-ai/dsh-b', dir: 'packages/g/b' }
/** A subject nobody references, for orphan and allowlist cases. */
const C: PackageSubject = { name: '@deepseek-ai/dsh-c', dir: 'packages/g/c' }

function file(path: string, text: string): ScannedTextFile {
  return { path, text }
}

describe('reachability evaluation', () => {
  it('admits a patch-row name mention from another package', () => {
    const verdict = evaluatePackageReachability(
      [B, C],
      [file('packages/g/c/cordis.patch.yml', "- insert:\n    - name: '@deepseek-ai/dsh-b'\n")],
      new Map(),
    )
    expect(verdict.orphans).toEqual([C.name])
    expect(verdict.referencedBy.get(B.name)?.[0]).toContain('cordis.patch.yml')
  })

  it('admits a cross-package relative import that resolves into the subject directory', () => {
    const verdict = evaluatePackageReachability(
      [B, C],
      [file('packages/g/c/src/index.ts', "export * from '../../b/src/index.ts'\n")],
      new Map(),
    )
    expect(verdict.orphans).toEqual([C.name])
    expect(verdict.referencedBy.get(B.name)?.[0]).toContain('imports packages/g/b/src/index.ts')
  })

  it('admits an extension-less relative import by directory containment', () => {
    const verdict = evaluatePackageReachability(
      [B, C],
      [file('packages/g/c/src/reexport.ts', "export * from '../../b/src/index'\n")],
      new Map(),
    )
    expect(verdict.orphans).toEqual([C.name])
  })

  it('never counts a mention from the subject own directory', () => {
    const verdict = evaluatePackageReachability(
      [B],
      [file('packages/g/b/README.md', 'names @deepseek-ai/dsh-b'), file('packages/g/b/cordis.patch.yml', "name: '@deepseek-ai/dsh-b'")],
      new Map(),
    )
    expect(verdict.orphans).toEqual([B.name])
  })

  it('honors an allowlist entry with its audit reason', () => {
    const verdict = evaluatePackageReachability([B], [], new Map([[B.name, 'opt-in plugin']]))
    expect(verdict.orphans).toEqual([])
  })

  it('rejects an allowlist entry that names no subject', () => {
    const verdict = evaluatePackageReachability([B], [], new Map([['@deepseek-ai/dsh-ghost', 'stale entry']]))
    expect(verdict.unknownAllowlistEntries).toEqual(['@deepseek-ai/dsh-ghost'])
  })

  it('sorts orphans', () => {
    const late: PackageSubject = { name: '@deepseek-ai/dsh-z', dir: 'packages/g/z' }
    const verdict = evaluatePackageReachability([late, B, C], [], new Map())
    expect(verdict.orphans).toEqual([B.name, C.name, late.name])
  })
})

describe('reference file scan', () => {
  const roots: string[] = []

  function fixtureRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'dsh-package-reachability-'))
    roots.push(root)
    return root
  }

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('counts an executed snapshot fixture profile but neither manifest edges, docs, build output, nor recorded expectations', () => {
    const root = fixtureRoot()
    mkdirSync(join(root, 'packages/g/b/src'), { recursive: true })
    mkdirSync(join(root, 'packages/g/b/lib'), { recursive: true })
    mkdirSync(join(root, 'packages/g/c/src'), { recursive: true })
    mkdirSync(join(root, 'docs'), { recursive: true })
    mkdirSync(join(root, 'snapshots/demo'), { recursive: true })
    writeFileSync(join(root, 'packages/g/b/package.json'), JSON.stringify({ name: B.name }))
    writeFileSync(join(root, 'packages/g/b/src/index.ts'), `export const name = '${B.name}'\n`)
    writeFileSync(join(root, 'packages/g/b/lib/index.js'), `exports.name = '${B.name}'\n`)
    writeFileSync(
      join(root, 'packages/g/c/package.json'),
      JSON.stringify({ name: C.name, dependencies: { [B.name]: 'workspace:*' } }),
    )
    writeFileSync(join(root, 'packages/g/c/README.md'), `Use ${B.name}.`)
    writeFileSync(join(root, 'docs/note.md'), `See ${B.name}.`)
    writeFileSync(join(root, 'snapshots/demo/cordis.snapshot.yml'), `name: ${B.name}`)
    writeFileSync(join(root, 'snapshots/demo/cordis.yml'), `- insert:\n    - name: '${B.name}'\n`)

    const files = scanReferenceFiles(root)
    const paths = files.map(scanned => scanned.path)
    expect(paths).toContain('snapshots/demo/cordis.yml')
    expect(paths).not.toContain('packages/g/c/package.json')
    expect(paths).not.toContain('packages/g/c/README.md')
    expect(paths).not.toContain('packages/g/b/lib/index.js')
    expect(paths).not.toContain('snapshots/demo/cordis.snapshot.yml')
    expect(paths).not.toContain('docs/note.md')

    const verdict = evaluatePackageReachability([B, C], files, new Map())
    expect(verdict.orphans).toEqual([C.name])
    expect(verdict.referencedBy.get(B.name)?.[0]).toContain('snapshots/demo/cordis.yml')
  })

  it('counts a cross-package relative import on disk, extensionless', () => {
    const root = fixtureRoot()
    mkdirSync(join(root, 'packages/g/b/src'), { recursive: true })
    mkdirSync(join(root, 'packages/g/c/src'), { recursive: true })
    writeFileSync(join(root, 'packages/g/b/package.json'), JSON.stringify({ name: B.name }))
    writeFileSync(join(root, 'packages/g/b/src/index.ts'), 'export const b = 1\n')
    writeFileSync(join(root, 'packages/g/c/package.json'), JSON.stringify({ name: C.name }))
    writeFileSync(join(root, 'packages/g/c/src/index.ts'), "export * from '../../b/src/index'\n")

    const verdict = evaluatePackageReachability([B, C], scanReferenceFiles(root), new Map())
    expect(verdict.orphans).toEqual([C.name])
    expect(verdict.referencedBy.get(B.name)?.[0]).toContain('packages/g/c/src/index.ts')
  })

  it('fails loud when the workspace enumeration finds no packages', () => {
    const root = fixtureRoot()
    expect(() => packageSubjects(root)).toThrow('no packages')
  })

  it('fails loud on a narrowed corpus', () => {
    expect(() => { assertScannableCorpus([]) }).toThrow('narrowed')
    expect(() => {
      assertScannableCorpus(
        Array.from({ length: MIN_CORPUS_FILES }, (_, index) => file(`packages/g/c/f${String(index)}.ts`, '')),
      )
    }).not.toThrow()
  })
})
