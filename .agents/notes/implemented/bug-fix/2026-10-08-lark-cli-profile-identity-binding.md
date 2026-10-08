# Agent Note: Bind the Lark CLI profile to one application identity

Status: implemented

English | [中文](2026-10-08-lark-cli-profile-identity-binding.zh.md)

## Problem

`dsh-lark-integration` ran `lark-cli config init` before every command, in both the model-facing `lark_cli` tool and the setup flows. That official command replaces the whole profile list unless it is given `--name`, and replacing deletes each profile's `users` array — the records where the CLI keeps which user authorized this application through device flow. Every call therefore erased the authorization the setup had just produced, and `lark_cli auth status` reported no authorized user after the first command.

The same call also had no way to express *which* application a command belongs to. The official CLI stores every application in one profile directory and resolves the default profile to the first entry, so two Hosts configured with different applications under one Harness home selected each other's identity, and the model could add `--profile` to point a command at any profile in the directory.

## Decision

**Each application identity owns one named CLI profile, and every command selects it.** The name is `dsh-<brand>-<first 32 hex characters of sha256(appId)>`, which stays inside the official 64-character profile name limit and keeps two applications of one product domain apart. Configuration uses `config init --name` against that profile, so the official CLI updates it in place and keeps its authorization records.

**The profile is selected by the integration, not by the model or the environment.** Every spawn passes `--profile <name>` ahead of the model's arguments, where an option separator cannot move it behind them, and clears `LARKSUITE_CLI_PROFILE`, `LARKSUITE_CLI_APP_ID`, `LARKSUITE_CLI_APP_SECRET`, and `LARKSUITE_CLI_BRAND` from the child environment. The official CLI reads an application identity from those names as well as from the profile, so an ambient export would otherwise change or break the effective application. A model-supplied `--profile` in either the `--profile X` or `--profile=X` form is refused, because the last such flag wins and reordering arguments would corrupt an argument that merely carries that text as its value.

**A configuration written before named profiles is adopted before the first initialization.** Such a configuration holds one unnamed profile named after its application ID. The Host reads `profile list`, and when that profile is absent and an unnamed profile records the same application ID and product domain, it runs `profile rename` and then re-reads the listing. Only an identical application ID and brand qualifies, so an authorization issued for another identity is never reused. The rename result is verified rather than trusted: the official command reports success for a source it cannot resolve.

**Every identity check compares the application ID and the product domain, not the name alone.** A profile that already holds this bundle's name but records another application is a collision or corruption, and the Host fails instead of answering with another application's configuration. The same comparison runs after a rename.

## Alternatives considered

**Initialize only when the configuration does not already match.** Reading the configuration first would avoid a subprocess on most calls. The application secret is stored as a keychain reference rather than a value, so the Host cannot tell a rotated secret from the current one and would keep using the stale one. Initializing on every call is what makes a credential rotation take effect.

**Initialize only once per process and cache the result.** The authorization records live in the profile directory, so they survive a restart; a process-local cache does not, and the bug this fixes is invisible to anything but the stored records.

**Keep one profile per product domain.** Two applications of one domain would share a profile and overwrite each other's identity, and the process-wide queue that serializes commands does not span the Web and Desktop runtimes that share one Harness home.

**Copy the unnamed profile's records into the new profile instead of renaming.** It means writing the CLI's own configuration file, and a partially written file would leave the Host unable to read either profile. The official `profile rename` carries the authorization record onto the new name and keeps the stored application secret and its keychain reference, so nothing is moved or copied.

**Adopt any unnamed profile whose application matches, ignoring the product domain.** A device authorization issued by one product domain is not valid on the other, so the record would be carried into a profile the CLI cannot use.

**Leave the old unnamed profile in place and select it instead.** The product domain already separates the two authorizations, so this would not misdirect a command. It leaves two naming schemes for one identity in the same directory, so every later change has to work out which name a given application uses, and a second application has no profile of its own to select.

## Consequences

A Host configured with a new application creates its own profile and leaves the previous one, so its authorization records stay available and the official `profile remove` clears one on request. Switching the product domain likewise selects a different profile, because a grant issued for one domain is not valid on the other.

A user upgrading from a release that used unnamed profiles keeps their existing authorization; the first command renames the profile in place. A configuration the CLI cannot parse fails the command instead of being replaced, and the failure names the unreadable configuration rather than silently discarding it.

Each command costs one additional `profile list` process before the initialization and command it already ran, so the tool's budget covers five process deadlines — listing, an optional rename and its confirming listing, initialization, and the command — instead of two. The CLI writes its configuration locally and validates the application separately, so the listing and the write succeed without network access and a command fails only when the CLI reports the application itself unusable.

The official CLI keeps each application's secret beside the shared master key, outside the profile directory, so deleting a test's configuration directory does not release the secrets that directory caused to be written. `tests/lark-cli-official.host.spec.ts` therefore names its applications uniquely per case and runs the official `config remove` before deleting anything, and fails when that removal fails rather than leaving a file behind. The official binary is downloaded on first CLI use and is not part of the package, so that suite skips on a host without it. It runs the bundle's real arguments against the real binary in a temporary Harness home with a dead proxy, which proves the official configuration behavior the unit suite can only stub: adopting an older configuration, keeping its records across a restart, keeping two applications apart, separating the two product domains, and refusing to reuse a record after an identity change.