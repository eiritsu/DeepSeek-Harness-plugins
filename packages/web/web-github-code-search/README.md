---
description: "Optional GitHub code search tool that returns bounded, selected matches through the standard tools and credentials services."
kind: "package-reference"
---

# @deepseek-ai/dsh-web-github-code-search

English | [中文](README.zh.md)

## Summary

`dsh-web-github-code-search` registers the optional `github_code_search` model tool. It queries GitHub's code search API and returns selected repository, path, URL, and snippet fields. It does not replace `ctx.web` search, manage repositories, or receive webhooks.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Behavior](#behavior)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this Host plugin only in a composition that needs GitHub code search. The composition must provide `ctx.tools` and `ctx.credentials`; mount the timeout policy too when `requestTimeoutMs` should be enforced. This package is not included in a shipped default profile.

```yaml
- name: '@deepseek-ai/dsh-tools'
- name: '@deepseek-ai/dsh-credentials'
- name: '@deepseek-ai/dsh-credentials-local'
- name: '@deepseek-ai/dsh-tool-call-timeout-policy'
- name: '@deepseek-ai/dsh-web-github-code-search'
```

Configure `GITHUB_TOKEN` through the existing Credentials settings page or credential provider. The package resolves the reference on every tool call, so credential rotation applies without restarting the plugin. It stores only the reference name in plugin configuration.

| Field | Default | Meaning |
|---|---|---|
| `apiKeyRef` | `GITHUB_TOKEN` | Credential reference resolved for each search |
| `baseURL` | `https://api.github.com/` | HTTPS REST API base; GitHub Enterprise Server may use a base ending in `/api/v3/` |
| `requestTimeoutMs` | `30000` | Tool-call deadline, also passed to `fetch` through its abort signal |
| `maxResponseBytes` | `2097152` | Maximum response bytes read before JSON parsing |
| `maxSnippets` | `20` | Maximum text-match snippets returned across one tool result |
| `maxSnippetChars` | `2000` | Maximum Unicode code points retained from one snippet |
| `maxTotalSnippetChars` | `8000` | Maximum Unicode code points retained across all snippets |
| `maxResults` | `5` | Default result count, up to GitHub's 100-result request limit |

The Host Config declaration is in [`src/index.ts`](src/index.ts).

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin adapts GitHub's code-search response to a small JSON result and delegates tool call logging to `ctx.tools`. It resolves credentials at execution time and reads the response under a byte cap before parsing.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Cordis entry, request validation, GitHub API call, response projection |

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Tools subsystem](../../../docs/subsystems/tools.md) — tool registration, execution, and Session events.
- [Credentials package](../../credentials/credentials/README.md) — credential references and providers.
- [Timeout policy package](../../guard/timeout-policy/README.md) — enforcement for a tool's declared timeout.
- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-web-github-code-search) — the model-visible schema.

<a id="behavior"></a>
## Behavior

The tool sends `GET search/code` with the query and `per_page`, GitHub's text-match accept header, API version `2022-11-28`, and the configured bearer token. Redirects fail rather than forwarding credentials. The response reader enforces the configured byte limit before parsing; only name, path, file URL, repository name/URL, and available text-match fragments are returned. HTTP failures omit the upstream body. `requestTimeoutMs` is declarative and takes effect only when the composition mounts `dsh-tool-call-timeout-policy`.

The tool rejects empty queries and result counts outside 1–100. A missing credential, failed request, unsuccessful status, oversized body, invalid UTF-8, or invalid JSON becomes a tool error. Request cancellation reaches the HTTP request and response reader. `maxResponseBytes` limits the upstream body; the three snippet settings separately limit how much matched code enters model-visible output, counted in Unicode code points. Code and snippets are untrusted data and must not be treated as instructions.

<a id="model-experience"></a>
## Model Experience

### `github_code_search`

#### What the model sees

The model sees one required `query` and an optional `maxResults` from 1 to 100. A result contains `totalCount` and selected `results`; each result may include code-match snippets. The complete call and result use the standard `tool/call` and `tool/result` session events. See the generated [tool schema](../../../docs/tool-catalog.md#deepseek-aidsh-web-github-code-search).

#### Token effect

Mounting the plugin adds its schema to requests that include the tool. A call adds the query and selected response fields to session history; returned snippets are bounded independently by `maxSnippets`, `maxSnippetChars`, and `maxTotalSnippetChars`.

#### KV Cache effect

The schema remains stable while the plugin configuration and tool description remain unchanged. Search calls append arguments and results after the reusable request prefix.

## Known Limitations and Deferred Work

No runtime invariant companion is published because this package has no independently observable runtime relationship that can diverge.

<a id="known-limitations-and-deferred-work"></a>

- Results depend on GitHub's code-search indexing and access rules for the configured token.
- The tool searches code only; it does not inspect issues, pull requests, commits, or local repositories.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`tests/github-code-search.spec.ts` mounts the plugin with the local credential provider and stubs GitHub API responses, so tests require neither a token nor external network access. A loopback HTTP fixture verifies that native fetch rejects redirects before contacting the target. The suite also checks credential rotation, output projection, cancellation, response limits, and deregistration.

</details>
