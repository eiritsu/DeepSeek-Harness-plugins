---
description: "为 Office 附件添加本地文本提取和扫描 PDF OCR 的 profile bundle。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-file-recognizer-office

[English](README.md) | 中文

## 概述

该 profile bundle 为 DOCX、PPTX、XLSX 和 OpenDocument 附件添加本地文本提取。它也会在本地提取已有 PDF 文本，并可将扫描 PDF 页面发送到配置的 OCR endpoint。音频转写和视频理解使用各自配置的 OpenAI 兼容 endpoint。同一个包归档包含 Host parser 和 Files Settings Client。原始 FileBlock 会保留在已记录的用户消息中，提取文本也会记录在同一消息中。配置对应 endpoint 和 model 前，远程识别不会启用。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [Model Experience](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

### 安装到 profile

将可选 layer 添加到已提供持久附件和 Agent loop 的 profile：

```sh
dsh plugin --profile <name> add @deepseek-ai/dsh-file-recognizer-office
dsh plugin --profile <name> remove @deepseek-ai/dsh-file-recognizer-office
```

bundle 从已安装的 dsh 包或配置的 npm registry 解析。归档同时包含 Host 识别器和该 bundle 详情页 Client。添加后会插入 Host row；运行时从同一包加载 `./client` entry，将其可编辑字段挂在该 bundle 的 Plugins 详情页上。移除 profile 安装的包时会撤销 Host row。

### 功能

Office 文本会在用户消息被接受并写入日志前由 Host 解析。可搜索 PDF 文本在本地提取。没有文本层的页面属于真实的能力缺口，因此走本轮模型实际能用的那条路径：声明了 image 输入的模型直接收到渲染出的页面图片，不发起 OCR 调用；纯文本模型则回退到 OCR，且需要配置 endpoint 和 model。音频转写和视频理解也必须分别配置 endpoint 和 model。Host 插件启用时，该 bundle 的 **Plugins 详情页** 通过与其他 bundle 共享的 Settings 表单编辑解析限制以及所有识别服务的 endpoint、model 与凭据。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxInputBytes` | `33554432` | 为提取而缓冲的最大输入字节数。 |
| `maxUncompressedBytes` | `134217728` | 单个 Office ZIP archive 的最大解压字节数。 |
| `maxZipEntries` | `4000` | 单个 Office ZIP archive 的最大条目数。 |
| `maxExtractedChars` | `200000` | 每个文件附加的最大提取字符数。 |
| `maxPdfPages` | `20` | 检查或发送 OCR 的最大 PDF 页数。 |
| `maxPdfPagePixels` | `4000000` | 单个 OCR 页面栅格化的最大像素数。 |
| `maxPdfRenderScale` | `2` | OCR 的最大 PDF 渲染比例。 |
| `ocrEndpoint` | 未设置 | OpenAI 兼容 API base URL（如 `https://host/v1`）或完整的 `/chat/completions` URL。版本化 base URL 会追加 `/chat/completions`；完整操作 URL 保持不变。未设置时关闭 OCR。除 loopback host 外必须使用 HTTPS。 |
| `ocrModel` | 未设置 | 与 `ocrEndpoint` 配套的 vision model id。 |

Settings 页面通过 `ctx.credentials` 分别将 OCR、音频和视频 key 写入 `DSH_FILE_OFFICE_OCR_API_KEY`、`DSH_FILE_OFFICE_AUDIO_API_KEY` 和 `DSH_FILE_OFFICE_VIDEO_API_KEY`；secret 不会进入 settings 文档或表单响应。Host Config 声明见 [`src/index.ts`](src/index.ts)。

标准 composer 会将选择、拖入或粘贴的 DOCX、PPTX、XLSX、OpenDocument 和 PDF 文件送入普通附件队列。只有 Host 已接受的设置同时包含 endpoint 和 model 时，音频与视频扩展名才走该路径。composer 继续使用标准 FileCard、进度、删除、重试和发送行为。手动 `@` 提及、目录、图片和无法识别的 native-path 文件保持现有行为。

此 Client 集成需要本发行版 `@deepseek-ai/dsh-client-ui-conversation/client` 导出的 `nativeFileUploadPolicies` API；未经修改的上游 rc.2 不包含此 API。若独立安装 Files 的应用没有该接口，native-path 文件无法经标准 composer 上传；插件不会安装独立发送器作为回退。

Credentials 会在远程识别请求执行时解析。配置 endpoint 不会让本地解析器在启动时依赖 Credentials 服务；如果服务或 key 不可用，只有该次远程请求会报告错误，原始附件仍会保留。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

Host 插件使用 `agent/pre-step` 检查待接受的用户消息。它通过 `ctx.attachments.readFileStream()` 读取持久字节，将提取文本加到同一消息，并保留原 FileBlock。随后 Agent loop 在常规 `user/message` 事件中记录这两部分。首步 surface replacement 会携带已接纳内容，并在 pre-step payload 中标记该操作，使本插件不会重复解析相同文件。支持的文件超出限制、无法解析或需要未配置的 OCR 时，会在保留 FileBlock 的同时加入用户可见说明；不支持的扩展名保持原样通过。

Office ZIP archive 在解析前会检查条目数、解压字节总量、加密成员和不安全成员路径。PDF 使用 PDF.js 提取页面文本，并将低于文本阈值的页面栅格化。只有这些页面图片会发送到配置的 OCR URL；每次请求都会解析 credential reference。音频附件通过 multipart `audio/transcriptions` 请求处理；视频附件作为 `video_url` 内容发送至 `chat/completions`。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | Config 验证、archive 检查、文本提取和 Agent 生命周期监听。 |
| [`cordis.patch.yml`](cordis.patch.yml) | 可选 Host row；同一包也导出其 `./client` entry。 |
| — | 不发布 runtime invariant companion；插件没有可独立观测的 registry 关系。 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [附件子系统](../../../docs/subsystems/attachment.zh.md)——持久 FileBlock 存储和上传 receipts。
- [Agent 包](../../core/agent/README.zh.md)——`agent/pre-step` 事件和已接受的消息批次。
- [Settings forms](../../client/ui-settings/README.zh.md)——持久化插件 Config forms 和 UI slots。
- [Office 转 PDF](../../document/office-to-pdf/README.zh.md)——预览流程中的本地 Office 到 PDF 转换。

-----

<a id="model-experience"></a>
## Model Experience

通过 Agent loop 接受的 `user/message` 内容间接体现。经标准 composer 加入的文件会随普通 Session 提示词提交。成功提取时，同一消息包含原始 FileBlock 和以 `[Extracted from <filename>]` 开头的文本块；PDF 的文本块会标注包含的页码。预处理失败时，同一消息会加入用户可见说明并保留原文件句柄。

#### KV Cache effect

提取会在首次 model call 前把用户内容写入日志，token 用量可能随文档内容增加。提取文本作为已接受消息的一部分保持稳定；修改解析设置只影响后续消息。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **不解析旧版 Office 格式**——`.doc`、`.xls` 和 `.ppt` 仍可作为附件使用，但需要其他 reader。
- **媒体识别需要单独配置 endpoint**——音频转写和视频理解会使用用户指定的服务，上传媒体会离开 Host 进程。
- **OCR 需要配置远程 vision endpoint**——只发送扫描 PDF 页面图片，endpoint 必须接受带 image data URL 的 OpenAI-compatible chat-completions 请求。可配置版本化 API base URL（如 `/v1`）或完整的 `/chat/completions` URL。
- **OCR endpoint 必须保护传输中的凭据**——除 `localhost` 等 loopback HTTP host 外，必须使用 HTTPS。
- **页数和输出均有限制**——超过 `maxPdfPages` 的 PDF 页面不会检查；超过 `maxExtractedChars` 的提取文本会截断。
- **`@` 引用仍是引用**——手动提及不会解析为附件；不支持的 native-path 文件仍走官方引用路径。只有加入标准 composer 的支持格式才成为供 `agent/pre-step` 处理的 FileBlock。
- **composer 集成需要本发行版 Client API**——native-file upload policy registry 是新增的 `ui-conversation` 扩展，并非上游 rc.2 API。应用需先更新 `ui-conversation` 才能让此 Client 功能将 native path 路由为附件。
- **媒体路由依据文件名扩展名**——durable FileBlock 元数据不保留 MIME type；`.mp4`、`.webm` 等有歧义的容器按视频处理。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
