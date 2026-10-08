---
kind: upgrade-guide
description: "社区技能目录 Remote 从 SkillHub release 改为 SkillsMP 搜索和 GitHub commit 安装。"
---

# 社区技能目录迁移到 SkillsMP 和 GitHub

[English](guide.md) | 中文

## 变更

在 v0.2.0-rc.2 中，`@deepseek-ai/dsh-community-skill-catalog` 提供 `skillHubCatalog` Remote，用于 SkillHub 搜索、版本详情、ZIP 下载和安装。下一版本改为提供 `skillsMpCatalog`，用于 SkillsMP 搜索，以及安装固定到已检查的 40 位 commit SHA 的 GitHub 技能目录。包名和 `community-skill-catalog` Cordis row ID 保持不变；直接调用 Remote 的代码和使用旧 Host Config 字段的 profile row 会受到影响。

现有已安装技能目录会保留，并继续显示在“插件 → 技能”页面。新安装器不会迁移或删除技能目录或 `.skillhub` 数据；每次安装仍需确认已检查的 commit。

## 迁移

1. 保留 `community-skill-catalog` row 和包条目。删除旧 Host Config 字段 `endpoint`、`downloadTimeoutMs`、`maxArchiveEntries`、`maxArchiveBytes` 和 `maxMetadataBytes`；不再支持 SkillHub fallback 或 archive 下载。
2. 如需使用 SkillsMP API key，将 `skillsmpCredentialKey` 设为包含该 key 的 DSH Credentials 引用。该 key 可选，且只发送给 SkillsMP 搜索请求。来源 manifest 使用 SkillsMP 网页下载 endpoint 和 GitHub raw 文件 URL；不需要 GitHub API 凭据，也没有其他来源回退。可在 manifest 上限内调整 `operationTimeoutMs`、`maxResponseBytes`、`maxFileBytes`、`maxFiles`、`maxTotalBytes`、`cacheTtlMs` 或 `maxCacheEntries`：最多 100 个文件、单文件 512000 字节、总计 5242880 字节。`cacheTtlMs` 只用于搜索页；来源身份和已审阅 manifest 保留在有界 LRU 中，直到被淘汰或 Host dispose。taxonomy metadata 默认缓存一小时；`metadataCacheTtlMs` 可调整缓存时长，`maxTaxonomyEntries` 限制可接受的 taxonomy 大小。目录页面可手动刷新 taxonomy，刷新会绕过缓存。
3. 将 Remote 调用方改为使用非空查询执行搜索；`detail` 使用 `githubUrl`；`installSkill` 使用 `githubUrl` 和已检查的 `commitSha`。如果自定义 `skillRoot` 位于官方 provider 默认根目录之外，请在 `skill-filesystem.customSkillDirs` 中配置相同路径，让 Agent 能发现并加载已安装技能。SkillsMP 网页下载 endpoint 没有稳定性保证；格式变化会 fail closed，且不会回退到 GitHub API。确认搜索与详情可用，并检查安装结果返回了已确认的 commit SHA。
