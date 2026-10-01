/** Host entry for the optional External Tools bundle. */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import Schema from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-web'
import { register as registerFirecrawl } from './host/firecrawl.ts'
import type { Config as FirecrawlConfig } from './host/firecrawl.ts'
import { BraveSearchProvider, TavilySearchProvider } from './provider.ts'

/** Mutable settings saved under this plugin's configuration namespace. */
export interface Config {
  /** Whether Brave may serve native web search. */
  braveEnabled: Volatile<boolean>
  /** Credential reference containing the Brave API key. */
  braveApiKeyRef: Volatile<string>
  /** Brave Search API origin. */
  braveBaseURL: Volatile<string>
  /** Whether Tavily may serve native web search. */
  tavilyEnabled: Volatile<boolean>
  /** Credential reference containing the Tavily API key. */
  tavilyApiKeyRef: Volatile<string>
  /** Tavily Search API origin. */
  tavilyBaseURL: Volatile<string>
  /** Maximum number of sources requested from the provider. */
  maxResults: Volatile<number>
  /** Whether Firecrawl extraction is available to the model. */
  firecrawlEnabled: Volatile<boolean>
  /** Credential reference containing the Firecrawl API key. */
  firecrawlApiKeyRef: Volatile<string>
  /** Firecrawl endpoint base; `/v1/scrape` is appended. */
  firecrawlBaseURL: Volatile<string>
  /** Cooperative tool-call budget for one Firecrawl request. */
  firecrawlRequestTimeoutMs: Volatile<number>
  /** Maximum response bytes read from Firecrawl. */
  firecrawlMaxResponseBytes: Volatile<number>
  /** Maximum Markdown code points returned to the model. */
  firecrawlMaxMarkdownChars: Volatile<number>
}

/** Persisted, secret-free provider configuration. */
export const Config = Schema.object({
  braveEnabled: Schema.boolean().default(false).volatile(),
  braveApiKeyRef: Schema.string().role('credential-ref').default('BRAVE_SEARCH_API_KEY').volatile(),
  braveBaseURL: Schema.string().default('https://api.search.brave.com').volatile(),
  tavilyEnabled: Schema.boolean().default(false).volatile(),
  tavilyApiKeyRef: Schema.string().role('credential-ref').default('TAVILY_API_KEY').volatile(),
  tavilyBaseURL: Schema.string().default('https://api.tavily.com').volatile(),
  maxResults: Schema.number().step(1).min(1).max(20).default(5).volatile(),
  firecrawlEnabled: Schema.boolean().default(false).volatile(),
  firecrawlApiKeyRef: Schema.string().role('credential-ref').default('FIRECRAWL_API_KEY').volatile(),
  firecrawlBaseURL: Schema.string().default('https://api.firecrawl.dev').volatile(),
  firecrawlRequestTimeoutMs: Schema.number().step(1).min(1000).max(120000).default(30000).volatile(),
  firecrawlMaxResponseBytes: Schema.number().step(1).min(1024).max(16 * 1024 * 1024).default(2 * 1024 * 1024).volatile(),
  firecrawlMaxMarkdownChars: Schema.number().step(1).min(256).max(500_000).default(50_000).volatile(),
})

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'tools-connections'
/** Services required to serve web searches and register the Firecrawl extraction tool. */
export const inject = ['web', 'credentials', 'tools']

/** Register the credential-backed providers: web search plus Firecrawl extraction. */
export function apply(ctx: Context, config: Config): void {
  const common = { credentials: ctx.credentials, credentialRef, maxResults: () => config.maxResults.get() }
  ctx.web.registerSearchProvider(new BraveSearchProvider({
    ...common,
    enabled: () => config.braveEnabled.get(), keyRef: () => config.braveApiKeyRef.get(),
    baseURL: () => config.braveBaseURL.get(),
  }))
  ctx.web.registerSearchProvider(new TavilySearchProvider({
    ...common,
    enabled: () => config.tavilyEnabled.get(), keyRef: () => config.tavilyApiKeyRef.get(),
    baseURL: () => config.tavilyBaseURL.get(),
  }))
  const firecrawl = (): Required<FirecrawlConfig> => ({
    enabled: config.firecrawlEnabled.get(), apiKeyRef: config.firecrawlApiKeyRef.get(),
    baseURL: config.firecrawlBaseURL.get(), requestTimeoutMs: config.firecrawlRequestTimeoutMs.get(),
    maxResponseBytes: config.firecrawlMaxResponseBytes.get(), maxMarkdownChars: config.firecrawlMaxMarkdownChars.get(),
  })
  ctx.effect(() => {
    let disposeTool: (() => void) | undefined
    const sync = (): void => {
      disposeTool?.()
      disposeTool = undefined
      const current = firecrawl()
      if (current.enabled) disposeTool = registerFirecrawl(ctx, current)
    }
    const stop = ctx.on('loader/volatile-update', sync)
    sync()
    return () => { stop(); disposeTool?.() }
  }, 'Firecrawl extraction tool')
}
