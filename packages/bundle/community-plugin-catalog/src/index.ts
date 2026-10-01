/** Host catalog Remote supplied by this standalone bundle. */
import type { Plugin } from '@deepseek-ai/cordis'
import { PluginCatalog } from './host/plugin-catalog.ts'

/** Loader namespace: the catalog Remote registered under its own name. */
const plugin: Plugin = PluginCatalog

export default plugin
