# DeepSeek Harness 插件

[English](README.md) | 中文

本仓库由 Eiritsu 维护，用于分发 DeepSeek Harness 可选插件。软件包适配 `@deepseek-ai/dsh`，并完整支持 **0.2.2-rc.1**、**0.2.2-alpha.2**、**0.2.1-rc.5**、**0.2.1-rc.3** 以及 **0.2.1-alpha.1** 与 **0.2.1-alpha.2** 发行版（`>=0.2.0-rc.2 <0.3.0`）；除非某个插件另有说明，否则不能与未修改的上游构建兼容。请安装与支持的 Harness 发行版相匹配的插件。

## 安装插件

下表每个已发布插件的最后一列都是 Release 安装 URL。复制该 URL，粘贴到 Web 或 Desktop 应用的 **Plugins → Install**，安装器会按原样安装。Source 列用于阅读源码：GitHub 目录 URL 既不是 git 仓库也不是 tarball，安装器会拒绝它。

更新已安装的插件后请退出并重新打开应用：已打开的应用会继续提供更新前加载的版本。Desktop 通过自身的 Plugins 页面安装和更新插件；下面的 CLI 形式只适用于由 CLI 管理的 profile：

```sh
dsh plugin --profile <profile> add /absolute/path/to/<asset-file>
```

`dsh plugin` 会将包操作转交给 profile 使用的 pnpm。如果添加 Release URL 时出现 `ERR_PNPM_MISSING_TARBALL_INTEGRITY`，表示 pnpm 遇到缺少 integrity 的 tarball lockfile 记录；请改为安装已下载的本地文件。

安装后，请在 **Plugins** 中启用组合包。UI 插件使用共享的 Web Client，因此除表格注明的特殊范围外，它们都可用于匹配版本的 Web 和 Desktop 应用。Headless profile 可以使用仅含 Host 的插件，但无法显示 Client UI。

从完整源码工作树进行开发时，请先构建工作树，再将软件包目录链接到由 CLI 管理的 profile：

```sh
pnpm install
pnpm run build
dsh plugin --profile <profile> add /absolute/path/to/DeepSeek-Harness-plugins/<source-package-path>
```

本地目录安装会链接源码工作树；profile 使用期间请保留该工作树。已打包的 Desktop 用户应通过 Desktop 的 Plugins 页面安装 Release 资源。

<a id="run"></a>

## 运行

请使用完整源码工作树启动 Web 应用。正常使用方法见 [Web UI 指南](docs/user/guide/index.zh.md)。

<a id="run-from-source"></a>

### 从源码运行

```sh
git clone https://github.com/eiritsu/DeepSeek-Harness-plugins.git
cd DeepSeek-Harness-plugins
pnpm install
pnpm run build
pnpm dsh web
```

## 可安装组合包

每行列出用于阅读源码的源码目录和可直接复制的安装 URL。以下六个是本仓库自行维护并单独发布的插件，同时兼容 `0.2.2-rc.1`、`0.2.2-alpha.2`、`0.2.1-rc.5`、`0.2.1-rc.3` 以及 `0.2.1-alpha.1` 与 `0.2.1-alpha.2`；因 SkillsMP 站点访问限制，已撤回 `@deepseek-ai/dsh-community-skill-catalog` 的发行包；历史实验包不再列为当前的独立安装项。六个插件的版本均为 `0.2.2-rc.1`。

