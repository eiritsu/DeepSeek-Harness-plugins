---
description: "Optional External Tools: Brave and Tavily search providers plus Firecrawl extraction, with credential controls on the Plugins settings page."
kind: "package-bundle"
---

# @deepseek-ai/dsh-tools-connections

English | [中文](README.zh.md)

## Summary

This optional External Tools bundle adds Brave Search and Tavily to the existing `ctx.web` provider registry, registers the Firecrawl `firecrawl_extract` tool, and adds a Tools & connections card to the Plugins settings page. The card stores API keys through the credentials service and configures each provider, including Firecrawl extraction. Native provider selection remains the explicit `web.searchProvider` profile setting.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Install `@deepseek-ai/dsh-tools-connections` in a Web profile through Plugin Manager or `dsh plugin --profile <name> add @deepseek-ai/dsh-tools-connections`. Enable it, open its own page under **Plugins**, and enter each provider key there. To use one for native search, explicitly set `web.searchProvider: brave` or `web.searchProvider: tavily` in the Web profile's existing configuration.

The bundle requires the existing `web`, `credentials`, `tools`, and Client settings services. A search provider is unavailable while disabled, its endpoint is invalid, or its credential is absent; the Firecrawl tool is offered only while `firecrawlEnabled` is true. Blank key drafts preserve the stored key. Firecrawl settings are volatile and update the registered tool in place after save. Uninstalling the bundle does not delete settings or credentials.

GitHub Code Search, Exa, Perplexity, and MCP use their existing optional plugins and settings. Install or configure those through Plugin Manager; this bundle does not report their connection state.

### Configuration

| Field | Default | Meaning |
|---|---|---|
| `braveEnabled` | `false` | Whether Brave may serve native web search |
| `braveApiKeyRef` | `BRAVE_SEARCH_API_KEY` | Credential reference containing the Brave API key |
| `braveBaseURL` | `https://api.search.brave.com` | Brave Search API origin |
| `tavilyEnabled` | `false` | Whether Tavily may serve native web search |
| `tavilyApiKeyRef` | `TAVILY_API_KEY` | Credential reference containing the Tavily API key |
| `tavilyBaseURL` | `https://api.tavily.com` | Tavily Search API origin |
| `maxResults` | `5` | Sources requested per provider call, from 1 through 20 |
| `firecrawlEnabled` | `false` | Whether `firecrawl_extract` is offered to the model |
| `firecrawlApiKeyRef` | `FIRECRAWL_API_KEY` | Credential reference containing the Firecrawl API key |
| `firecrawlBaseURL` | `https://api.firecrawl.dev` | Firecrawl endpoint base; `/v1/scrape` is appended |
| `firecrawlRequestTimeoutMs` | `30000` | Cooperative tool-call budget for one Firecrawl request |
| `firecrawlMaxResponseBytes` | `2097152` | Response bytes read from Firecrawl before JSON parsing |
| `firecrawlMaxMarkdownChars` | `50000` | Markdown code points returned to the model |

<a id="understand-the-implementation"></a>
## Understand the implementation

The Host registers two independent providers with stable ids `brave` and `tavily`. Both adapt their vendor response to `ctx.web` results; the existing `dsh-tool-web` owns the `web_search` schema and result presentation. The same Host entry registers the `firecrawl_extract` tool, which resolves its credential per call, reads at most `firecrawlMaxResponseBytes` before parsing the response, and truncates the returned Markdown at `firecrawlMaxMarkdownChars` code points. A volatile config update replaces the registration so its endpoint, credential reference, byte/code-point caps, and tool timeout take effect together. The Client form uses official ConfigForms and credentials RPCs. Settings stay in the plugin configuration; credential literals are sent only to the credentials service.

<a id="further-exploration"></a>
## Further Exploration

- [Web service](../../web/web/README.md) — provider registration and explicit selection rules.
- [Tool catalog](../../../docs/tool-catalog.md) — the `firecrawl_extract` schema and result.
- [Profile composition](../../../docs/architecture.md#profiles-and-bundles) — bundle installation and profile ownership.

<a id="model-experience"></a>
## Model Experience

### Native web search

#### What the model sees

The existing [`web_search` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-web) is unchanged. Its result contains normalized, citeable sources from the provider selected in the `web` configuration.

#### Token effect

This bundle adds no tool schema. A search call adds its query and provider result to the conversation.

#### KV Cache effect

Provider settings do not change the request prefix. Provider selection changes search results only; the existing schema remains stable while `dsh-tool-web` stays mounted consistently.

### Firecrawl extraction

#### What the model sees

While `firecrawlEnabled` is true, the model may call [`firecrawl_extract`](../../../docs/tool-catalog.md#deepseek-aidsh-tools-connections) with a URL and optional format options. Its result carries the scraped Markdown and a `truncated` flag that reports whether `firecrawlMaxMarkdownChars` cut the document.

#### Token effect

Enabling the tool adds its schema to the request prefix. Each call adds its URL and the returned Markdown to the conversation; the code-point cap bounds the largest of those additions.

#### KV Cache effect

The tool schema is stable across calls and does not change with the Firecrawl endpoint or credential reference, so configuration edits leave earlier prefixes cacheable.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

No runtime invariant companion is published because this bundle exposes no independent runtime relationship that can diverge.

- Brave and Tavily are search providers only; provider-specific search tools are not added.
- Provider selection follows `dsh-web`'s explicit `searchProvider` setting. The bundle does not add fallback or priority routing.
- Firecrawl extraction covers one URL per call and offers no crawl map, batch, or site search.
- GitHub Code Search, Exa, Perplexity, and MCP status remain owned by their official packages.

<a id="dev-note"></a>
### Dev Note

The bundle contains both Host and Client entries. Build both faces before packing; verify the tarball with the package's packed-artifact smoke.
