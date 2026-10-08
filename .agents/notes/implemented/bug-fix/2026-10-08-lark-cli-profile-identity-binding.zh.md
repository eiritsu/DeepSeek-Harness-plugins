# Agent Note: Bind the Lark CLI profile to one application identity

Status: implemented

[English](2026-10-08-lark-cli-profile-identity-binding.md) | 中文

## Problem

`dsh-lark-integration` 在模型可调用的 `lark_cli` 工具和设置流程中，都会在每条命令前执行 `lark-cli config init`。这条官方命令在没有 `--name` 时会整体替换 profile 列表，而替换会删除每个 profile 的 `users` 数组——CLI 用它记录哪位用户通过 device flow 授权了该应用。于是每次调用都会抹掉刚刚建立的授权，第一次命令之后 `lark_cli auth status` 报告没有已授权用户。

同一次调用也没有表达命令属于哪个应用的方式。官方 CLI 把所有应用保存在同一个 profile 目录中，并把默认 profile 解析为第一个条目，因此共用一个 Harness home、配置了不同应用的两个 Host 会选中彼此的身份；模型还可以加 `--profile` 把命令指向目录中的任意 profile。

## Decision

**每个应用身份拥有一个具名 CLI profile，每条命令都选中它。**名称为 `dsh-<brand>-<sha256(appId) 前 32 位十六进制>`，长度在官方 64 字符上限之内，并让同一产品域名下的两个应用彼此分开。配置使用针对该 profile 的 `config init --name`，官方 CLI 会就地更新并保留其中的授权记录。

**profile 由集成指定，不由模型或环境决定。**每次启动都会在模型参数之前传入 `--profile <name>`，选项分隔符无法把它移到模型参数之后；同时清除子进程环境中的 `LARKSUITE_CLI_PROFILE`、`LARKSUITE_CLI_APP_ID`、`LARKSUITE_CLI_APP_SECRET` 和 `LARKSUITE_CLI_BRAND`。官方 CLI 除了 profile 还会从这些名字读取应用身份，因此环境中的既有导出否则会改变或破坏实际生效的应用。模型自带的 `--profile`（`--profile X` 或 `--profile=X` 两种写法）会被拒绝，因为最后一个该标志生效，而重排参数会破坏恰好把这段文本当作取值的参数。

**在首次初始化之前，接管命名 profile 之前写入的配置。**这类配置保存一个以应用 ID 命名的未命名 profile。Host 读取 `profile list`；当该 profile 不存在、且某个未命名 profile 记录着相同的应用 ID 与产品域名时，执行 `profile rename` 后重新读取列表。只有应用 ID 与品牌都一致才符合条件，因此为其他身份签发的授权绝不会被复用。rename 的结果需要验证而不是直接采信：这条官方命令对无法解析的源也会报告成功。

**每一处身份检查都比较应用 ID 与产品域名，而不只看名称。**已占用此名称却记录着另一个应用的 profile 属于碰撞或损坏，Host 会失败而不是用另一个应用的配置作答。rename 之后执行同样的比较。

## Alternatives considered

**仅在配置不匹配时初始化。**先读取配置可以避免大多数调用的一次子进程。应用密钥存储为 keychain 引用而非值，Host 无法区分已轮换的密钥与当前密钥，于是会继续使用过期密钥。每次调用都初始化才能让密钥轮换生效。

**每个进程只初始化一次并缓存结果。**授权记录保存在 profile 目录中，因此能跨重启保留；进程内缓存不能，而本次修复的缺陷只有存储的记录才能暴露。

**每个产品域名一个 profile。**同一域名下的两个应用会共用一个 profile 并互相覆盖身份，而串行化命令的进程内队列并不覆盖共用同一 Harness home 的 Web 与 Desktop 运行时。

**把未命名 profile 的记录复制进新 profile，而不是重命名。**这需要写入 CLI 自己的配置文件，而写入不完整会让 Host 两个 profile 都读不了。官方 `profile rename` 会把授权记录带到新名称上，并沿用已存储的应用密钥及其 keychain 引用，因此不移动也不复制任何密钥。

**忽略产品域名，只要应用匹配就接管未命名 profile。**一个产品域名签发的 device 授权在另一个域名无效，记录会被搬进 CLI 无法使用的 profile。

**保留旧的未命名 profile 并改为选中它。**产品域名已经分开两处授权，因此不会把命令指向错误的身份。但同一目录中会为同一个身份留下两套命名，此后每次改动都要先弄清某个应用用的是哪个名称，而且第二个应用没有属于自己的 profile 可供选中。

## Consequences

配置了新应用的 Host 会创建自己的 profile 并保留旧的，因此旧 profile 的授权记录仍可使用，需要时可用官方 `profile remove` 清除。切换产品域名同样会选中不同的 profile，因为一个域名签发的授权在另一个域名无效。

从使用未命名 profile 的版本升级的用户会保留已有授权：第一次命令会把 profile 就地重命名。CLI 无法解析的配置会让命令失败而不是被替换，失败信息指出配置不可读，不会静默丢弃。

每条命令在原本的初始化与命令之外，多一次 `profile list` 进程，因此工具预算覆盖五个进程截止时间——列表、可选的 rename 及其确认列表、初始化和命令——而不是两个。CLI 在本地写入配置、另行校验应用，因此列表读取与写入都不需要网络，只有当 CLI 报告应用本身不可用时命令才会失败。

官方 CLI 把每个应用的密钥保存在共享 master key 旁边，位于 profile 目录之外，因此删除测试的配置目录并不会释放该目录导致写入的密钥。`tests/lark-cli-official.host.spec.ts` 因此按用例唯一命名其应用，并在删除任何内容之前执行官方 `config remove`，且在该移除失败时报错，而不是留下文件。官方 binary 在首次使用 CLI 时下载，不随包分发，因此该套件在没有该 binary 的主机上自动跳过。它在临时 Harness home 中以失效代理运行此包的真实参数与真实 binary，验证单元测试只能桩替的官方配置行为：接管旧配置、跨重启保留其记录、让两个应用彼此分开、区分两个产品域名，以及身份变更后不复用记录。