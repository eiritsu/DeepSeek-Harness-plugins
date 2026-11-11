/** Host dual-source skill catalog Remote supplied by this standalone bundle. */
import type { Plugin } from '@deepseek-ai/cordis'
import { SkillCatalog } from './host/skill-catalog.ts'

/** Loader namespace: the skill catalog Remote registered under its own name. */
const plugin: Plugin = SkillCatalog

export default plugin
