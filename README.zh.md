# DeepSeek Harness 插件

[English](README.md) | 中文

本仓库由 Eiritsu 维护，用于分发 DeepSeek Harness 可选插件。软件包面向 Eiritsu 的 `@deepseek-ai/dsh` **0.2.0-rc.2** 发行版；除非某个插件另有说明，否则不能与未修改的上游构建兼容。请只安装与当前 Harness 发行版完全匹配的插件。

## 安装插件

`v0.2.0-rc.2.20261001.2` 的 GitHub Release 已为下表中的每个可安装组合包附带一个预构建 `.tgz` 资源。在 Web 或 Desktop 的 **Plugins** 中选择 **Install**，输入对应资源的下载 URL。通过 CLI 安装时，请先下载 `.tgz` 资源，再将其绝对本地路径添加到 profile：

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

每行列出源码路径和对应的资源文件名。下表中的组合包版本均为 `0.2.0-rc.2`。

| 插件 | npm 包 | 功能和界面 | 源码路径 | `.tgz` 资源 |
|---|---|---|---|---|
| Office 文件识别 | `@deepseek-ai/dsh-file-recognizer-office` | 本地提取 DOCX、PPTX、XLSX、OpenDocument 和 PDF 文本，可选 OCR；Web 和 Desktop，需此发行版提供原生文件上传 API | `packages/attachment/file-recognizer-office` | `deepseek-ai-dsh-file-recognizer-office-0.2.0-rc.2.tgz` |
| 社区插件目录 | `@deepseek-ai/dsh-community-plugin-catalog` | 浏览和安装社区插件；Web 和 Desktop | `packages/bundle/community-plugin-catalog` | `deepseek-ai-dsh-community-plugin-catalog-0.2.0-rc.2.tgz` |
| 社区 Skill 目录 | `@deepseek-ai/dsh-community-skill-catalog` | 浏览并安装指定版本的 SkillHub Skill；Web 和 Desktop | `packages/bundle/community-skill-catalog` | `deepseek-ai-dsh-community-skill-catalog-0.2.0-rc.2.tgz` |
| 配置和 Skill 备份 | `@deepseek-ai/dsh-configuration-and-skills-backup` | 导出 profile 配置和选定的 Skill；Web 和 Desktop | `packages/bundle/configuration-and-skills-backup` | `deepseek-ai-dsh-configuration-and-skills-backup-0.2.0-rc.2.tgz` |
| 复制 Session ID | `@deepseek-ai/dsh-copy-session-id` | 在对话标题栏中添加复制操作；Web 和 Desktop | `packages/bundle/copy-session-id` | `deepseek-ai-dsh-copy-session-id-0.2.0-rc.2.tgz` |
| Desktop profile 迁移 | `@deepseek-ai/dsh-desktop-profile-migration-bundle` | 在 Desktop profile 设置中选择已安装的功能组合包；仅 Desktop | `packages/bundle/desktop-profile-migration` | `deepseek-ai-dsh-desktop-profile-migration-bundle-0.2.0-rc.2.tgz` |
| Lark 与飞书集成 | `@deepseek-ai/dsh-lark-integration` | 将获准用户的私聊转成 Harness Session，并配置连接；Web 和 Desktop | `packages/bundle/lark-integration` | `deepseek-ai-dsh-lark-integration-0.2.0-rc.2.tgz` |
| 编辑并重发消息 | `@deepseek-ai/dsh-session-message-edit-resend` | 在同一 Session 中编辑最近一条符合条件的用户消息；Web 和 Desktop，要求匹配的 `0.2.0-rc.2` Agent API | `packages/bundle/session-message-edit-resend` | `deepseek-ai-dsh-session-message-edit-resend-0.2.0-rc.2.tgz` |
| 工具与连接 | `@deepseek-ai/dsh-tools-connections` | 添加 Brave、Tavily 搜索提供者、Firecrawl 提取工具和设置页；Web 和 Desktop | `packages/bundle/tools-connections` | `deepseek-ai-dsh-tools-connections-0.2.0-rc.2.tgz` |
| 回合状态闪光效果 | `@deepseek-ai/dsh-turn-process-shimmer` | 使用支持减少动态效果偏好的运行状态动画替换渲染器；Web 和 Desktop | `packages/bundle/turn-process-shimmer` | `deepseek-ai-dsh-turn-process-shimmer-0.2.0-rc.2.tgz` |
| 原生电脑操作（实验性） | `@deepseek-ai/dsh-experimental-computer-use-cua-native` | 添加原生 CUA 提供者；要求 Web profile 所在主机具备所需桌面权限 | `packages/experimental/computer-use-cua-native` | `deepseek-ai-dsh-experimental-computer-use-cua-native-0.2.0-rc.2.tgz` |
| 模型目录 | `@deepseek-ai/dsh-model-catalog` | 从 models.dev 更新模型元数据；仅 Host，无 UI | `packages/llm/model-catalog` | `deepseek-ai-dsh-model-catalog-0.2.0-rc.2.tgz` |
| Session 归档 | `@deepseek-ai/dsh-session-archive` | 导出并恢复 Session 及其引用的附件；Web 和 Desktop | `packages/session-query/session-archive` | `deepseek-ai-dsh-session-archive-0.2.0-rc.2.tgz` |

