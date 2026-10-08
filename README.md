# DeepSeek Harness Plugins

English | [中文](README.zh.md)

This repository distributes optional DeepSeek Harness plugins maintained by Eiritsu. The packages are built for Eiritsu's `@deepseek-ai/dsh` **0.2.0-rc.2** distribution; they are not compatible with an unmodified upstream build unless a package says otherwise. Install only packages that match the exact Harness release you run.

## Install a plugin

Every published bundle below has a Release install URL in the last column. Copy that URL and paste it into **Plugins → Install** in the Web or Desktop app, which installs it as given. The Source column is for reading code: a GitHub directory URL is neither a git repository nor a tarball, so the installer rejects it. The current skill catalog installs from:

```text
https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.0-rc.2.20261008.2/deepseek-ai-dsh-community-skill-catalog-0.2.0-rc.2.tgz
```

Quit and reopen the app after updating an installed bundle: an open app keeps serving what it loaded before the update. Desktop installs and updates bundles from its own Plugins page, and the CLI form below applies only to profiles the CLI manages:

```sh
dsh plugin --profile <profile> add /absolute/path/to/<asset-file>
```

`dsh plugin` forwards package operations to the profile's pnpm. If adding a Release URL fails with `ERR_PNPM_MISSING_TARBALL_INTEGRITY`, pnpm has encountered a tarball lockfile entry without integrity; install the downloaded local file instead.

After installation, enable the bundle in **Plugins**. UI bundles use the shared Web Client, so they run in both the matching Web app and Desktop app unless the table marks a narrower scope. Headless profiles can use Host-only bundles but cannot display Client UI.

For development from a full source checkout, build the checkout first, then link the package directory into a CLI-managed profile:

```sh
pnpm install
pnpm run build
dsh plugin --profile <profile> add /absolute/path/to/DeepSeek-Harness-plugins/<source-package-path>
```

A local directory install links the checkout; keep that checkout available while the profile uses it. Packaged Desktop users should install a Release asset through the Desktop Plugins page.

## Run

Use the full source checkout to launch the Web application. The [Web UI guide](docs/user/guide/index.md) covers normal use.

### Run from source

```sh
git clone https://github.com/eiritsu/DeepSeek-Harness-plugins.git
cd DeepSeek-Harness-plugins
pnpm install
pnpm run build
pnpm dsh web
```

## Installable bundles

Each row gives the source directory for reading the code and the exact install URL to copy. The table lists 14 distinct plugin packages: the 13 from the first Release plus Calendar. All bundle packages in this table have version `0.2.0-rc.2`.

