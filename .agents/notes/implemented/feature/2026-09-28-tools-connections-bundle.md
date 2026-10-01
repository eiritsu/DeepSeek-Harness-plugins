# Agent Note: Tools and connections providers as an optional bundle

Status: implemented

English | [中文](2026-09-28-tools-connections-bundle.zh.md)

## Problem

The rc2 Web service has no Brave or Tavily provider, while older UI code does not match the current credentials, settings, and provider selection APIs.

## Decision

`@deepseek-ai/dsh-tools-connections` registers Brave and Tavily independently with `ctx.web`, provides a Client card through the Plugins settings slot, and stores keys through `ctx.remote.credentials`. The card configures each provider; native provider selection remains the explicit `web.searchProvider` profile setting because the existing settings form API does not write that non-volatile field. Each provider reads its enabled setting, endpoint, and credential reference at use time. The bundle adds no provider-specific model tools and does not change core or default profile rows.

GitHub Code Search and Firecrawl extraction remain their existing optional packages. Exa and Perplexity remain their existing `ctx.web` providers. Users install and configure each through Plugin Manager; this bundle does not infer their connection state.

## Alternatives considered

**Add one hidden router that selects the first configured provider.** Rejected because `dsh-web` requires explicit selection when multiple providers are usable and does not promise priority fallback.

**Add Brave and Tavily model tools.** Rejected because `dsh-tool-web` already owns the native `web_search` tool and both providers implement its existing service interface.

**Reimplement GitHub or Firecrawl controls.** Rejected because rc2 already ships independent packages for both capabilities.

## Consequences

Users explicitly select Brave or Tavily as the `web` search provider in profile configuration and enable it in this bundle's settings. Keys are never written to the settings document. Disabling or uninstalling the bundle leaves settings and credential records intact; a `web.searchProvider` value that names an unmounted provider follows the existing configured-provider error behavior.

The bundle does not add provider health checks, connection probes, or fallback routing. Other provider settings and MCP server lifecycle remain owned by their existing packages.
