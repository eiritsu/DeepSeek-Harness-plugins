/** Browser-safe records returned by the dual-source community skill catalog Remote. */

/** Upstream catalog source identifier. */
export type SkillCatalogSource = 'github-index' | 'skills-sh'

/** Source scope accepted by the catalog query filter. */
export type SkillCatalogSourceFilter = 'all' | SkillCatalogSource

/** Ranking mode supported by the dual-source skill catalog. */
export type SkillCatalogSort = 'popular' | 'installs' | 'recent'

/** One skill category and its item count in the curated GitHub index. */
export interface SkillCategory {
  /** Normalized category slug from the curated GitHub index. */
  readonly id: string
  /** Number of indexed skills assigned to this category. */
  readonly count: number
}

/** Category inventory returned for the curated GitHub skill index. */
export interface SkillCatalogTaxonomy {
  /** Categories ordered by descending skill count. */
  readonly categories: readonly SkillCategory[]
  /** Total validated skills held in the curated GitHub index. */
  readonly totalIndexed: number
  /** Repository slug (`owner/repo`) supplying the curated index. */
  readonly indexRepo: string
  /** Unix epoch milliseconds when the index was loaded. */
  readonly fetchedAt: number
}

/** Partial failure notice when one catalog backend could not be queried. */
export interface SkillSourceWarning {
  /** Backend source that reported an error during a combined query. */
  readonly source: SkillCatalogSource
  /** Failure category surfaced for degraded-mode UI notices. */
  readonly code: 'rate-limited' | 'unavailable'
}

/** Stable skill catalog failures returned by the Host Remote. */
export interface SkillCatalogRemoteErrorDetailsMap {
  /** Upstream source throttled requests. */
  'skill-catalog/rate-limited': { readonly source: 'github' | 'skills-sh'; readonly status: number }
  /** Upstream catalog source was unreachable or returned an invalid payload. */
  'skill-catalog/source-unavailable': { readonly source: 'github' | 'skills-sh'; readonly status: number }
  /** Source directory exceeded configured file count or byte limits. */
  'skill-catalog/manifest-incomplete': { readonly skippedFiles: number; readonly limitReason?: 'file_count' | 'file_size' | 'total_size' }
  /** GitHub source URL or repository specifier is outside the allowed HTTPS GitHub format. */
  'skill-catalog/github-source-invalid': {}
  /** Requested skill is no longer in the bounded Host search cache. */
  'skill-catalog/search-required': {}
  /** Reviewed commit manifest expired from the bounded Host review cache. */
  'skill-catalog/review-required': {}
  /** Resolved GitHub skill directory has no root `SKILL.md`. */
  'skill-catalog/skill-markdown-missing': {}
  /** Downloaded file size or Git blob SHA did not match reviewed metadata. */
  'skill-catalog/file-integrity-failed': { readonly path: string }
  /** Staged files do not form one skill accepted by the official filesystem provider. */
  'skill-catalog/skill-incompatible': {}
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap extends SkillCatalogRemoteErrorDetailsMap {}
}

/** One validated skill entry from the GitHub index or `skills.sh`. */
export interface SkillCatalogItem {
  /** Opaque lookup key retained by the bounded Host search cache. */
  readonly id: string
  /** Display name of the skill. */
  readonly name: string
  /** Safe direct child folder name created under the DSH skills root on install. */
  readonly installDir: string
  /** Upstream skill identifier or directory name within its source. */
  readonly skillId: string
  /** GitHub repository slug (`owner/repo`). */
  readonly repo: string
  /** Author or repository owner display label. */
  readonly author: string
  /** Concise summary from the index or upstream metadata (empty if omitted at search time). */
  readonly description: string
  /** Normalized category slug when available from the curated GitHub index. */
  readonly category?: string
  /** Optional curated risk classification from the GitHub index. */
  readonly risk?: string
  /** Optional target coding agent identifiers recorded in the GitHub index. */
  readonly targets?: readonly string[]
  /** Canonical public GitHub repository or tree URL. */
  readonly githubUrl: string
  /** Primary listing URL on `skills.sh` or GitHub. */
  readonly url: string
  /** Primary backend used when resolving files and committing an install. */
  readonly source: SkillCatalogSource
  /** All sources that listed this skill after dual-source deduplication. */
  readonly sources: readonly SkillCatalogSource[]
  /** Community install count reported by `skills.sh`, when known. */
  readonly installs?: number
  /** Unix epoch seconds from curated `date_added`, when known. */
  readonly updatedAt?: number
  /** Original `YYYY-MM-DD` added date from the curated index, when known. */
  readonly dateAdded?: string
}

/** One paginated catalog result page and optional partial-source warnings. */
export interface SkillCatalogPage {
  /** Validated skills on the current page. */
  readonly items: readonly SkillCatalogItem[]
  /** Number of matched skills across all pages for the current filter. */
  readonly total: number
  /** True when the backend reported or computed the exact total count. */
  readonly totalIsExact: boolean
  /** True when at least one more page follows `page`. */
  readonly hasNext: boolean
  /** One-based current page number. */
  readonly page: number
  /** Effective page size used for slicing. */
  readonly pageSize: number
  /** Non-fatal backend warnings returned when only one of two queried sources failed. */
  readonly warnings?: readonly SkillSourceWarning[]
}

/** A skill directory manifest pinned to one resolved 40-character Git commit SHA. */
export interface SkillCatalogDetail {
  /** Enriched skill record (description backfilled from `SKILL.md` frontmatter if needed). */
  readonly skill: SkillCatalogItem
  /** Exact 40-character lowercase Git commit SHA reviewed for installation. */
  readonly commitSha: string
  /** Repository-relative skill directory path resolved at `commitSha` (`""` for repo root). */
  readonly resolvedPath: string
  /** Reviewed file inventory inside the skill directory. */
  readonly files: readonly { readonly path: string; readonly size: number; readonly sha?: string }[]
  /** Sum of byte sizes across all listed files. */
  readonly totalBytes: number
  /** Full UTF-8 text of the root `SKILL.md` file. */
  readonly skillMarkdown: string
  /** Number of omitted files when upstream truncation occurred. */
  readonly skippedFiles?: number
  /** Limit reason reported if files were omitted. */
  readonly limitReason?: 'file_count' | 'file_size' | 'total_size'
}

/** Result of installing a reviewed Git commit into the global DSH skill root. */
export interface SkillInstallResult {
  /** Installed directory key under `skillRoot`. */
  readonly id: string
  /** Exact 40-character Git commit SHA installed. */
  readonly commitSha: string
  /** Absolute directory path written on disk. */
  readonly path: string
  /** Number of installed files. */
  readonly files: number
  /** Total bytes written across all installed files. */
  readonly totalBytes: number
  /** Previous directory backup path if post-commit cleanup failed. */
  readonly backupCleanupPending?: string
}

/** One directory skill currently installed in the global DSH skill root. */
export interface InstalledSkill {
  /** Direct child directory name used as the removal key. */
  readonly id: string
  /** Display name derived from the directory name. */
  readonly name: string
}
