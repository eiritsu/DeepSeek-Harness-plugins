# Agent Note: Explicit Office file submission

Status: implemented

[English](2026-09-27-office-file-submission.md) | 中文

## 问题

部分用户需要发送一个可由 Office 识别器处理的附件，同时保留官方 composer 的文件选择器、拖放和 `@` 引用语义。

## 决策

可选的 `file-recognizer-office` Client entry 在 Session 标题栏注册一个操作。它使用官方 `FileUploadService`，通过 `ISessions.using` 保留当前 Session，用 `beginSubmission` 注册回显，再通过普通排队 `Session.prompt` 一起发送文本和上传 receipt。Agent 接受 FileBlock 后仍会运行官方 `agent/pre-step` 提取流程。

仅已知业务拒绝（`gateway/bad-request`、`session/not-found` 或 `session/attachment-invalid`）会保留 staged receipt，供用户手动重试。Remote 会把传输失败折叠为 `{ ok: false }`，因此传输错误、取消和未分类失败均视为准入结果不确定，UI 会阻止重发。`prompt()` 一旦开始，回显结算由它负责，调用方不会再放弃回显。官方上传服务没有丢弃 receipt 的操作；成功上传后取消可能让 staged receipt 保留到 Session 被销毁，durable attachment 也会保持未引用。

## 考虑过的替代方案

- **修改官方 composer 或 file-reference codec：**拒绝，因为现有文件选择器、拖放和 `@` 路径保留原语义。
- **新增 core prompt 或 upload API：**拒绝，因为现有公开上传、Session 保留、回显和提示词方法已足以支持独立操作。
- **在一个对话框中发送多个文件：**暂缓，因为部分上传失败可能让成功 receipt 留在 staged 状态，却没有对应的已接受提示词。

## 后果

该操作向当前 Session 提交一个文件和必填文本，不改变默认 composer。提示词准入仍由官方 Session API 管理。传输失败可能导致准入状态不确定，因此用户必须先检查对话，不能自动再次发送。准入前取消的成功上传会继续归属于 Session，直到官方服务退休 receipt 或 Session 结束。

## 验证

聚焦测试验证一次上传后发送同一条文本与文件提示词、白名单业务拒绝后复用 receipt 手动重试且不重复上传、已解析或抛出的不确定传输结果不会重复发送，以及上传完成后取消时不会创建回显。
