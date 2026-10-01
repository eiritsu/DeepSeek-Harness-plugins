/** JSON records shared by the authenticated backup route and its Client. */

/** One root the Host has derived from an active skill-filesystem configuration. */
export interface BackupSkillRoot {
  /** Stable within this profile composition; contains no filesystem path. */
  id: string
  /** Localized display key. */
  kind: 'dsh-user' | 'agents-user' | 'project-dsh' | 'project-agents' | 'custom' | 'bundled'
  /** Human-readable label that does not expose an absolute machine path. */
  label: string
}

/** One regular file captured below an explicitly selected skill root. */
export interface BackupSkillFile {
  rootId: string
  path: string
  bytes: number
  sha256: string
  data: string
}

/** One user override for an active plugin; secret schema fields are omitted. */
export interface BackupConfigEntry {
  id: string
  packageName: string
  config: Record<string, unknown>
  /** Secret slots found in the source override, without their values. */
  secrets: Array<{ path: string[]; wasConfigured: boolean }>
}

/** One selected bundle package in the source profile. */
export interface BackupBundleSelection {
  name: string
  version?: string
}

/** Why a source configuration could not be included safely. */
export interface BackupUnsupportedEntry {
  kind: 'inactive-config' | 'unknown-schema' | 'non-json-config'
  id: string
  reason: string
}

/** Versioned portable archive; machine-specific root paths and Session data are absent. */
export interface ConfigurationSkillsArchive {
  format: 'dsh-configuration-and-skills-backup'
  version: 1
  createdAt: string
  configs: BackupConfigEntry[]
  bundles: BackupBundleSelection[]
  skillRoots: BackupSkillRoot[]
  skillDirectories: Array<{ rootId: string; path: string }>
  skillFiles: BackupSkillFile[]
  unsupported: BackupUnsupportedEntry[]
}

/** One independently applicable item in an import preview. */
export interface BackupImportItem {
  id: string
  kind: 'config' | 'bundle' | 'skill-file'
  status: 'ready' | 'identical' | 'conflict' | 'missing' | 'unsupported' | 'applied' | 'failed'
  detail: string
}

/** Results from one preview or one partially successful import. */
export interface BackupOperationResult {
  archiveId: string
  items: BackupImportItem[]
  journalPath?: string
}
