# Agent Note: Firecrawl extraction as an optional tool

Status: implemented

English | [中文](2026-09-26-firecrawl-extraction-plugin.zh.md)

## Problem

The rc2 web capability searches and fetches pages, while some model workflows need a vendor extraction result with converted Markdown and metadata.

## Decision

`@deepseek-ai/dsh-web-extract-firecrawl` contributes `firecrawl_extract` as an opt-in Cordis Host plugin. It resolves `FIRECRAWL_API_KEY` through `ctx.credentials` per call, caps Firecrawl response bytes before JSON parsing, truncates returned Markdown at a configured code-point limit, and includes a `truncated` flag. The existing tools pipeline owns model visibility and session persistence; the package does not change `ctx.web`, core, or default profiles.

## Alternatives considered

**Replace `web_fetch` with Firecrawl.** Rejected because deployments may want the existing HTTP fetch behavior alongside Firecrawl's extraction API.

**Add Firecrawl to the existing search provider packages.** Rejected because scrape extraction is a separate model tool and does not implement the `ctx.web` search provider API.

## Consequences

Deployments opt in by mounting the package and storing the credential reference's value through the credentials provider. The request timeout, response-byte bound, and Markdown character bound are composition settings. GitHub code search is a separate optional `ctx.tools` package because it is not a `ctx.web` search provider; Brave, Tavily, and Exa are covered by rc2's native search providers. The old catalog's FAL, ElevenLabs, and Browserbase entries had no tool implementation to carry forward.
