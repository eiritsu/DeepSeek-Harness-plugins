# Agent Note: 独立 Desktop profile 迁移 bundle

Status: implemented

[English](2026-09-27-standalone-desktop-profile-migration.md) | 中文

## Problem

显式迁移页面原本只是一个薄 bundle，并依赖尚未发布的 Host 与 Client split package，因此单独安装 tarball 并不能提供完整的功能选择流程。该页面不导入旧配置或凭据。

## Decision

`@deepseek-ai/dsh-desktop-profile-migration-bundle` 在一个可选 package 中包含 Host 迁移 Remote、生成的 Typert graph、浏览器 Settings Client 和 profile patch。该 patch 只插入迁移插件。Client 列出当前 profile 已安装的候选包，并通过官方 Plugin Manager 启用用户确认的选择；profile 选择逐项应用，失败后重新读取，不回滚已成功项。只有预期的已保存选择包含所有候选项后，Host 才记录完成。原有选择和已退休选择都保持不变。

独立构建使用官方 `WorkspaceTypertGenerator` 处理该 package 的 Host face，因为 package 本地 TypeScript solution 不是 workspace 模式 generator 使用的 workspace 根目录。

## Alternatives considered

- **保留 split Host 和 Client package 作为运行时依赖：**不采用，因为仅安装迁移 bundle tarball 无法提供完整功能，还需要发布并安装两个 private package。
- **向共享 Plugin Manager Remote 添加迁移专用方法：**不采用，因为迁移状态与标记由此可选功能拥有，而官方通用 `setBundleEnabled` 操作已能逐项应用选择。
- **安装迁移 package 时自动启用候选 bundle：**不采用，因为安装迁移工具不代表用户同意启用任何功能包。

## Consequences

此 bundle 可以作为一个 profile package 安装和移除，不会把候选包加入已发布默认组成。选择前仍需先安装候选包。候选清单不包含需要单独外部服务凭据的 Firecrawl，也不包含可另行安装的配置备份工具。逐项启用失败时，已成功的操作会保留，用户需要重试；这不是跨多个 package 的事务。

## Verification

Package face tests 覆盖已有选择保留、显式完成和逐项失败结果。Tarball smoke 在临时 profile 中通过官方 Loader 启动打包后的 Host entry，并验证读取迁移选项不会更改 profile manifest。
