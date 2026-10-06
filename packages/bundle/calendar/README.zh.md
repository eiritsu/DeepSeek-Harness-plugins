---
description: "供 Web 与桌面使用的日程 profile 组合层，汇集 Schedule 自动化、本地条目和用户提供的 iCalendar 订阅。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-calendar

面向 Web 与桌面应用的日程视图，聚合 Schedule 自动化、本地条目和用户自行提供的 iCalendar 订阅。

[English](README.md) | 中文

## 概述

一个面向 Web 与桌面应用的日程页面，将 Schedule 自动化、本地条目和用户自行提供的 iCalendar 订阅汇集到同一视图中。启用官方 Schedule bundle 时，它读写这些自动化；未启用时页面仍显示本地数据与订阅，所有任务操作都会报告缺失的服务。

## 目录

- [使用本包](#use-this-package)
- [页面展示什么](#what-it-shows)
- [订阅、导入与时区](#subscriptions-imports-and-time-zones)
- [配置](#configuration)
- [数据与权限](#data-and-permissions)
- [验证安装](#verifying-an-install)
- [进一步了解](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

在 Web 或桌面的 **Plugins → Install** 中安装打包产物，或把本地路径加入 profile：

```sh
dsh plugin --profile <profile> add /absolute/path/to/deepseek-ai-dsh-calendar-0.2.0-rc.2.tgz
```

本包已在 Eiritsu 的 `@deepseek-ai/dsh` **0.2.0-rc.2** 发行版上验收，适用 Web 与桌面。其他 Harness 发行版尚未验证：本包挂载的是 `0.2.0-rc.2` 的 Remote 与存储接口，接口不一致的发行版无法使用。

本 bundle 向 profile 插入一行 `calendar`。它依赖每个 profile 已经组合的存储服务（`@deepseek-ai/dsh-storage-domain` 及其后端）。

**自动化需要官方 Schedule bundle。** 日历通过 `ctx.schedule` 读写自动化，而本 bundle 不挂载它：没有 `id` 的 patch 插入总是追加，因此在这里插入该行会在已启用它的 profile 中启动第二个 Schedule 服务——第二份任务存储和第二个投递定时器。需要自动化请启用 `@deepseek-ai/dsh-schedule`，例如通过 `@deepseek-ai/dsh-experimental-schedule-bundle`。未启用时日历仍会挂载，页面仍显示本地条目、导入与订阅，所有任务操作返回 `service-unavailable`，而不是启动失败。

模型用 `schedule_create` 创建的任务与人在日历中创建的任务是同一条存储记录，日历同时读取两者。

<a id="what-it-shows"></a>
## 页面展示什么

一次快照按请求的时间范围与时区返回：宿主时钟与时区、每条 Schedule 任务及其记录状态、这些任务在该范围内的发生项、本地条目，以及每个订阅与导入各自读到的条目。

任务报告 `active` 或 `inactive`，并在有记录时给出 `lastDelivery` 回执。**回执记录的是提醒已进入会话收件箱，并不表示 Agent 已处理它**；页面也不会为任务渲染成功或失败徽标。

到点时由宿主 Schedule 服务自行解析并恢复会话，因此为未打开的会话创建的自动化在应用运行时仍会按时投递。为新建自动化列出会话不会激活任何 Agent。**应用完全退出期间不会投递任何内容**，直到它重新启动；退出期间到点的提醒会在启动后投递，不会补扫这段时间错过的发生项。

会话选择器提供的范围与工作区浏览器一致：任意工作区中的普通会话（包括宿主尚未恢复的冷会话）都可选择，但绝不提供子代理会话或用户已归档的会话；空白会话中只有当前会话会出现。已绑定到之后被隐藏会话的任务仍保留其存储记录与关联历史。

<a id="subscriptions-imports-and-time-zones"></a>
## 订阅、导入与时区

订阅是用户自行取得的 `https:` 或 `http:` URL，宿主不会自行发现。重定向只跟随用户选择的协议，每次抓取都有截止时间与字节上限，响应在配置的边界内展开。失败的订阅保留上一次成功的数据，并把失败信息挂在自身上，因此停止响应的订阅不会让页面变空。

导入的 iCalendar 文本会作为独立日历存储，与订阅一样只读。**两个来源都不会回写**：不会向上游新增、修改或删除任何 `VEVENT`，也不会因此启动 Agent。订阅自身的配置——名称、URL 与刷新间隔——可在配置页编辑；上游事件不可编辑。没有忙闲查询，没有组织者回复。

配置页支持选择 `.ics` 文件或粘贴文件内容。页面会显示所选文件名，以当前界面语言提示读取失败，并在导入成功后清除选择，因此可以再次导入同一个文件。刷新间隔留空时使用配置的默认值。

`ical.js` 解析 `RRULE`、`EXDATE`、`RECURRENCE-ID` 覆盖、全天 `VALUE=DATE` 值与 UTC 时间。文档自带的 `VTIMEZONE` 定义只对该文档生效，因此两个对同名时区定义不同的订阅不会互相污染。

以下两种情况**会被拒绝而不是猜测**，因为 `ical.js` 否则会按进程所在时区换算，同一事件在不同机器上会落在不同时间：

- 文档未定义其 `TZID` 的日期时间；
- 完全不声明时区的浮动日期时间。

两者都会给出固定文案：只说明拒绝原因，不含文档内容或时区名称，因此私有订阅的内容不会进入日志行或客户端消息。全天值不受影响：它是源日历自身的民用日期，按原样保留。

<a id="configuration"></a>
## 配置

每个边界都是 `calendar` 行上的字段，可在 profile patch 或插件详情页编辑。修改在下一次读取时生效，无需重启宿主。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `fetchTimeoutMs` | `15000` | 单次订阅抓取的截止时间，覆盖连接、重定向与响应体。 |
| `maxResponseBytes` | `2097152` | 接受的最大响应体。 |
| `defaultRefreshIntervalSeconds` | `3600` | 新订阅未指定时使用的刷新间隔。 |
| `minRefreshIntervalSeconds` | `300` | 客户端可请求的最短间隔。 |
| `maxRefreshIntervalSeconds` | `86400` | 客户端可请求的最长间隔。 |
| `retentionDays` | `90` | 订阅向后展开的天数。 |
| `maxEventsPerSubscription` | `1000` | 一个订阅可读取的最大 `VEVENT` 组件数。 |
| `maxOccurrencesPerEvent` | `366` | 单个事件对一次范围可贡献的最大发生项数。 |
| `maxExpansionIterations` | `5000` | 单个事件允许求值的最大规则步数。 |
| `maxOccurrencesPerSubscription` | `5000` | 单个来源可存储的最大发生项数。 |
| `expansionHorizonDays` | `180` | 订阅相对宿主时钟向前展开的天数。 |
| `maxImportedCalendars` | `25` | 可存储的最大导入数。 |
| `maxEntriesPerSnapshot` | `5000` | 单次快照返回的最大条目数。 |
| `maxOccurrencesPerTask` | `400` | 单个任务可贡献的最大发生项数。 |
| `maxOccurrences` | `2000` | 单次快照返回的最大任务发生项数。 |

被边界拒绝的发生项会被报告而不是隐藏：订阅见 `subscription.droppedEntryCount`，导入见 `calendar.droppedEntryCount`，快照自身的上限见 `snapshot.occurrencesTruncated` 或 `snapshot.entriesTruncated`。重复规则只是走到范围末尾不算截断。

<a id="data-and-permissions"></a>
## 数据与权限

日历拥有一个名为 `calendar` 的存储域，含三张表：`subscriptions`、`entries` 和 `imports`。下次启动会重新打开它们，因此订阅及其条目可跨重启保留。停用插件或关闭 profile 会停止刷新定时器、中止所有在途抓取并关闭存储域；不会有定时器、请求或流在插件之后残留。

订阅 URL 只在用户填写它的配置页展示，绝不写入日志。日志行只记录订阅名称与失败码，绝不含订阅 URL 或正文。

网络访问仅限于用户添加的 URL 及其所选协议。没有凭据存储，也没有遥测。

本包不发布 invariant companion，因为它不拥有可独立观察的关系：存储投影的正是它自己已经持有的持久行与实时刷新状态，而真实组合的 Host 测试覆盖打开、刷新与释放。

<a id="verifying-an-install"></a>
## 验证安装

已构建的包会从自身构建产物进行冒烟测试，不使用任何仓库路径解析：

```sh
pnpm --filter @deepseek-ai/dsh-calendar run test:packed-artifact
```

它断言每个构建产物都存在、生成的 Remote 描述符包含全部十四个方法，并且用随包入口构建的 profile 行会激活、能回答一次快照、并在该行被停用时正常释放。它要求先完成包构建（`tsc -b tsconfig.host.json`，再 `tsdown --env.DSH_BUILD_FACE host`）；它不在单元测试中运行，单元测试保持在源码平面。

<a id="further-exploration"></a>
## 进一步了解

- [`src/ics.ts`](src/ics.ts) 读取 iCalendar 文本：时区注册、重复规则、覆盖项，以及对无法解释的时区的拒绝。
- [`src/subscriptions.ts`](src/subscriptions.ts) 拥有串行写入链、刷新定时器，以及丢弃陈旧抓取的订阅代次。
- [`src/service.ts`](src/service.ts) 是 Remote 接口，包含可选 Schedule 行为与快照的范围规则。
- [`cordis.patch.yml`](cordis.patch.yml) 是面向 profile 的行及其配置。

<a id="model-experience"></a>
## 模型体验

无直接贡献：日历不添加提示段落、工具 schema 或 Session 事件；唯一的提醒由原生 Schedule 服务投递。

#### KV Cache effect

日历不发起任何模型请求，因此不会改变缓存前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

- **没有暂停或恢复。** 删除任务后重新创建；任务只有启用或已结束两种状态。
- **没有工作日或节假日规则。** 节假日日历只是普通订阅；这里不声称实现调休或任何其他司法辖区的日历法规。
- **不新建会话。** 提醒始终进入绑定的那个会话。
- **来源只读。** 订阅与导入的条目不能单独编辑或删除；删除来源才会移除其条目。
- **浮动时间与未定义时区会被拒绝**，如上所述，而不是按某个选定时区解释。
- **不渲染 `VALARM`、`ATTACH` 等组件细节**，也从不回写订阅。
- **应用停止时不守时。** 应用未运行时到点的提醒会在它再次启动后投递。

<a id="dev-note"></a>
### 开发备注

无。
