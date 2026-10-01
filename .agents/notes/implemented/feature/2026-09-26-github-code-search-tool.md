# Agent Note: GitHub code search as an optional tool

Status: implemented

English | [中文](2026-09-26-github-code-search-tool.zh.md)

## Problem

The previous external-tools extension supplied a GitHub code search tool, while rc2's GitHub webhook adapter handles inbound events and its `ctx.web` service searches general web providers.

## Decision

`@deepseek-ai/dsh-web-github-code-search` registers `github_code_search` through `ctx.tools` and resolves its token through `ctx.credentials` for each call. It stays opt-in and returns a bounded projection of GitHub's code-search results. The package does not add a provider to `ctx.web`, restore the external-tools aggregator, or ship a private settings page.

## Alternatives considered

**Reuse GitHub webhook support.** Rejected because webhook support receives signed inbound deliveries; it does not issue authenticated code-search requests.

**Register GitHub as a `ctx.web` provider.** Rejected because `ctx.web` serves general web search and fetch; GitHub code search has a separate model-facing schema and result contract.

**Restore the old external-tools package.** Rejected because one optional model tool does not justify reintroducing its provider catalog, settings UI, or unrelated providers.

## Consequences

Deployments mount the package only where code search is needed and manage `GITHUB_TOKEN` with the existing credentials provider. The tool's calls and results use standard session tool events. Search availability follows GitHub's index and token access rules; this package does not manage issues, pull requests, commits, or local repositories.