Desktop profile 已包含其专用持久化组合层。对应源码组件位于 `packages/experimental/desktop-app`，属于 Desktop 发行版的一部分，不能单独安装。`base`、`web-app`、`headless`、`sdk-app`、`sdk-minimal` 和 `acp-app` 是应用 profile 模板，不属于此处的用户扩展清单。

## 支持包

以下版本化软件包供组合包或 profile 组合使用，不是 Plugin Manager 的独立安装入口：

| 软件包 | 源码包路径 | 使用方 |
|---|---|---|
| `@deepseek-ai/dsh-session-persistence-sqlite`（`0.2.0-rc.2`） | `packages/session/session-persistence-sqlite` | 实验性的 Desktop profile 组合 |
| `@deepseek-ai/dsh-web-github-code-search`（`0.2.0-rc.2`） | `packages/web/web-github-code-search` | 显式挂载 GitHub 代码搜索的可选 profile 组合 |

## 兼容性与软件包内容

本 patch 支持 Harness runtime base 和插件软件包版本均为 `0.2.0-rc.2` 的 Eiritsu Web/Desktop 发行版；Release tag `v0.2.0-rc.2.20261001.2` 不会改变兼容版本。目前公开的 Electron 安装包 shell `buildVersion` 是 `0.2.0-rc.2.20261001.1`；只要其内置 runtime base 和插件软件包为 `0.2.0-rc.2`，就与本插件兼容。profile 组合包和 Harness runtime 软件包也必须保持此 base 版本。已安装旧版 Lark 集成的用户需要先卸载，再从[本次 Release 的 Lark 资源](https://github.com/eiritsu/DeepSeek-Harness-plugins/releases/download/v0.2.0-rc.2.20261001.2/deepseek-ai-dsh-lark-integration-0.2.0-rc.2.tgz)重新安装。Harness 公共 API 尚未稳定，部分功能使用了此发行版新增的 API。例如，Office 文件识别使用原生文件上传策略 API；编辑并重发消息使用匹配版本的 Agent 与 Agent Loop 软件包。仅版本号相同但缺少这些扩展的上游构建仍不兼容。

Release 资源包含各软件包 `files` 清单选取的构建后 JavaScript、类型声明、`cordis.patch.yml` 和运行时资源，不包含 monorepo 工作树或开发依赖。需要时，组合包会解析其依赖的两个支持包；用户不应将它们作为独立功能安装。

## 源码与许可证

源码包位于本仓库上述路径，采用 DeepSeek Harness 插件架构。每个软件包的 README 说明其配置、行为和限制。各软件包使用 MIT 许可证；第三方条款见 [LICENSE](LICENSE) 和软件包中的声明文件。
