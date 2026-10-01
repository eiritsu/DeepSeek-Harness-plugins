# Agent Note: 从 TypeScript 输出构建包运行时入口

Status: implemented

[English](2026-09-26-package-runtime-entry-builds.md) | 中文

## 问题

工作区源码和声明输出可能已有新的公开导出，但包发布的 `lib/*.js` 入口仍来自旧构建。此时消费者的具名 ESM import 会在模块链接阶段失败，Cordis 尚未激活包或公布其 Client module。

## 决策

发布根运行时入口的每个工作区包都定义本地 `tsdown.config.ts` 来构建这些入口。根构建先把 TypeScript 输出到 `lib/types`，再由 tsdown 生成 `package.json` exports 和 `files` 指向的文件。若同时发布根入口与 invariant 入口，包配置会包含两者。

Desktop 打包运行时 smoke 会检查 Host 就绪注入中的 session controller 及其 Web UI 行；Host 模块链接失败时，这项检查会发现 Web 启动图缺少对应入口。重建后的 API Session Controller 对工作区包入口的 ESM import 也会被直接检查。

## 考虑过的替代方案

**手动复制或编辑生成的 JavaScript。**拒绝，因为运行时代码必须来自 TypeScript 项目输出，后续构建也会覆盖手动修复。

**只依据包清单或 profile bundle 行推断激活成功。**拒绝，因为两者都不能证明 Node 能链接包的运行时导出。

## 后果

仓库构建会在发布打包前刷新工作区包运行时入口。有效的源码类型、bundle 元数据或 profile patch 不再掩盖过期入口；准备好的 Desktop smoke 还会检查下游 Web 启动图。
