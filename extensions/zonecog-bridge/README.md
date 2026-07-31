# Zone-Cog Cognitive Bridge

This extension connects stock VS Code or Azure Data Studio to the standalone
[ZoneCog cognitive service](../../azure_integration/README.md). It uses only the
public VS Code extension API and Node.js HTTP APIs; there is no `azdata` or ADS
runtime dependency.

## Prerequisites

Start the service before running bridge commands:

```bash
pip install .
zonecog-bridge serve
```

The default endpoint is `http://127.0.0.1:7807`. In a Remote SSH, Dev Container,
or Codespaces workspace the extension runs on the remote extension host, so a
loopback endpoint refers to that host.

## Commands

- **Zone-Cog: Check Cognitive Bridge Health**
- **Zone-Cog: Ingest Database Schema**
- **Zone-Cog: Ingest Table Data**
- **Zone-Cog: Run Cognitive Analysis**
- **Zone-Cog: Set Cognitive Bridge Auth Token**

The ingestion and analysis commands first use selected editor text, then the
contents of an active JSON document, and otherwise prompt for JSON. Results are
written to the **Zone-Cog** output channel.

## Configuration

- `zonecog.bridge.baseUrl` — service base URL
- `zonecog.bridge.requestTimeout` — request timeout in milliseconds
- `zonecog.bridge.maxResponseBytes` — maximum accepted response size

Auth tokens are stored with VS Code SecretStorage through the token command,
not in user or workspace settings. Use HTTPS when connecting outside a trusted
loopback network.

## Payloads

Schema ingestion expects:

```json
{"tables":[{"schema":"dbo","table":"users","columns":[{"name":"id"}]}],"foreign_keys":[]}
```

Table ingestion expects:

```json
{"schema":"dbo","table":"users","primary_key":"id","rows":[{"id":1}]}
```

Cognitive analysis accepts either an AtomSpace batch or a complete reason
request:

```json
{"atoms":{"nodes":[],"links":[]},"mode":"schema","context":{"source":"editor"}}
```

## Development

```bash
yarn install
yarn test
```

`yarn test` compiles the extension and runs transport tests against a real local
HTTP server.

## Packaging

```bash
yarn package          # builds a .vsix in this directory
yarn package:dry-run  # validates packaging without keeping the artifact
```

Both scripts run `@vscode/vsce` via `npx`, so no publisher token or extra
devDependency is needed just to build and validate the package locally.
