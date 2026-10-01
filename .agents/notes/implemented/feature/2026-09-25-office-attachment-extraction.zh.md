# Agent Note: 可选 Office 附件提取

Status: implemented

[English](2026-09-25-office-attachment-extraction.md) | 中文

## 问题

Office 和扫描 PDF 附件需要把本地提取的文本加入 model 可见的用户内容，同时上传文件必须保持持久且可回放。音频和视频附件也需要可选的远程识别。此版本没有文件识别 registry，工作区 `@file` 引用也只是路径提及，而不是上传的 FileBlock。

## 决策

可选的 `file-recognizer-office` profile layer 使用现有 `agent/pre-step` waterfall，在 Agent loop 记录已接受的消息批次前提取上传 FileBlock 的文本。转换后的 `user/message` 保留原始 FileBlock，并附加提取文本，因此回放时既有源引用，也有 model 使用的精确文本。Office 和可搜索 PDF 在本地解析；扫描 PDF OCR、音频转写和视频理解使用分开的可选 endpoint 与 credential。此实现使用已文档化的 Agent 扩展点，不新增 core recognizer registry。[通用文件上传决策](2026-08-26-generic-file-upload.zh.md)负责持久 FileBlock 准入；[interception 扩展点说明](2026-06-30-interception-extension-points.zh.md)负责 loop 时序。

工作区 `@file` 引用仍是路径提及文本，不会进入本附件解析器。在 rc2 中，`ctx.fileReferences` 只发现路径而不读取内容，`agent/pre-step` 收到的已接受消息也没有带授权的 Workspace 内容解析器。将提及当作上传处理需要上游提供 Agent-scoped API：按当前 Workspace 授权校验选中的引用、返回有界内容或 read receipt，并让 Agent 准入将解析内容写入用户消息。插件不会把任意提示词文本解释为路径。远程 OCR、音频和视频请求均为 opt-in；key 通过 credentials 能力写入和解析，绝不保存在插件 Config 中。

## 考虑过的替代方案

**添加 core attachment recognizer registry。** 不采用，因为 `agent/pre-step` 已能在消息批次写入日志前处理完整内容，选用插件即可实现 opt-in 功能，不必修改 core 或引入新的 registry 约定。

**在插件中将工作区 `@file` 提及解析为附件。** 不采用，因为扩展 API 没有为选中引用提供授权内容解析。扫描提示词中的路径会绕过 Workspace 授权和持久上传准入。

## 后果

此功能保持 opt-in，且只处理上传的 FileBlock。提取成功后会与源引用写入同一用户事件；修改解析设置只影响之后的消息。远程 OCR、音频和视频识别需要配置 endpoint，除 loopback HTTP 外使用 HTTPS，并会将页面图片或媒体发送到 Host 进程外部。因为 FileAttachmentRef 不保留 MIME type，有歧义的媒体容器按文件扩展名路由。

## 验证

Host 测试通过 Agent loop 覆盖 DOCX 提取、音频 multipart 转写和视频 `video_url` 请求，并检查识别文本与原 FileBlock 进入同一已接受用户事件。Settings 测试保存并重新打开所有 endpoint 和 model ID，同时确认 OCR、音频和视频 key 均不会出现在客户端状态中。