| 插件 | npm 包 | 功能和界面 | 源码（仅浏览） | 安装 URL |
|---|---|---|---|---|
| Superagent 超级智能体 | `@deepseek-ai/dsh-superagent` | DeepSeek 官方主动式编码智能体原型，支持 GitHub/飞书自主监听、策略评估、子任务多会话调度与内置 UI 管理面板；Web 和 Desktop | <https://github.com/eiritsu/DeepSeek-Harness-plugins/tree/main/packages/bundle/superagent> | <https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.2-rc.1.20261110.1/deepseek-ai-dsh-superagent-0.2.2-rc.1.tgz> |
| Calendar 日历 | `@deepseek-ai/dsh-calendar` | 汇总 Schedule 自动化、本地条目与用户自行提供的 iCalendar 订阅的日历视图；Web 与桌面 | <https://github.com/eiritsu/DeepSeek-Harness-plugins/tree/main/packages/bundle/calendar> | <https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.2-rc.1.20261110.1/deepseek-ai-dsh-calendar-0.2.2-rc.1.tgz> |
| 社区插件目录 | `@deepseek-ai/dsh-community-plugin-catalog` | 浏览和安装社区插件；Web 和 Desktop | <https://github.com/eiritsu/DeepSeek-Harness-plugins/tree/main/packages/bundle/community-plugin-catalog> | <https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.2-rc.1.20261110.1/deepseek-ai-dsh-community-plugin-catalog-0.2.2-rc.1.tgz> |
| IM 集成 | `@deepseek-ai/dsh-im-integration` | 多平台 IM 网关（飞书/Lark、钉钉、企业微信、微信、QQ、Telegram、Discord），支持各平台独立配置、白名单访问控制和完全放行/内容审核开关；Web 和 Desktop | <https://github.com/eiritsu/DeepSeek-Harness-plugins/tree/main/packages/bundle/im-integration> | <https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.2-rc.1.20261110.1/deepseek-ai-dsh-im-integration-0.2.2-rc.1.tgz> |
| 工具与连接 | `@deepseek-ai/dsh-tools-connections` | 添加 Brave、Tavily 搜索提供者、Firecrawl 提取工具和设置页；Web 和 Desktop | <https://github.com/eiritsu/DeepSeek-Harness-plugins/tree/main/packages/bundle/tools-connections> | <https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.2-rc.1.20261110.1/deepseek-ai-dsh-tools-connections-0.2.2-rc.1.tgz> |
| macOS Computer Use | `@deepseek-ai/dsh-cua-bundle` | macOS Computer Use（自包含版）：内置预编译原生系统助手与权限面板，自动配置 PTC 运行环境与系统权限检测，开箱即用；Desktop (macOS) | <https://github.com/eiritsu/DeepSeek-Harness-plugins/tree/main/packages/bundle/cua-bundle> | <https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.2-rc.1.20261110.1/deepseek-ai-dsh-cua-bundle-0.2.2-rc.1.tgz> |

`base`、`web-app`、`headless`、`sdk-app`、`sdk-minimal` 和 `acp-app` 是应用 profile 模板，不属于此处的用户扩展清单。

## 兼容性与软件包内容

以上插件支持 Harness runtime base 为 `0.2.2-rc.1`、`0.2.2-alpha.2`、`0.2.1-rc.5`、`0.2.1-rc.3` 以及 `0.2.1-alpha.1`、`0.2.1-alpha.2` 的 Web/Desktop 发行版；Release tag `v0.2.2-rc.1.20261110.1` 同时针对这些版本提供兼容性保证。各软件包的 `engines.dsh` 与 `peerDependencies` 已显式声明对 `0.2.2-rc.1`、`0.2.2-alpha.2`、`0.2.1-rc.5`、`0.2.1-rc.3` 与较旧的 `0.2.1-alpha.x` 的兼容支持。目前公开的 Electron 安装包在其内置 runtime 满足 `0.2.1-rc.3` 或更新时均可兼容运行。在桌面端以本地文件重复安装同名插件时，若官方安装器提示“无法从依赖变更中确定安装了哪一个包”，请先在详情页点击卸载后再安装，或直接使用 Release URL 安装。Harness 公共 API 尚未稳定，这些插件使用了此发行版新增的 API；未修改的上游构建不足以运行它们。

Release 资源包含各软件包 `files` 清单选取的构建后 JavaScript、类型声明、`cordis.patch.yml` 和运行时资源，不包含 monorepo 工作树或开发依赖。

## 源码与许可证

源码包位于本仓库上述路径，采用 DeepSeek Harness 插件架构。每个软件包的 README 说明其配置、行为和限制。各软件包使用 MIT 许可证；第三方条款见 [LICENSE](LICENSE) 和软件包中的声明文件。
