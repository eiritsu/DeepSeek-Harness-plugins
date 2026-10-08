# Agent Note: SkillsMP GitHub 技能安装

Status: implemented

[English](2026-10-08-skillsmp-github-immutable-installation.md) | 中文

## Problem

可选技能目录需要让用户检查社区技能并安装其审阅过的确切文件，同时由官方技能文件系统继续负责激活和发现。

## Decision

`@deepseek-ai/dsh-community-skill-catalog` 组合包提供 `skillsMpCatalog` Host Remote。包名和 `community-skill-catalog` Cordis row ID 仍标识同一个可选组合包。搜索必须提供非空查询，并保留有数量与有效期限制的 SkillsMP 结果缓存；详情请求只接受 Host LRU 中仍保留的 SkillsMP 搜索来源。

搜索页结果按 `cacheTtlMs` 过期。Host 会另外在受 `maxCacheEntries` 限制的 LRU map 中保存来源身份和已审阅 manifest；这些记录不会随搜索页过期，直到被淘汰或 Host dispose。详情请求只接受仍保留在 Host 中的 SkillsMP 搜索结果，向 token endpoint 提交其 `skillId` 和 SkillsMP 页面 URL，再使用返回的 target 请求来源 manifest。Host 要求 target owner 和 repo 与搜索结果的 GitHub URL 一致。对于 `/tree/<ref>/<path>` URL，target branch 的分段与 path 分段必须完整匹配 URL 尾部；仓库根 URL 必须对应空 target path。Host 不会猜测 ref 分界。

Host 会在下载前校验 manifest commit SHA、完整下载标记、文件数、单文件与总大小、安全且唯一的路径，以及精确 canonical raw URL。它会按 manifest raw URL 读取每个文件，计算 Git blob SHA，并返回根 `SKILL.md` 文本供用户检查。安装会重新读取相同的已审阅 raw URL，并校验已记录的大小和 blob SHA；不会重新请求 token、manifest、branch 或 tree。替换已有目录前，Host 会在 `.skillsmp` 下暂存文件，并通过官方 `FileSystemSkillProvider` 列出和加载暂存技能。只有该 provider 返回唯一候选和技能定义时才提交。传输层只接受发往 `https://skillsmp.com` 和 `https://raw.githubusercontent.com` 的无凭据 HTTPS 请求，并拒绝所有 redirect。直连请求会解析并固定公网地址；仅对这两个 origin，Host 也会接受 `198.18.0.0/15` 内的 DNS 答案以支持 TUN 路由，同时保留原始主机名用于 TLS。配置 proxy 路由会跳过本地 origin DNS，使用 proxy 的解析结果。可选 SkillsMP credential 只用于搜索。短时 download token 只保存在内存中并发送到 SkillsMP manifest endpoint；raw 请求不带凭据。

taxonomy Remote 从 SkillsMP 文档页、职业页和叶子组 endpoint 读取本地化分类和职业记录。它会在缓存结果前校验分类 domain、职业父级链接和完整的第四级叶子覆盖。locale maps、职业页 anchor 和叶子标签提供本地化名称；缺少的分组名称使用源提供的英文名称。metadata cache 有大小上限，默认时长为一小时；`forceRefresh` 会绕过缓存。taxonomy 请求不会解析或发送 SkillsMP 搜索 credential。

安装会先将文件暂存到 `.skillsmp`，再原子替换技能目录；如果提交后清理失败，会保留旧目录。取消会等待安装清理完成；Host dispose 会中止并等待活动安装。现有已安装技能目录和 `.skillhub` 数据会留在原处；列表和确认卸载仍只覆盖包含常规 `SKILL.md` 的直接子目录。目录在 `skillRoot` 安装和列出；如果该路径位于官方 provider 默认根目录之外，需在 `skill-filesystem.customSkillDirs` 中配置相同路径，Agent 才能发现和加载。目录不会自动激活技能，也不会执行下载文件。

## Alternatives considered

**保留 SkillHub fallback。** 第二套目录和 release 流程会继续保留过时的 ZIP 配置，并让调用方同时面对两种不兼容的审阅与安装身份。

**下载仓库 archive 或 clone。** 这会传输所选技能目录以外的文件，也无法在暂存前为 Host 提供受限的逐文件 Git blob 清单。

**信任 Client 元数据或由 Client 写入文件。** Host 将搜索身份、commit 选择、文件校验、文件系统策略和事务归属放在一起；浏览器提交的 SHA 或文件清单不能作为安装依据。

**通过 `ctx.skills` 或插件管理器管理安装。** 这些 registry 包含超出全局 DSH 技能根目录直接子目录范围的 provider 和包类型，而此操作必须只移除经确认的直接子目录。

## Consequences

SkillsMP 搜索和来源下载可能触发速率限制或暂时不可用。SkillsMP 网页下载 endpoint 没有稳定性保证；响应格式变化会 fail closed，组合包没有 GitHub API 回退。manifest 协议最多允许每项技能 100 个文件、单文件 512000 字节、总计 5242880 字节；Host 配置可进一步降低这些限制。搜索页 TTL 不会让来源身份或已审阅 manifest 过期；这些记录在有界 Host LRU 中保留到被淘汰或 Host dispose。被淘汰的来源需要重新搜索；被淘汰的 manifest 需要重新查看详情。

`packages/bundle/community-skill-catalog/tests/catalog.host.spec.ts` 通过真实 Loader 组合检查 manifest 校验、commit 固定、暂存 provider 校验、安装替换和文件系统结果。`packages/bundle/community-skill-catalog/tests/taxonomy.host.spec.ts` 检查本地化 RSC 解析、层级校验、缓存刷新和零技能数叶子组。`packages/bundle/community-skill-catalog/tests/egress.spec.ts` mock SkillsMP 和 GitHub raw HTTP，并检查按 origin 限定的公网地址与 TUN DNS 策略、proxy 路由、token 限定、来源状态和 redirect。这个可选目录不会影响 session 或模型可见内容。

## Related

[升级指南](../../../../docs/upgrade-guide/v0.2.0-rc.2/skillsmp-skill-catalog/guide.zh.md)列出了从 v0.2.0-rc.2 升级时的 profile 和 Remote 调用方变更。

[出站 proxy 策略说明](2026-08-27-outbound-proxy-policy.zh.md)负责记录进程级 proxy 路由。
