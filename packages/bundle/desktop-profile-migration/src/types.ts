/** Business bundles available as explicit additions to an existing Desktop profile. */
export const DESKTOP_MIGRATION_CANDIDATES = [
  '@deepseek-ai/dsh-community-plugin-catalog',
  '@deepseek-ai/dsh-community-skill-catalog',
  '@deepseek-ai/dsh-file-recognizer-office',
  '@deepseek-ai/dsh-model-catalog',
  '@deepseek-ai/dsh-copy-session-id',
  '@deepseek-ai/dsh-turn-process-shimmer',
  '@deepseek-ai/dsh-session-archive',
  '@deepseek-ai/dsh-lark-integration',
] as const

/** Pending offer or completed explicit choice for one Desktop profile. */
export interface DesktopProfileMigrationState {
  readonly eligible: boolean
  readonly complete: boolean
  readonly selected: readonly string[]
  readonly candidates: readonly string[]
  readonly warning?: string
}
