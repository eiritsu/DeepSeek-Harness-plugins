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

Each row gives the source directory for reading the code and the exact install URL to copy. These five are the `0.2.0-rc.2` plugins this repository maintains and publishes on their own; historical experimental packages are not listed as current standalone install items. All five have version `0.2.0-rc.2`.

| Add-on | Package | Feature and surface | Source (browsing only) | Install URL |
|---|---|---|---|---|
| Calendar | `@deepseek-ai/dsh-calendar` | Calendar view over Schedule automations, local entries, and user-supplied iCalendar subscriptions; Web and Desktop | <https://github.com/eiritsu/DeepSeek-Harness-plugins/tree/main/packages/bundle/calendar> | <https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.0-rc.2.20261008.2/deepseek-ai-dsh-calendar-0.2.0-rc.2.tgz> |
| Community plugin catalog | `@deepseek-ai/dsh-community-plugin-catalog` | Browse and install community plugin packages; Web and Desktop | <https://github.com/eiritsu/DeepSeek-Harness-plugins/tree/main/packages/bundle/community-plugin-catalog> | <https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.0-rc.2.20261008.2/deepseek-ai-dsh-community-plugin-catalog-0.2.0-rc.2.tgz> |
| Community skill catalog | `@deepseek-ai/dsh-community-skill-catalog` | Search SkillsMP and install GitHub skills pinned to a commit; Web and Desktop | <https://github.com/eiritsu/DeepSeek-Harness-plugins/tree/main/packages/bundle/community-skill-catalog> | <https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.0-rc.2.20261008.2/deepseek-ai-dsh-community-skill-catalog-0.2.0-rc.2.tgz> |
| Lark and Feishu integration | `@deepseek-ai/dsh-lark-integration` | Route authorized private messages to Harness Sessions and configure the connection; Web and Desktop | <https://github.com/eiritsu/DeepSeek-Harness-plugins/tree/main/packages/bundle/lark-integration> | <https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.0-rc.2.20261008.2/deepseek-ai-dsh-lark-integration-0.2.0-rc.2.tgz> |
| Tools and connections | `@deepseek-ai/dsh-tools-connections` | Add Brave and Tavily search providers, Firecrawl extraction, and settings; Web and Desktop | <https://github.com/eiritsu/DeepSeek-Harness-plugins/tree/main/packages/bundle/tools-connections> | <https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.0-rc.2.20261008.2/deepseek-ai-dsh-tools-connections-0.2.0-rc.2.tgz> |

The `base`, `web-app`, `headless`, `sdk-app`, `sdk-minimal`, and `acp-app` bundles are application profile templates and are not listed as add-ons.

## Compatibility and package contents

The supported target for these plugins is Eiritsu's Web/Desktop distribution with Harness runtime base and plugin package version `0.2.0-rc.2`; release tag `v0.2.0-rc.2.20261008.2` does not change that compatibility version. The currently published Electron installer has shell `buildVersion` `0.2.0-rc.2.20261001.1` and is compatible when its bundled runtime base and plugin packages are `0.2.0-rc.2`. Keep the profile bundles and Harness runtime packages on that same base version. Users with an older Lark integration installed must uninstall it, then reinstall from [the Lark asset in this Release](https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.0-rc.2.20261008.2/deepseek-ai-dsh-lark-integration-0.2.0-rc.2.tgz). Public Harness APIs are pre-stable, and the plugins here use APIs added by this distribution; an unmodified upstream build is not sufficient.

Release assets contain the built JavaScript, type declarations, `cordis.patch.yml`, and declared runtime assets selected by each package's `files` manifest. They do not contain the monorepo checkout or development dependencies.

## Source and license

The source packages are maintained in this repository under the paths listed above and are based on the DeepSeek Harness plugin architecture. Individual package READMEs document their configuration, behavior, and limitations. Each package is licensed under MIT; see [LICENSE](LICENSE) and the package notices for third-party terms.
