# Embedded official launcher

This directory contains the launcher, downloader, checksum manifest, package metadata, and license from `@larksuite/cli@1.0.90`. It is embedded so installing the DSH bundle performs no dependency lifecycle script. On first use, the upstream launcher downloads the matching official release binary and verifies its SHA-256 checksum.

The npm-only interactive install wizard is intentionally omitted. Application configuration is owned by the DSH Lark management page and reaches the official CLI through `config init --app-secret-stdin`.
