/** Host SkillHub Remote supplied by this standalone bundle. */
import type { Plugin } from '@deepseek-ai/cordis'
import { SkillHubCatalog } from './host/skillhub-catalog.ts'

/** Loader namespace: the SkillHub Remote registered under its own name. */
const plugin: Plugin = SkillHubCatalog

export default plugin
