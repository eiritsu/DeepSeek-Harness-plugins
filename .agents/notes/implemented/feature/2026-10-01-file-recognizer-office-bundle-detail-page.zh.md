# Agent Note: File-recognizer-office bundle detail page

Status: implemented

[English](2026-10-01-file-recognizer-office-bundle-detail-page.md) | 中文

## 问题

可选包 `@deepseek-ai/dsh-file-recognizer-office` 把它的解析上限、OCR / 音频 / 视频 endpoint 和凭据徽章通过独立的 `settings.section` 注册暴露出来，id 是 `file-recognizer-office`。同一包的官方 Plugin Manager 详情页只能列出包和组件清单，可编辑控件却必须离开 Plugins 页面、走到独立的 Files 区域去编辑。其他可选 bundle（`lark-integration`、`tools-connections`、`configuration-and-skills-backup`）已经把可编辑字段挂到按包名索引的 `plugins.bundle.config` slot 上，由 Plugin Manager 在它们自己的详情页内渲染。

## 决策

`@deepseek-ai/dsh-file-recognizer-office` 把 Client 注册从 `settings.section` 迁到 `plugins.bundle.config`，按 `@deepseek-ai/dsh-file-recognizer-office` 包名索引。渲染层仍然使用同一个 `OfficeRecognitionCard` 组件、同一个 `OfficeRecognitionCardController`，以及与其他 bundle 一致的 `ctx.configForms.whileServed([OFFICE_RECOGNITION_NS], ...)` 守卫，所以启用该 Host 行的部署仍然能在 bundle 的 Plugins 详情页上看到全部解析和识别控件。Host 插件 entry、Host `apply`、凭据引用、composer 的 `nativeFileUploadPolicies` 注册和凭据失效监听全部保持不变。本包不再提供 `Settings` 侧边栏区域；Plugins 详情页提供相同的编辑界面。`dsh.client.inject` 新增 `@deepseek-ai/dsh-client-ui-plugin-manager`，让 Client bundle 能解析 keyed slot 的渲染路径；Client tsconfig 同时引用该包的 `tsconfig.client.json`。README 和双语文档现在指向 bundle 的 Plugins 详情页，而不是独立的 Files 区域。

## 评估过的替代方案

**保留独立 Files 区域，并在 `plugins.bundle.config` 上挂一个只读占位。** 拒绝，因为这样会重复编辑器和凭据徽章，破坏与其他 bundle 共享的视觉契约，并强迫用户在 Plugins 页和独立的 Settings 侧边栏之间反复切换同一组字段。

**从一个独立的 settings 包里复用 `settings.section` slot。** 拒绝，因为独立的 Files 区域在这个 bundle 之外没有消费方；分发一个独立的 settings 包会重新引入 `cordis.patch.yml` 已经为该归档拒绝过的 `ui-settings-*` 耦合。

## 后果

bundle 详情页现在暴露了原独立 Files 区域承担的全部可编辑字段和凭据徽章。Plugin Manager 列表页和详情页按与 `lark-integration`、`tools-connections`、`configuration-and-skills-backup` 相同的方式托管该 entry。Office、PDF 和已配置媒体的 composer 文件入口仍然走 `ctx.nativeFileUploadPolicies`。依赖独立 Files 区域的安装需要在 Plugins → 该 bundle → 详情页上找到编辑器，而不是 Settings 侧边栏。Settings 持久化、Host Config 校验以及已记录会话的 `user/message` 接纳快照均不受影响。
