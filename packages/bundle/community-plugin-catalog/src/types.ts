/** Browser-safe records returned by the community plugin catalog Remote. */

export type PluginCatalogSort = 'stars' | 'npm' | 'installs' | 'newest' | 'active'

/** A category and its live count from the community catalog. */
export interface PluginCatalogCategory {
  readonly id: string
  readonly en: string
  readonly zh: string
  readonly count: number
}

/** One public plugin listing; install is data and is never executed as a command. */
export interface CommunityPluginListing {
  readonly id: string
  readonly name: string
  readonly owner: string
  readonly url: string
  readonly category: string
  readonly description: { readonly en: string; readonly zh: string }
  readonly install: string
  readonly added: string
  readonly stars: number
  readonly installCount: number
  readonly npmDownloads7d: number | null
  readonly pushedAt: string
  readonly updatedAt: string
}

/** One filtered result page and the API's current category inventory. */
export interface PluginCatalogPage {
  readonly plugins: readonly CommunityPluginListing[]
  readonly categories: readonly PluginCatalogCategory[]
  readonly total: number
  readonly totalPages: number
  readonly page: number
  readonly limit: number
}
