# Azure Data Studio - Zone-Cog Edition Release Guide

This document outlines the complete process for building and releasing Zone-Cog Edition binaries across all supported platforms.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Build Targets](#build-targets)
3. [Local Development Build](#local-development-build)
4. [Production Release Build](#production-release-build)
5. [GitHub Actions Release](#github-actions-release)
6. [Azure Pipelines Release](#azure-pipelines-release)
7. [Quality Gates](#quality-gates)
8. [Artifact Verification](#artifact-verification)
9. [ZoneCog Services](#zonecog-services)

---

## Prerequisites

### Node.js Environment

- **Node.js**: v20.17 (as specified in `.nvmrc`)
- **Package Manager**: Yarn with frozen lockfile

```bash
# Install correct Node version
nvm install 20.17
nvm use 20.17

# Verify
node --version  # Should output v20.17.x
```

### Platform-Specific Requirements

#### Linux
```bash
sudo apt-get update
sudo apt-get install -y \
  libkrb5-dev \
  libsecret-1-dev \
  libx11-dev \
  libxkbfile-dev \
  libxss1 \
  libgtk-3-0 \
  libgbm1 \
  xvfb \
  rpm \
  fakeroot
```

#### Windows
- Visual Studio Build Tools 2022
- Python 3.11.x
- Windows SDK

#### macOS
- Xcode Command Line Tools
- Code signing certificates (for release builds)

### Rust Toolchain (for CLI)
```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Verify
cargo --version
rustc --version
```

---

## Build Targets

### Platform Matrix

| Platform | Architecture | Package Formats | Output Directory |
|----------|-------------|-----------------|------------------|
| Windows | x64 | ZIP, EXE | `azuredatastudio-win32-x64/` |
| Windows | arm64 | ZIP, EXE | `azuredatastudio-win32-arm64/` |
| Linux | x64 | tar.gz, DEB, RPM | `azuredatastudio-linux-x64/` |
| Linux | arm64 | tar.gz, DEB, RPM | `azuredatastudio-linux-arm64/` |
| Linux | armhf | tar.gz, DEB, RPM | `azuredatastudio-linux-armhf/` |
| macOS | x64 | ZIP, DMG | `Azure Data Studio.app` |
| macOS | arm64 | ZIP, DMG | `Azure Data Studio.app` |
| macOS | Universal | ZIP, DMG | `Azure Data Studio.app` |

---

## Local Development Build

### Quick Start

```bash
# Clone repository
git clone https://github.com/EchoCog/azurechodatastudio.git
cd azurechodatastudio

# Install dependencies
yarn --frozen-lockfile

# Compile TypeScript
yarn compile

# Download Electron
yarn electron x64

# Run tests
./scripts/test.sh
```

### Development Server

```bash
# Watch mode for development
yarn watch

# Run the application
./scripts/sql.sh
```

---

## Production Release Build

### Full Compilation

```bash
# 1. Install dependencies
yarn --frozen-lockfile

# 2. Compile production build
yarn compile-build

# 3. Compile extensions
yarn compile-extensions-build

# 4. Minify (optional, for smaller packages)
yarn minify-vscode
```

### Platform-Specific Packaging

#### Windows x64
```bash
yarn electron x64
yarn gulp vscode-win32-x64-min
# Creates: ../azuredatastudio-win32-x64/
```

#### Windows ARM64
```bash
yarn electron arm64
yarn gulp vscode-win32-arm64-min
# Creates: ../azuredatastudio-win32-arm64/
```

#### Linux x64
```bash
yarn electron x64
yarn gulp vscode-linux-x64-min

# Create packages
yarn gulp vscode-linux-x64-prepare-deb
yarn gulp vscode-linux-x64-build-deb

yarn gulp vscode-linux-x64-prepare-rpm
yarn gulp vscode-linux-x64-build-rpm
```

#### macOS
```bash
yarn electron x64
yarn gulp vscode-darwin-x64-min

yarn electron arm64
yarn gulp vscode-darwin-arm64-min

# Create Universal Binary
node build/darwin/create-universal-app.js \
  path/to/x64/app \
  path/to/arm64/app \
  path/to/universal/output
```

### CLI Build (Rust)

```bash
cd cli

# Debug build
cargo build

# Release build (optimized)
cargo build --release

# Output: cli/target/release/code (or code.exe on Windows)
```

---

## GitHub Actions Release

### Trigger Options

1. **Manual Dispatch**: Go to Actions → Release Build → Run workflow
2. **Tag Push**: Push a tag matching `v*.*.*`

```bash
# Create and push a release tag
git tag v1.53.0
git push origin v1.53.0
```

### Workflow File

The release workflow is defined in `.github/workflows/release.yml` and includes:

- **Compile Stage**: TypeScript and extension compilation
- **Platform Builds**: Parallel builds for all platforms
- **CLI Builds**: Rust CLI for all platforms
- **Checksum Generation**: SHA256 for all artifacts
- **Release Creation**: Automatic GitHub release

### Artifacts

All build artifacts are:
- Uploaded as GitHub Actions artifacts (30-day retention)
- Attached to GitHub releases (permanent)
- Accompanied by SHA256 checksums

---

## Azure Pipelines Release

For enterprise releases, use Azure Pipelines:

```bash
# Trigger: build/azure-pipelines/sql-product-build.yml

# Set variables:
VSCODE_BUILD_WIN32=true
VSCODE_BUILD_LINUX=true
VSCODE_BUILD_MACOS=true
VSCODE_BUILD_MACOS_ARM64=true
VSCODE_QUALITY=stable
```

---

## Quality Gates

### Pre-Release Checklist

- [ ] All unit tests pass
- [ ] Extension unit tests pass
- [ ] Hygiene checks pass
- [ ] ESLint validation passes
- [ ] TypeScript strict compilation succeeds
- [ ] ZoneCog services registered correctly
- [ ] Code signing successful (if applicable)
- [ ] Smoke tests pass on each platform

### Validation Commands

```bash
# Run unit tests
./scripts/test.sh

# Run extension tests
./scripts/test-extensions-unit.sh

# Run hygiene checks
yarn gulp hygiene

# Run ESLint
yarn eslint

# TypeScript strict check
yarn tsec-compile-check
```

---

## Artifact Verification

### Checksum Verification

```bash
# Generate checksums
node build/checksums/generate-checksums.js generate .build checksums/

# Verify checksums
node build/checksums/generate-checksums.js verify checksums/SHA256SUMS.txt .build

# Manual verification
sha256sum -c checksums/SHA256SUMS.txt
```

### Expected Artifact Sizes

| Artifact | Expected Size |
|----------|--------------|
| Windows ZIP | ~350 MB |
| Linux tarball | ~350 MB |
| macOS ZIP | ~400 MB |
| macOS Universal | ~750 MB |
| DEB package | ~350 MB |
| RPM package | ~350 MB |

---

## ZoneCog Services

The following cognitive services must be included in the release:

| Service | Interface | Description |
|---------|-----------|-------------|
| ZoneCogService | `IZoneCogService` | 11-phase adaptive thinking protocol |
| HypergraphStore | `IHypergraphStore` | EchoCog-standard knowledge graph |
| CognitiveMembraneService | `ICognitiveMembraneService` | P-System Cerebral/Somatic/Autonomic triads |
| LLMProviderService | `ILLMProviderService` | Pluggable LLM backends |
| EmbodiedCognitionService | `IEmbodiedCognitionService` | Sensorimotor grounding loop |
| CognitiveWorkspaceService | `ICognitiveWorkspaceService` | Working memory, episodic memory, tasks |
| ECANAttentionService | `IECANAttentionService` | Economic Attention Network |
| CognitiveLoopService | `ICognitiveLoopService` | Autonomous cognitive cycle |

### Service Location

All ZoneCog services are located at:
```
src/sql/workbench/services/zonecog/
├── browser/           # Service implementations
├── common/            # Interfaces and types
└── test/browser/      # Unit tests
```

### Registration

Services are registered in:
```
src/sql/workbench/services/zonecog/browser/zonecog.contribution.ts
```

---

## Version Management

### Current Version

```json
// package.json
{
  "version": "1.53.0"
}
```

### Version Bump

```bash
# Update version in package.json
npm version patch  # 1.53.0 → 1.53.1
npm version minor  # 1.53.0 → 1.54.0
npm version major  # 1.53.0 → 2.0.0
```

---

## Troubleshooting

### Build Failures

1. **Node modules cache issue**:
   ```bash
   rm -rf node_modules
   yarn cache clean
   yarn --frozen-lockfile
   ```

2. **Electron download failure**:
   ```bash
   rm -rf .build/electron
   yarn electron x64
   ```

3. **Native module issues**:
   ```bash
   yarn rebuild
   ```

### Common Issues

- **EACCES**: Use `nvm` to manage Node.js, not system installation
- **Out of memory**: Increase Node.js heap size with `NODE_OPTIONS=--max-old-space-size=8192`
- **Missing dependencies**: Check platform-specific requirements above

---

## Support

- **Issues**: https://github.com/EchoCog/azurechodatastudio/issues
- **Documentation**: https://github.com/EchoCog/azurechodatastudio/blob/main/README.md
