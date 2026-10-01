# Agent Note: Isolated unsigned macOS test application

Status: implemented

[English](2026-09-26-desktop-unsigned-test-app.md) | 中文

## Problem

本地 GUI 验收需要一份 macOS 应用，既能与发布安装并存，也不依赖发布签名凭据或用户的常规应用身份。

## Decision

`package-target.ts --unsigned-test --dir` 只接受 macOS arm64 目标，并使用固定的 `com.deepseek.harness.unsignedtest` bundle ID 和 `DeepSeeK Harness` 产品名。Electron `extraMetadata.version` 仅在此测试模式固定为 `0.1.22`；捆绑的 dsh runtime 保持并独立验证其 manifest 版本。打包运行记录和 smoke 输出会分别标明两个版本。它剔除签名、上传凭据和 `DSH_HOME`，将可变构建状态与产物保存在目标的 `unsigned-test` 目录，跳过签名、公证、更新和发布完成记录，并运行打包运行时 smoke。常规产品名、bundle ID、输出路径和签名流程保持不变。

该模式只从 `.env.macos` 读取更新策略地址、包 registry 等非敏感打包配置；子进程环境会过滤签名和上传字段。它不会将应用安装或启动到 `/Applications` 或用户 profile。

## Alternatives considered

**使用常规 macOS bundle ID 并进行 ad-hoc 签名：**不采用，因为测试应用可能替换或共享已安装发布版的身份。

**通过发布打包选项禁用签名：**不采用，因为这会提供一条可以生成发布名称产物、却不满足发布签名与公证保证的路径。

## Consequences

测试应用拥有独立的 macOS 身份和构建目录，但使用常规打包运行时组装与 smoke 检查。命令仍需要本地 `.env.macos` 文件提供非敏感设置。GUI 启动和 profile 隔离行为需要使用最终测试产物人工验收。

## Verification

定向打包测试覆盖参数限制、环境变量剔除、目标路径隔离、测试 App 与 runtime 的版本分离、打包配置和阶段选择。实际打包待插件迁移接线稳定后进行。
