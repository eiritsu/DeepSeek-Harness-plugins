/** Validate the assembled application, including native Office conversion outside ASAR. */
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { resolveDesktopBuildTarget } from './desktop-build-paths.mjs'
import { readDesktopRuntime, verifyDesktopRuntime } from '../src/runtime-tree.ts'
import { verifyWindowsCode } from './windows-runtime-signature.mjs'
import { smokePreparedRuntime } from './smoke-prepared-runtime.ts'
import { packagedDshDirectory, packagedSmokeBuildPaths } from './packaged-runtime-paths.mjs'
import { resolveDesktopPackageTarget } from './package-target.ts'
import { formatUnsignedTestVersionPair, isDesktopUnsignedTest } from './unsigned-test-mode.mjs'

const { values } = parseArgs({ options: { unsigned: { type: 'boolean', default: false }, 'unsigned-test': { type: 'boolean', default: false } }, allowPositionals: false })
const unsignedTest = values['unsigned-test'] || isDesktopUnsignedTest(process.env)
const paths = packagedSmokeBuildPaths(process.env, unsignedTest)
const target = resolveDesktopBuildTarget()
const windows = target === 'win-x64'
if (values.unsigned && !windows) throw new Error('desktop smoke: unsigned artifacts require Windows')
if (unsignedTest && target !== 'mac-arm64') throw new Error('desktop smoke: unsigned test artifacts require macOS arm64')
const artifacts = unsignedTest ? paths.unsignedTestArtifacts : values.unsigned ? paths.unsignedArtifacts : paths.artifacts
const application = windows ? join(artifacts, 'win-unpacked')
  : join(artifacts, target === 'mac-arm64' ? 'mac-arm64' : 'mac', `${unsignedTest ? 'DeepSeeK Harness' : 'DeepSeek Harness'}.app`, 'Contents')
const resources = join(application, windows ? 'resources' : 'Resources')
const dshRoot = join(resources, packagedDshDirectory(unsignedTest), 'dsh')
const executable = windows ? join(application, 'DeepSeek Harness.exe') : join(application, 'MacOS', `${unsignedTest ? 'DeepSeeK Harness' : 'DeepSeek Harness'}`)
const descriptor = await verifyDesktopRuntime(paths.dsh, readDesktopRuntime(paths.dsh).release.version,
  resolveDesktopPackageTarget(target))
if (unsignedTest) process.stdout.write(`desktop smoke: ${formatUnsignedTestVersionPair(descriptor.release.version)}\n`)
if (windows && !values.unsigned) await verifyWindowsCode(application)
await smokePreparedRuntime(dshRoot, executable, join(resources, 'runtime'), descriptor)
