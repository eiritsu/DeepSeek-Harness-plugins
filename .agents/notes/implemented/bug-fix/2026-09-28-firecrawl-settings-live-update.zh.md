# Agent Note：让 Firecrawl 设置可编辑并实时生效

状态：已实现

English | [中文](2026-09-28-firecrawl-settings-live-update.md)

## 问题

“工具与连接”页面只显示 Brave 和 Tavily 设置，尽管 bundle 文档记录了 Firecrawl 配置。Firecrawl 配置虽为 volatile，但工具注册时只复制一次，因此后续保存不会更新接口地址、限制、凭据引用或超时。

## 决策

通过现有 ConfigForms 页面公开 Firecrawl 启用开关、凭据引用与密钥、接口地址、超时、响应字节上限和 Markdown 码点上限。API Key 文本只保存在凭据服务中。收到 `loader/volatile-update` 后，先撤销当前 Firecrawl 工具注册，再使用已提交的配置值注册替代项，同时更新注册级超时和执行参数。

## 后果

Firecrawl 设置保存后无需重新挂载 bundle 即可生效。替换注册使用工具注册表提供的 disposer；卸载 bundle 时会撤销最后一个有效注册。Loader 文档说明了 volatile 配置事件及 disposer 生命周期。

## 考虑过的替代方案

**只在重新挂载 bundle 后应用设置。** 不采用此方案，因为保存 ConfigForms 值后，已注册工具仍会使用旧的 endpoint、限制、凭据引用和 timeout。

**保留工具注册，并在每次执行时读取设置。** 不采用此方案，因为工具注册表会在注册时捕获 timeout，因此执行时读取无法应用 timeout 变更。

## 验证

定向 Vitest（controller、bundle settings 和 Firecrawl 测试）通过。Host 与 Client 项目引用通过 `tsc -b`；`bundle` 和 `test:packed-artifact` 验证了两个打包面及经 Cordis Loader 加载的 Host 入口。双语配对检查通过。定向 Oxlint 仍报告 controller 与 Firecrawl 解析/测试代码中的既有诊断。
