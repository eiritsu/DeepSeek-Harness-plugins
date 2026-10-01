/** Browser-safe records returned by the SkillHub catalog Remote. */

export type SkillHubSort = 'score' | 'downloads' | 'stars' | 'installs' | 'updated_at'

/** Stable Remote failures for publisher identity checks. */
export interface SkillHubRemoteErrorDetailsMap {
  /** The slug-only public routes cannot identify one publisher for the selected skill. */
  'skillhub/identity-ambiguous': {}
  /** The listing identity no longer matches the detail or current listing. */
  'skillhub/identity-changed': {}
  /** A configured local installation resource budget stopped the release. */
  'skillhub/install-limit': { readonly budget: 'archive' | 'entries' | 'files' | 'expanded' | 'metadata'; readonly limit: number }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap extends SkillHubRemoteErrorDetailsMap {}
}

/** How the SkillHub directory filters skills that require a provider API key. */
export type SkillHubApiKeyFilter = 'all' | 'required' | 'none'

/** One validated public SkillHub listing. */
export interface SkillHubSkill {
  /** SkillHub namespace-qualified identity from the listing response. */
  readonly canonicalName?: string
  readonly slug: string
  readonly name: string
  readonly description: string
  readonly category: string
  readonly source: string
  readonly version: string
  readonly downloads: number
  readonly stars: number
  readonly requiresApiKey?: boolean
  readonly url: string
}

/** One filtered SkillHub page. */
export interface SkillHubPage {
  readonly items: readonly SkillHubSkill[]
  readonly total: number
}

/** A SkillHub detail record with the selected release and bounded file inventory. */
export interface SkillHubDetail {
  readonly skill: SkillHubSkill
  readonly owner: string
  readonly changelog: string
  readonly files: readonly { readonly path: string; readonly size: number; readonly sha256: string }[]
  readonly totalBytes: number
}

/** Result of installing a reviewed SkillHub release into the configured skill root. */
export interface SkillHubInstallResult {
  readonly canonicalName: string
  readonly slug: string
  readonly version: string
  readonly path: string
  readonly files: number
  readonly totalBytes: number
  /** Existing release backup path when cleanup failed after the new skill was committed. */
  readonly backupCleanupPending?: string
}

/** One directory skill in the global DSH skill root. */
export interface InstalledSkill {
  /** Direct child directory name used as the opaque removal key. */
  readonly id: string
  /** Display name derived from the directory name. */
  readonly name: string
}
