# Change Log

All notable changes to the **Zone-Cog Cognitive Bridge** extension are documented
in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-08-15

First marketplace-ready release of the ADS-independent Zone-Cog bridge extension.

### Added

- TypeScript extension host implementation using only the public `vscode` API
  and Node.js HTTP modules (no `azdata` dependency).
- Command Palette actions under the **Zone-Cog** category:
  - **Check Cognitive Bridge Health** (`zonecog.checkBridgeHealth`)
  - **Ingest Database Schema** (`zonecog.ingestSchema`)
  - **Ingest Table Data** (`zonecog.ingestActiveTable`)
  - **Run Cognitive Analysis** (`zonecog.runCognitiveAnalysis`)
  - **Set Cognitive Bridge Auth Token** (`zonecog.setBridgeAuthToken`)
- Configuration:
  - `zonecog.bridge.baseUrl` (default `http://127.0.0.1:7807`)
  - `zonecog.bridge.requestTimeout` (default `15000` ms)
  - `zonecog.bridge.maxResponseBytes` (default `1048576` bytes)
- Optional bearer credentials stored in VS Code **SecretStorage**, with one-time
  migration from legacy `zonecog.bridge.authToken` settings.
- Payload validation for schema, table, and reason requests before they are sent.
- Bounded HTTP transport (timeout + max response bytes) with clear error messages.
- Marketplace packaging assets:
  - 128×128 extension icon (`media/icon.png`)
  - Dark gallery banner color (`#111321`) and README banner (`media/banner.png`)
  - README screenshots for commands, output, and settings
- Packaging scripts:
  - `yarn package` — build a `.vsix`
  - `yarn package:dry-run` — pre-publish `vsce package` validation
  - `yarn validate:marketplace` — manifest / asset / command metadata checks
- CI/CD (`.github/workflows/zonecog-bridge.yml`):
  - compile, test, and packaging dry-run on every relevant PR/push
  - tag-driven release (`zonecog-bridge-v*.*.*`) that uploads a VSIX artifact,
    creates a GitHub Release, and publishes to the VS Code Marketplace / Open VSX
    when `VSCE_PAT` / `OVSX_PAT` secrets are configured
- Publisher setup guide: `docs/ZONECOG_BRIDGE_PUBLISHING.md`
- Real HTTP transport and payload unit tests (no mocks)

### Security

- Auth tokens are never written to `settings.json`
- Bridge responses are rejected when they exceed `maxResponseBytes`
- Request timeouts prevent hung extension-host operations

## [Unreleased]

- Nothing yet.