| Add-on | Package | Feature and surface | Source (browsing only) | Install URL |
|---|---|---|---|---|
| Calendar | `@deepseek-ai/dsh-calendar` | Calendar view over Schedule automations, local entries, and user-supplied iCalendar subscriptions; Web and Desktop | <https://github.com/eiritsu/DeepSeek-Harness-plugins/tree/main/packages/bundle/calendar> | <https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.0-rc.2.20261008.2/deepseek-ai-dsh-calendar-0.2.0-rc.2.tgz> |
| Office file recognition | `@deepseek-ai/dsh-file-recognizer-office` | Local DOCX, PPTX, XLSX, OpenDocument and PDF text extraction, optional OCR; Web and Desktop with this distribution's native-file upload API | <https://github.com/eiritsu/DeepSeek-Harness-plugins/tree/main/packages/attachment/file-recognizer-office> | <https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.0-rc.2.20261008.2/deepseek-ai-dsh-file-recognizer-office-0.2.0-rc.2.tgz> |
| Community plugin catalog | `@deepseek-ai/dsh-community-plugin-catalog` | Browse and install community plugin packages; Web and Desktop | <https://github.com/eiritsu/DeepSeek-Harness-plugins/tree/main/packages/bundle/community-plugin-catalog> | <https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.0-rc.2.20261008.2/deepseek-ai-dsh-community-plugin-catalog-0.2.0-rc.2.tgz> |
| Community skill catalog | `@deepseek-ai/dsh-community-skill-catalog` | Search SkillsMP and install GitHub skills pinned to a commit; Web and Desktop | <https://github.com/eiritsu/DeepSeek-Harness-plugins/tree/main/packages/bundle/community-skill-catalog> | <https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.0-rc.2.20261008.2/deepseek-ai-dsh-community-skill-catalog-0.2.0-rc.2.tgz> |
| Configuration and skills backup | `@deepseek-ai/dsh-configuration-and-skills-backup` | Export profile configuration and selected skills; Web and Desktop | <https://github.com/eiritsu/DeepSeek-Harness-plugins/tree/main/packages/bundle/configuration-and-skills-backup> | <https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.0-rc.2.20261008.2/deepseek-ai-dsh-configuration-and-skills-backup-0.2.0-rc.2.tgz> |
| Copy Session ID | `@deepseek-ai/dsh-copy-session-id` | Add a copy action to the conversation header; Web and Desktop | <https://github.com/eiritsu/DeepSeek-Harness-plugins/tree/main/packages/bundle/copy-session-id> | <https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.0-rc.2.20261008.2/deepseek-ai-dsh-copy-session-id-0.2.0-rc.2.tgz> |
| Desktop profile migration | `@deepseek-ai/dsh-desktop-profile-migration-bundle` | Select installed feature bundles in Desktop profile settings; Desktop only | <https://github.com/eiritsu/DeepSeek-Harness-plugins/tree/main/packages/bundle/desktop-profile-migration> | <https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.0-rc.2.20261008.2/deepseek-ai-dsh-desktop-profile-migration-bundle-0.2.0-rc.2.tgz> |
| Lark and Feishu integration | `@deepseek-ai/dsh-lark-integration` | Route authorized private messages to Harness Sessions and configure the connection; Web and Desktop | <https://github.com/eiritsu/DeepSeek-Harness-plugins/tree/main/packages/bundle/lark-integration> | <https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.0-rc.2.20261008.2/deepseek-ai-dsh-lark-integration-0.2.0-rc.2.tgz> |
| Edit and resend a message | `@deepseek-ai/dsh-session-message-edit-resend` | Edit the latest eligible user message in the same Session; Web and Desktop, requires matching `0.2.0-rc.2` Agent APIs | <https://github.com/eiritsu/DeepSeek-Harness-plugins/tree/main/packages/bundle/session-message-edit-resend> | <https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.0-rc.2.20261008.2/deepseek-ai-dsh-session-message-edit-resend-0.2.0-rc.2.tgz> |
| Tools and connections | `@deepseek-ai/dsh-tools-connections` | Add Brave and Tavily search providers, Firecrawl extraction, and settings; Web and Desktop | <https://github.com/eiritsu/DeepSeek-Harness-plugins/tree/main/packages/bundle/tools-connections> | <https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.0-rc.2.20261008.2/deepseek-ai-dsh-tools-connections-0.2.0-rc.2.tgz> |
| Turn process shimmer | `@deepseek-ai/dsh-turn-process-shimmer` | Replace the running-label renderer with a reduced-motion-aware shimmer; Web and Desktop | <https://github.com/eiritsu/DeepSeek-Harness-plugins/tree/main/packages/bundle/turn-process-shimmer> | <https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.0-rc.2.20261008.2/deepseek-ai-dsh-turn-process-shimmer-0.2.0-rc.2.tgz> |
| Native computer use (experimental) | `@deepseek-ai/dsh-experimental-computer-use-cua-native` | Add the native CUA provider; Web profile on a host with the required desktop permissions | <https://github.com/eiritsu/DeepSeek-Harness-plugins/tree/main/packages/experimental/computer-use-cua-native> | <https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.0-rc.2.20261008.2/deepseek-ai-dsh-experimental-computer-use-cua-native-0.2.0-rc.2.tgz> |
| Model catalog | `@deepseek-ai/dsh-model-catalog` | Refresh model metadata from models.dev; Host only, no UI | <https://github.com/eiritsu/DeepSeek-Harness-plugins/tree/main/packages/llm/model-catalog> | <https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.0-rc.2.20261008.2/deepseek-ai-dsh-model-catalog-0.2.0-rc.2.tgz> |
| Session archive | `@deepseek-ai/dsh-session-archive` | Export and restore Sessions and their referenced attachments; Web and Desktop | <https://github.com/eiritsu/DeepSeek-Harness-plugins/tree/main/packages/session-query/session-archive> | <https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.0-rc.2.20261008.2/deepseek-ai-dsh-session-archive-0.2.0-rc.2.tgz> |

The Desktop profile already composes its Desktop-specific persistence layer. The matching source component is `packages/experimental/desktop-app`; it is part of the Desktop distribution and must not be installed separately. The `base`, `web-app`, `headless`, `sdk-app`, `sdk-minimal`, and `acp-app` bundles are application profile templates and are not listed as add-ons.

## Supporting packages

These versioned packages support a bundle or profile composition and are not independent Plugin Manager installation entries:

| Package | Source package | Used by |
|---|---|---|
| `@deepseek-ai/dsh-session-persistence-sqlite` (`0.2.0-rc.2`) | `packages/session/session-persistence-sqlite` | The experimental Desktop profile composition |
| `@deepseek-ai/dsh-web-github-code-search` (`0.2.0-rc.2`) | `packages/web/web-github-code-search` | Optional profile composition that explicitly mounts GitHub code search |

## Compatibility and package contents

The supported target for this patch is Eiritsu's Web/Desktop distribution with Harness runtime base and plugin package version `0.2.0-rc.2`; release tag `v0.2.0-rc.2.20261008.2` does not change that compatibility version. The currently published Electron installer has shell `buildVersion` `0.2.0-rc.2.20261001.1` and is compatible when its bundled runtime base and plugin packages are `0.2.0-rc.2`. Keep the profile bundles and Harness runtime packages on that same base version. Users with an older Lark integration installed must uninstall it, then reinstall from [the Lark asset in this Release](https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.0-rc.2.20261008.2/deepseek-ai-dsh-lark-integration-0.2.0-rc.2.tgz). Public Harness APIs are pre-stable, and some features use APIs added by this distribution. For example, Office file recognition uses its native-file upload policy API, and Edit and resend uses the matching Agent and Agent Loop packages. An upstream build with the same version string is not sufficient if it lacks those additions.

Release assets contain the built JavaScript, type declarations, `cordis.patch.yml`, and declared runtime assets selected by each package's `files` manifest. They do not contain the monorepo checkout or development dependencies. The two supporting packages are resolved as bundle dependencies when needed; they should not be installed by users as standalone features.

## Source and license

The source packages are maintained in this repository under the paths listed above and are based on the DeepSeek Harness plugin architecture. Individual package READMEs document their configuration, behavior, and limitations. Each package is licensed under MIT; see [LICENSE](LICENSE) and the package notices for third-party terms.
