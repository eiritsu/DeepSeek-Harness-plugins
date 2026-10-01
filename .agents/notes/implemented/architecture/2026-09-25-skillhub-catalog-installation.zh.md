# Agent Note: SkillHub 技能安装

Status: implemented

[English](2026-09-25-skillhub-catalog-installation.md) | 中文

## Problem

SkillHub 是独立的技能目录；已安装技能由官方 Skill registry 与 filesystem provider 发现和激活。

## Decision

可选的 `dsh-skillhub-catalog` Host Remote 使用 SkillHub 的目录、详情、文件清单与精确版本 ZIP 下载 API。它将 ZIP 流式写入私有暂存区，校验 `_meta.json`、归档路径与 CRC，并在替换已有技能前按清单验证每个文件的大小和 SHA-256。调用方必须明确确认精确版本。官方文件系统继续负责发现和加载已安装技能。

SkillHub 目录列表提供命名空间限定的 `canonicalName`，但其文档规定的详情与文件路由只接受 slug。Remote 在读取详情前、读取文件前及提交下载目录前，都会验证该 slug 当前只对应一个列表项且 `canonicalName` 一致。若 slug 重复、身份缺失或返回的 canonical name 不匹配，操作会停止；列表项仍会显示。安装目录使用 URI 编码后的 canonical name，避免不同发布者覆盖彼此目录。Remote 不会推断旧裸 slug 目录的发布者归属，也不会改动这些目录。

安装器不会运行包管理器，也不安装插件。API 的 1 MiB 文件限制只适用于文件预览；安装使用精确版本 ZIP 路由。可配置的本地预算限制压缩字节、解压字节、归档条目、安装文件、元数据字节和下载时限。重定向必须保持为不含凭据的 HTTPS，且只能解析到公网 IP 地址。取消会在提交目录前停止操作；Host dispose 会等待活动安装清理暂存目录。同一 canonical identity 的并发安装会被拒绝。若新目录已提交但旧备份清理失败，安装仍算成功，结果会包含保留备份路径。

插件 → 技能页面只会列出配置的全局 DSH 技能根目录中的非隐藏直接子目录，且其中的 `SKILL.md` 必须是普通文件。移除操作只接受已列出的直接子目录名，要求显式确认，并再次检查根目录和技能文件后删除该目录。项目根目录、`~/.agents`、独立 Markdown 文件和内置技能不在操作范围内。页面直接读取文件系统，不维护第二份已安装技能 registry。

## Alternatives considered

**复用腾讯 `@tencent/skillhub` 安装器。**它公开的 Host 函数是模型工具，并非可复用目录 Remote；其安装实现也没有提供所需的有界、可回滚事务。

**通过插件管理器安装目录技能。**SkillHub 技能属于官方本地技能根目录，并由官方技能文件系统发现；它们不是插件。

**让 Client 直接写入技能根目录。**Host 拥有文件系统访问权限，并负责校验和暂存，以免浏览器代码绕过这些检查。

**通过 `ctx.skills` 管理所有 provider 的结果。**该 registry 会合并项目、用户、内置和非文件系统 provider；其目录项不会标识 Host 可安全删除的某个全局目录。

## Consequences

可选目录能够安装压缩包和解压内容均在本地配置预算内的技能；单个文件不受预览接口 1 MiB 上限限制。下载或暂存失败会保留旧目录。未能删除的旧备份会留在返回路径供检查或手动清理；配置技能根目录中的新版本已提交。官方技能文件系统负责发现与激活技能；Plugins 页面提供全局 DSH 根目录中目录技能的确认移除操作，不索引其他 provider 或根目录。

## Testing

`packages/bundle/community-skill-catalog/tests/egress.spec.ts` 覆盖从精确版本 ZIP 安装超过 1 MiB 的文件、哈希不符和损坏归档不会替换旧技能、配置预算拒绝，以及 Host dispose 等待取消流清理。同一测试也覆盖目录身份检查和代理路由。`packages/bundle/community-skill-catalog/tests/catalog.host.spec.ts` 覆盖目录替换回滚、旧备份保留、已安装技能枚举和确认后删除。Client 测试覆盖安装版本确认、移除确认和 Plugins 页组合。
