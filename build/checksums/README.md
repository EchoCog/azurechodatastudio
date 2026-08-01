# Release Builds

This directory contains checksum generation tools for release artifacts.

## Usage

### Generate Checksums

```bash
# Generate checksums for all release artifacts
node build/checksums/generate-checksums.js generate .build build/checksums/output

# Or use default paths
node build/checksums/generate-checksums.js generate
```

### Verify Checksums

```bash
# Verify checksums against artifacts
node build/checksums/generate-checksums.js verify build/checksums/output/SHA256SUMS.txt .build
```

## Output

The script generates:

1. Individual `.sha256` files for each artifact
2. A combined `SHA256SUMS.txt` file

## Supported File Types

- `.zip` - Windows and macOS archives
- `.tar.gz` - Linux tarballs
- `.deb` - Debian packages
- `.rpm` - RPM packages
- `.exe` - Windows installers
- `.dmg` - macOS disk images
