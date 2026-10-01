# Agent Note：可选功能集成保持为独立 profile 组合包

Status: implemented

[English](2026-09-26-independent-feature-profile-bundles.md) | 中文

## 问题

可选产品扩展需要能够独立测试和移除，同时以官方 Web profile 作为基础。

## 决策

Lark 及其设置 Client、Firecrawl、社区目录、Office 文件识别、复制 Session ID、轮次处理中效果、Session 归档和 Desktop 迁移都作为可独立安装的组合包提供；Lark Host 行默认禁用。官方 Web 工具呈现器已经能够渲染工具结果，因此 Firecrawl 只插入 Host 工具行。官方 Cua Driver native provider 由单独的 opt-in 组合包组合，需显式安装到 profile；它不属于应用运行时依赖或随附的 optional bundle 列表，因为它会在 Host 进程中加载 native code，并能操作启动应用的桌面。全新 Desktop profile 只会在 `dsh-base` 和 `dsh-web-app` 之后选择模型目录。Web 与其他 profile 模板保持不变；profile 初始化不会覆盖已有 `package.json`，因此升级会保留已保存的组合包选择。不会自动向已有 profile 注入自研集成；单独安装的迁移组合包可以提供显式选择。Plugin Manager 可分别停用已选组合包；安装包拥有的文件仍保留在应用资源中。

`scripts/optional-feature-bundles.spec.ts` 会解析各组合包 patch、检查每个插入包都是直接依赖，并验证它们独立及组合叠加到官方 Web 层时的结果。

## 考虑过的替代方案

- **把所有扩展放进一个组合包：**拒绝，因为用户无法独立启用或移除功能，而且需要 Lark 凭据的组合包也会一并安装无关 UI 功能。
- **把扩展行加入随附 Web profile：**拒绝，因为官方基线应保持不含可选集成和外观替换。
- **为 Firecrawl 新增 Client 呈现器：**拒绝，因为官方 Web 工具 UI 已经可以呈现 Host 工具调用和结果。
- **在默认 profile 启用 native CUA：**拒绝，因为挂载 provider 就会在 Host 中初始化 native 桌面访问，并扩展模型可调用的桌面控制工具。

## 后果

- 干净的自定义 Web profile 可以分别安装和切换每个功能组合包，不改变随附 Web profile 模板。
- 全新 Desktop profile 会选择模型元数据；其他自研功能需要显式安装并加入 profile。
- Desktop 恢复仍回到 Web 基线组合，不会重新启用独立功能组合包。
- Lark 设置 Client 与 Host 插件一起交付；Host 仍需显式启用后才会运行。
- Firecrawl 使用与其他官方 Web 工具相同的呈现方式，不会创建重复的结果界面。

## 验证

`pnpm exec vitest run scripts/optional-feature-bundles.spec.ts` 验证 patch 解析、依赖、独立加入和组合结果。`pnpm run verify-translation-pairing --write` 维护中英文 README 与 Agent Note 的配对记录。
