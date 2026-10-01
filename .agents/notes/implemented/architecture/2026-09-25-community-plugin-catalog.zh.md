# Agent Note：社区目录将安装委托给 Plugin Manager

Status: implemented

[English](2026-09-25-community-plugin-catalog.md) | 中文

## 问题

公开社区目录发布插件元数据和类似命令的安装字符串，但目录浏览器不应创建第二条包管理路径，也不应把社区元数据视为可信代码。

## 决策

可选的 `dsh-community-plugin-catalog` 包在一个可安装 bundle 中提供只读 Host Remote 和 Web 侧栏浮层。Host 限制 HTTPS 请求与响应体大小，将网站支持的筛选参数传给 API，并只暴露 HTTPS GitHub 仓库链接。它把安装文本视为不可信数据，将每个值规范化为一个受支持的 npm 或 GitHub spec，过滤不支持的值，并要求 GitHub 目标与列表展示的仓库一致。Client 将规范化 spec 交给官方 Plugin Manager 对话框。官方安装操作仍负责检查、兼容性验证、取消、包管理器工作和需用户确认后持久保存的安装脚本授权；安装成功后包保持停用，直到用户启用。

安装行为仍由官方 Plugin Manager 决定。它对 Git 地址做 spec 验证，但不审计远端 manifest。目录不会执行目录提供的命令、未经确认授权构建脚本或修改 profile 默认组合。这扩展了[profile 组合包决策](2026-08-05-profile-plugin-bundles.zh.md)和[当前 profile 插件管理决策](2026-09-14-current-profile-plugin-management.zh.md)。

## 考虑过的替代方案

**执行网站安装命令或另行维护包管理器实现。** 这会让远程元数据获得执行路径，并重复包管理器策略与安全检查。现有 Plugin Manager Remote 已负责这些操作。

**把目录加到内置 Web bundle。** 社区维护的目录不是核心使用所必需的。可选 bundle 保持内置 profile 不变，并由 profile 所有者决定是否增加这项网络依赖。

## 影响

目录发现可以独立失败，不影响 profile 已有插件。提供不支持 spec、或 GitHub 目标与展示仓库不一致的条目会被隐藏。受支持的 spec 由 Plugin Manager 检查并要求用户明确确认；用户不应将此流程理解为源码审查或 GitHub manifest 安全审计。
