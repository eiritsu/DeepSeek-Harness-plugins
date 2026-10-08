/** Host SkillsMP Remote supplied by this standalone bundle. */
import type { Plugin } from '@deepseek-ai/cordis'
import { SkillsMpCatalog } from './host/skillsmp-catalog.ts'

/** Loader namespace: the SkillsMP Remote registered under its own name. */
const plugin: Plugin = SkillsMpCatalog

export default plugin
