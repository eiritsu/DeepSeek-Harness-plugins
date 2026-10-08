/** Browser-safe records returned by the SkillsMP catalog Remote. */

export type SkillsMpSort = 'stars' | 'recent'
/** SkillsMP directory content language its taxonomy is fetched and cached in. */
export type SkillsMpLocale = 'en' | 'zh'

/** One named category exposed by the SkillsMP directory. */
export interface SkillsMpTaxonomyCategory {
  readonly slug: string
  readonly name: string
  readonly group?: string
}

/** One SOC occupation with its level and source-provided optional metadata. */
export interface SkillsMpTaxonomyOccupation {
  readonly slug: string
  readonly name: string
  readonly parentId?: string
  readonly level: 1 | 2 | 3 | 4
  readonly code?: string
  readonly skillCount?: number
}

/** Localized categories and the complete four-level SkillsMP occupation tree. */
export interface SkillsMpTaxonomy {
  readonly categories: readonly SkillsMpTaxonomyCategory[]
  readonly occupations: readonly SkillsMpTaxonomyOccupation[]
}

/** Stable SkillsMP catalog failures returned by the Remote. */
export interface SkillsMpRemoteErrorDetailsMap {
  /** SkillsMP rejected the search request. */
  'skillsmp/forbidden': { readonly status: 403 }
  /** SkillsMP search quota is exhausted. */
  'skillsmp/rate-limited': { readonly status: 429 }
  /** SkillsMP could not provide a source manifest. */
  'skillsmp/source-unavailable': { readonly status: 503 }
  /** SkillsMP omitted files because its manifest reached a download limit. */
  'skillsmp/manifest-incomplete': { readonly skippedFiles: number; readonly limitReason?: 'file_count' | 'file_size' | 'total_size' }
  /** SkillsMP listed a URL outside the supported GitHub source format. */
  'skillsmp/github-source-invalid': {}
  /** The search result was evicted from the bounded Host source cache. */
  'skillsmp/search-required': {}
  /** The reviewed manifest was evicted from the bounded Host review cache. */
  'skillsmp/review-required': {}
  /** The selected GitHub directory has no root `SKILL.md`. */
  'skillsmp/skill-markdown-missing': {}
  /** A downloaded file did not match its Git blob metadata. */
  'skillsmp/file-integrity-failed': { readonly path: string }
  /** The downloaded files do not form one skill accepted by the official filesystem provider. */
  'skillsmp/skill-incompatible': {}
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap extends SkillsMpRemoteErrorDetailsMap {}
}

/** One validated SkillsMP search result. */
export interface SkillsMpSkill {
  readonly id: string
  readonly name: string
  readonly author: string
  readonly description: string
  readonly contentLanguage: string
  readonly githubUrl: string
  readonly url: string
  readonly stars: number
  readonly updatedAt: number
}

/** One SkillsMP search result page. */
export interface SkillsMpPage {
  readonly items: readonly SkillsMpSkill[]
  readonly total: number
  readonly totalIsExact: boolean
  readonly hasNext: boolean
  readonly page: number
}

/** A skill source manifest pinned to one Git commit. */
export interface SkillsMpDetail {
  readonly skill: SkillsMpSkill
  readonly commitSha: string
  readonly files: readonly { readonly path: string; readonly size: number; readonly sha: string }[]
  readonly totalBytes: number
  readonly skillMarkdown: string
}

/** Result of installing a reviewed Git commit into the configured skill root. */
export interface SkillsMpInstallResult {
  readonly id: string
  readonly commitSha: string
  readonly path: string
  readonly files: number
  readonly totalBytes: number
  /** Existing skill backup path when cleanup failed after the new skill was committed. */
  readonly backupCleanupPending?: string
}

/** One directory skill in the global DSH skill root. */
export interface InstalledSkill {
  /** Direct child directory name used as the opaque removal key. */
  readonly id: string
  /** Display name derived from the directory name. */
  readonly name: string
}
