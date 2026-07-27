# Azure Data Studio - Zone-Cog Edition

## Release Notes Template

Use this template when creating GitHub releases for Zone-Cog Edition.

---

## v{VERSION} Release Notes

### Highlights

- **Zone-Cog Cognitive Workbench**: Full integration of the Zone-Cog cognitive protocol engine
- **34 Cognitive Services**: Comprehensive service layer for embodied cognition
- **61 Command Palette Actions**: Complete workbench functionality via commands
- **Multi-Platform Support**: Windows (x64, ARM64), Linux (x64, ARM64), macOS (x64, ARM64, Universal)

### ZoneCog Cognitive Services

| Service | Description |
|---------|-------------|
| ZoneCogService | 11-phase adaptive thinking protocol |
| HypergraphStore | EchoCog-standard knowledge graph |
| CognitiveMembraneService | P-System Cerebral/Somatic/Autonomic triads |
| LLMProviderService | Pluggable LLM backends (OpenAI, Aphrodite, fallback) |
| EmbodiedCognitionService | Sensorimotor grounding loop |
| CognitiveWorkspaceService | Working memory, episodic memory, task contexts |
| ECANAttentionService | Economic Attention Network |
| CognitiveLoopService | Autonomous perceive→attend→think→act→reflect cycle |
| DTESNService | Deep Tree Echo State Network reservoir computing |
| AAROrchestrationService | Agent-Arena-Relation orchestration |
| ... and 24 more specialized services |

### Downloads

| Platform | Architecture | Format | Checksum |
|----------|--------------|--------|----------|
| Windows | x64 | ZIP | SHA256 |
| Windows | ARM64 | ZIP | SHA256 |
| Linux | x64 | tar.gz, DEB, RPM | SHA256 |
| Linux | ARM64 | tar.gz, DEB, RPM | SHA256 |
| macOS | x64 | ZIP | SHA256 |
| macOS | ARM64 | ZIP | SHA256 |
| macOS | Universal | ZIP | SHA256 |

### Installation

#### Windows
1. Download the ZIP or EXE installer
2. Extract or run the installer
3. Launch "Azure Data Studio"

#### Linux
```bash
# Ubuntu/Debian
sudo dpkg -i azuredatastudio_{version}_amd64.deb

# Fedora/RHEL
sudo rpm -i azuredatastudio-{version}.x86_64.rpm

# Generic
tar -xzf azuredatastudio-linux-x64-{version}.tar.gz
./azuredatastudio-linux-x64/bin/azuredatastudio
```

#### macOS
1. Download the ZIP
2. Extract and move to Applications
3. Open "Azure Data Studio"

### Getting Started with Zone-Cog

1. Open Command Palette (Ctrl/Cmd+Shift+P)
2. Type "Zone-Cog" to see all available commands
3. Try "Zone-Cog: Test Cognitive Processing" to start

### Key Commands

- `Zone-Cog: Test Cognitive Processing` - Interactive cognitive query
- `Zone-Cog: Show Status` - View cognitive workbench status
- `Zone-Cog: Explore Hypergraph` - Browse knowledge graph
- `Zone-Cog: Natural Language to SQL` - NL→SQL translation
- `Zone-Cog: Toggle Cognitive Loop` - Start/stop autonomous cognition

### Documentation

- [Release Guide](docs/RELEASE_GUIDE.md)
- [Development Roadmap](docs/ZONECOG_ROADMAP.md)
- [Implementation Details](ZONECOG_IMPLEMENTATION.md)

### Checksums

All artifacts are signed with SHA256 checksums. Verify with:

```bash
sha256sum -c SHA256SUMS.txt
```

### Known Issues

- Multi-user cognitive workspaces require a sync backend (future work)
- Cross-machine hypergraph federation not yet implemented

### Contributors

Thanks to the Zone-Cog team and all contributors!

---

*Built with the Zone-Cog Cognitive Workbench • Embodied Cognition for Data Analysis*
