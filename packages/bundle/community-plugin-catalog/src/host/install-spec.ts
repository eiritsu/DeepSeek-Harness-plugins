/** Validate catalog install targets without interpreting them as commands. */

type Repository = { readonly owner: string; readonly name: string }

/** Reduce one catalog value to a single npm or GitHub spec.
 * @param value - untrusted catalog install value.
 * @returns one supported spec, or undefined when the value is ambiguous.
 */
export function normalizeCatalogInstall(value: string): string | undefined {
  const input = value.trim()
  const command = /^(?:npm\s+(?:install|i)|pnpm\s+add|yarn\s+add)\s+(\S+)$/iu.exec(input)
  const profileCommand = /^dsh plugin --profile [a-z0-9_-]+ add (?:--allow-build=[@a-z0-9._/-]+ )?(\S+)$/iu.exec(input)
  const spec = command?.[1] ?? profileCommand?.[1] ?? input
  if (/\s/u.test(spec)) return undefined
  if (npmSpec.test(spec) || githubRepository(spec) !== undefined) return spec
  return undefined
}

/** Check that a GitHub target names the repository shown by the listing.
 * @param spec - normalized install target.
 * @param displayUrl - validated listing URL.
 * @returns true for npm specs or a matching GitHub repository.
 */
export function matchesCatalogRepository(spec: string, displayUrl: string): boolean {
  const target = githubRepository(spec)
  if (target === undefined) return npmSpec.test(spec)
  const shown = githubRepositoryUrl(displayUrl)
  return shown !== undefined && sameRepository(target, shown)
}

const npmPackageName = String.raw`(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*`
const npmVersion = String.raw`[a-z0-9][a-z0-9.+_~^*-]*`
const npmSpec = new RegExp(`^${npmPackageName}(?:@${npmVersion})?$`, 'iu')

function githubRepository(spec: string): Repository | undefined {
  const shorthand = /^github:([a-z0-9][a-z0-9._-]*)\/([a-z0-9][a-z0-9._-]*)(?:#[^\s]*)?$/iu.exec(spec)
  if (shorthand !== null) return repository(shorthand[1], shorthand[2])
  if (!/^git\+https:\/\//iu.test(spec) && !/^https:\/\//iu.test(spec)) return undefined
  try {
    const url = new URL(spec.replace(/^git\+/iu, ''))
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.username !== '' || url.password !== '' || url.search !== '') return undefined
    const segments = url.pathname.split('/').filter(Boolean)
    if (segments.length !== 2 || segments.some(segment => decodeURIComponent(segment) !== segment)) return undefined
    return repository(segments[0], segments[1])
  } catch { return undefined }
}

function githubRepositoryUrl(value: string): Repository | undefined {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.username !== '' || url.password !== '') return undefined
    const segments = url.pathname.split('/').filter(Boolean)
    if (segments.length < 2 || segments.some(segment => decodeURIComponent(segment) !== segment)) return undefined
    return repository(segments[0], segments[1])
  } catch { return undefined }
}

function repository(owner: string | undefined, name: string | undefined): Repository | undefined {
  return owner === undefined || name === undefined ? undefined : { owner, name: cleanRepository(name) }
}

function cleanRepository(value: string): string {
  return value.replace(/\.git$/iu, '').toLowerCase()
}

function sameRepository(left: Repository, right: Repository): boolean {
  return left.owner.toLowerCase() === right.owner.toLowerCase() && left.name === right.name
}
