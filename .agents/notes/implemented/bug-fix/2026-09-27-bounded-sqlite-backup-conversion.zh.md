# Agent Note: 限制离线 SQLite Session 备份转换

Status: implemented

[English](2026-09-27-bounded-sqlite-backup-conversion.md) | 中文

## 问题

显式 schema-2 SQLite 转换器会先加载全部 metadata 与 event 行，再检查 Session 数量。原有 fixture 缺少受保护的 system head 和完整 turn，因此不能证明转换后的历史能通过生产 Agent resume 并持久化后续轮次。

## 决策

转换器会在保留行记录前通过 SQL 检查 Session 与事件行数，以及 header 与事件 JSON 文本合计的 UTF-8 字节数；事件行使用迭代器读取，并支持每次调用传入行数上限和 `maxInputJsonBytes`。默认输入 JSON 上限为 256 MiB，与输出展开大小上限分别计算；JSON 解析后不承诺精确限制对象占用的内存。源文件摘要采用流式读取。既有源文件、展开归档、单个日志、单张图片和最终 ZIP 上限仍分别生效。

归档 Settings 页面提供显式迁移流程：操作者通过 Host 目录选择器选择备份目录、一个普通 `.sqlite` 文件和对应附件根目录。转换器读取私有副本，不会 checkpoint 源数据库，也不会删除其 WAL/SHM sidecar。转换被拒绝时尚未写入 Session；转换成功后会进入常规归档恢复流程，逐项报告部分结果，但不声称跨 Session 事务。

Host fixture 使用 synthetic schema-2 表，包含完整的 V3 parent 与 child turn、首位 system surface head，以及内容寻址的图片和文件对象。测试通过归档 importer 恢复数据，再由带 scripted adapter 的生产 AgentLoop 恢复 parent，通过 JSONL persistence 写入后续 turn，并用新 context 打开已提交的历史。拒绝用例覆盖缺失 child parent、非法序号、WAL/SHM sidecar、损坏 JSON、缺失附件对象和每项可配置上限，包括输入 JSON 字节边界。测试 context 会先释放 fiber，再删除临时目录；不读取或修改用户 profile 或源数据库。

## 考虑过的替代方案

**保留 `.all()`，读取后再拒绝。** 可配置的 Session 上限无法约束 SQLite 已分配的行，而且事件结果数组会与留存的历史重复占用内存。

**直接从用户选定的数据库流式读取。** SQLite 历史恢复可能创建 sidecar 或改变源状态。转换器继续将显式选定的已关闭数据库复制到私有临时目录，并在转换后核对源文件摘要。

**只断言导入后的事件 JSON 可以打开。** 这会漏掉生产 turn startup 再追加 system message 时的失败，也可能把无法 resume 的历史误判为有效。测试改用生产 AgentLoop 和 JSONL provider。

## 后果

Session 与事件计数在行物化前拒绝超限输入；事件行不再先被加载到第二个无界查询数组。由于公开 API 返回完整 ZIP 字节数组，归档输出仍会整体缓冲。默认值与每次调用的覆盖值记录在[归档 README](../../../../packages/session-query/session-archive/README.zh.md)。冻结源 schema、Session 格式与归档格式均未改变。

## 验证

`node node_modules/vitest/vitest.mjs run packages/session-query/session-archive/tests/sqlite-backup.host.spec.ts` 通过转换 fixture 和拒绝用例。`node node_modules/typescript/bin/tsc -b packages/session-query/session-archive/tsconfig.host.json --pretty false` 检查已发布的 Host 源码。
