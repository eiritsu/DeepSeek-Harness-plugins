# DeepSeek Harness 插件

[English](README.md) | 中文

本仓库由 Eiritsu 维护，用于分发 DeepSeek Harness 可选插件。软件包面向 Eiritsu 的 `@deepseek-ai/dsh` **0.2.0-rc.2** 发行版；除非某个插件另有说明，否则不能与未修改的上游构建兼容。请只安装与当前 Harness 发行版完全匹配的插件。

## 安装插件

下表每个已发布插件的最后一列都是 Release 安装 URL。复制该 URL，粘贴到 Web 或 Desktop 应用的 **Plugins → Install**，安装器会按原样安装。Source 列用于阅读源码：GitHub 目录 URL 既不是 git 仓库也不是 tarball，安装器会拒绝它。当前的技能库安装地址是：

```text
https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.0-rc.2.20261008.2/deepseek-ai-dsh-community-skill-catalog-0.2.0-rc.2.tgz
```

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

每行列出用于阅读源码的源码目录和可直接复制的安装 URL。以下五个是本仓库自行维护并单独发布的 `0.2.0-rc.2` 插件；历史实验包不再列为当前的独立安装项。五个插件的版本均为 `0.2.0-rc.2`。

| 插件 | npm 包 | 功能和界面 | 源码（仅浏览） | 安装 URL |
|---|---|---|---|---|
| Calendar 日历 | `@deepseek-ai/dsh-calendar` | 汇总 Schedule 自动化、本地条目与用户自行提供的 iCalendar 订阅的日历视图；Web 与桌面 | <https://github.com/eiritsu/DeepSeek-Harness-plugins/tree/main/packages/bundle/calendar> | <https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.0-rc.2.20261008.2/deepseek-ai-dsh-calendar-0.2.0-rc.2.tgz> |
| 社区插件目录 | `@deepseek-ai/dsh-community-plugin-catalog` | 浏览和安装社区插件；Web 和 Desktop | <https://github.com/eiritsu/DeepSeek-Harness-plugins/tree/main/packages/bundle/community-plugin-catalog> | <https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.0-rc.2.20261008.2/deepseek-ai-dsh-community-plugin-catalog-0.2.0-rc.2.tgz> |
| 社区 Skill 目录 | `@deepseek-ai/dsh-community-skill-catalog` | 搜索 SkillsMP 并安装固定 Git commit 的 GitHub Skill；Web 和 Desktop | <https://github.com/eiritsu/DeepSeek-Harness-plugins/tree/main/packages/bundle/community-skill-catalog> | <https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.0-rc.2.20261008.2/deepseek-ai-dsh-community-skill-catalog-0.2.0-rc.2.tgz> |
| Lark 与飞书集成 | `@deepseek-ai/dsh-lark-integration` | 将获准用户的私聊转成 Harness Session，并配置连接；Web 和 Desktop | <https://github.com/eiritsu/DeepSeek-Harness-plugins/tree/main/packages/bundle/lark-integration> | <https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.0-rc.2.20261008.2/deepseek-ai-dsh-lark-integration-0.2.0-rc.2.tgz> |
| 工具与连接 | `@deepseek-ai/dsh-tools-connections` | 添加 Brave、Tavily 搜索提供者、Firecrawl 提取工具和设置页；Web 和 Desktop | <https://github.com/eiritsu/DeepSeek-Harness-plugins/tree/main/packages/bundle/tools-connections> | <https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.0-rc.2.20261008.2/deepseek-ai-dsh-tools-connections-0.2.0-rc.2.tgz> |

`base`、`web-app`、`headless`、`sdk-app`、`sdk-minimal` 和 `acp-app` 是应用 profile 模板，不属于此处的用户扩展清单。

## 兼容性与软件包内容

以上插件支持 Harness runtime base 和插件软件包版本均为 `0.2.0-rc.2` 的 Eiritsu Web/Desktop 发行版；Release tag `v0.2.0-rc.2.20261008.2` 不会改变兼容版本。目前公开的 Electron 安装包 shell `buildVersion` 是 `0.2.0-rc.2.20261001.1`；只要其内置 runtime base 和插件软件包为 `0.2.0-rc.2`，就与这些插件兼容。profile 组合包和 Harness runtime 软件包也必须保持此 base 版本。已安装旧版 Lark 集成的用户需要先卸载，再从[本次 Release 的 Lark 资源](https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.0-rc.2.20261008.2/deepseek-ai-dsh-lark-integration-0.2.0-rc.2.tgz)重新安装。Harness 公共 API 尚未稳定，这些插件使用了此发行版新增的 API；未修改的上游构建不足以运行它们。

Release 资源包含各软件包 `files` 清单选取的构建后 JavaScript、类型声明、`cordis.patch.yml` 和运行时资源，不包含 monorepo 工作树或开发依赖。

## 源码与许可证

源码包位于本仓库上述路径，采用 DeepSeek Harness 插件架构。每个软件包的 README 说明其配置、行为和限制。各软件包使用 MIT 许可证；第三方条款见 [LICENSE](LICENSE) 和软件包中的声明文件。
