# Zone-Cog Bridge — VS Code Marketplace Publishing

This guide covers Phase F of the ZoneCog post-ADS migration: finalizing and
publishing the `extensions/zonecog-bridge` VSIX to the Visual Studio Marketplace
(and optionally Open VSX).

## Extension identity

| Field | Value |
| --- | --- |
| Publisher | `EchoCog` |
| Name | `zonecog-bridge` |
| Full ID | `EchoCog.zonecog-bridge` |
| Manifest | `extensions/zonecog-bridge/package.json` |
| Workflow | `.github/workflows/zonecog-bridge.yml` |
| Tag pattern | `zonecog-bridge-vX.Y.Z` (must match `package.json` version) |

## F.1 Extension finalization checklist

Before every release, confirm:

- [ ] `displayName`, `description`, `version`, `publisher`, `license` are correct
- [ ] `categories` includes at least one Marketplace category (`Machine Learning`)
- [ ] Every contributed command has a clear `title` and category `Zone-Cog`
- [ ] `icon` points at a 128×128 PNG (`media/icon.png`)
- [ ] `galleryBanner.color` / `theme` are set for the Marketplace header
- [ ] `README.md` includes install steps, commands, configuration, payloads, and screenshots
- [ ] `CHANGELOG.md` has complete notes for the version being tagged
- [ ] `LICENSE` is present and packaged
- [ ] `.vscodeignore` excludes `src/`, `test/`, maps, and lockfiles from the VSIX
- [ ] `yarn validate:marketplace` passes
- [ ] `yarn test` passes
- [ ] `yarn package:dry-run` passes

Run locally from `extensions/zonecog-bridge`:

```bash
yarn install --frozen-lockfile
yarn test
yarn validate:marketplace
yarn package:dry-run
```

## F.2 Azure DevOps publisher account

The Visual Studio Marketplace uses an Azure DevOps organization-backed
publisher. One-time setup:

1. Sign in at [https://marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage)
2. Create (or join) the **EchoCog** publisher if it does not already exist
3. Open Azure DevOps → User settings → **Personal access tokens**
4. Create a PAT with **Marketplace → Manage** scope (organization-wide)
5. Store the PAT as a GitHub Actions secret (see below). Never commit it.

Verify the publisher CLI-side (optional, local only):

```bash
npx --yes @vscode/vsce login EchoCog
# paste the PAT when prompted
npx --yes @vscode/vsce ls-publishers
```

## GitHub Actions secrets and environment

Create a GitHub Environment named **`zonecog-bridge-publish`** on the
`EchoCog/azurechodatastudio` repository (Settings → Environments).

Add environment secrets:

| Secret | Purpose |
| --- | --- |
| `VSCE_PAT` | Azure DevOps PAT with Marketplace Manage scope |
| `OVSX_PAT` | Optional Open VSX personal access token |

Repository permissions used by the workflow:

- `contents: read` on build/validate jobs
- `contents: write` on the release job (to create the GitHub Release and attach the VSIX)

Optional environment protection rules (recommended for production):

- Required reviewers before publish
- Restrict to the default branch / release tags

## CI/CD pipeline

Workflow: `.github/workflows/zonecog-bridge.yml`

| Trigger | Jobs |
| --- | --- |
| Pull request / push touching `extensions/zonecog-bridge/**` | `build-and-package` — install, compile, test, `vsce package` dry-run, marketplace validate |
| Tag `zonecog-bridge-v*.*.*` | previous job, then `release-and-publish` — package VSIX, upload artifact, GitHub Release, Marketplace/Open VSX publish |

Pre-publish validation always runs `yarn package:dry-run`, which executes:

```bash
npx --yes @vscode/vsce package --no-dependencies --out zonecog-bridge-dry-run.vsix
```

and deletes the temporary artifact. This catches missing icons, README issues,
and manifest problems before a real publish.

## Release automation

### 1. Bump the extension version

Edit `extensions/zonecog-bridge/package.json` → `version`, and add release notes
to `extensions/zonecog-bridge/CHANGELOG.md`.

### 2. Merge to `main`

Ensure the extension CI is green on the merge commit.

### 3. Tag and push

The tag **must** match the manifest version:

```bash
# example for 0.1.0
git tag zonecog-bridge-v0.1.0
git push origin zonecog-bridge-v0.1.0
```

### 4. What the workflow does

1. Re-runs compile, tests, marketplace validation, and packaging dry-run
2. Builds `zonecog-bridge-<version>.vsix`
3. Uploads the VSIX as a workflow artifact
4. Creates a GitHub Release named `Zone-Cog Bridge <version>` with the VSIX attached
5. If `VSCE_PAT` is set, runs:
   ```bash
   npx --yes @vscode/vsce publish --no-dependencies --pat "$VSCE_PAT"
   ```
6. If `OVSX_PAT` is set, runs:
   ```bash
   npx --yes ovsx publish --no-dependencies --pat "$OVSX_PAT"
   ```
7. If neither secret is present, the job emits a warning and still leaves the
   GitHub Release + VSIX artifact for manual publish

### 5. Manual publish fallback

```bash
cd extensions/zonecog-bridge
yarn install --frozen-lockfile
yarn package
npx --yes @vscode/vsce publish --no-dependencies --packagePath zonecog-bridge-0.1.0.vsix --pat "$VSCE_PAT"
# optional:
npx --yes ovsx publish zonecog-bridge-0.1.0.vsix --pat "$OVSX_PAT"
```

## Open VSX

Open VSX is the open-source registry used by VSCodium and some Eclipse Theia
products. Create a token at [https://open-vsx.org](https://open-vsx.org) and
store it as `OVSX_PAT`. The same VSIX is published; no separate package is built.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `ERROR  The publisher 'EchoCog' does not exist` | Publisher not created or PAT lacks access | Create publisher / regenerate PAT with Marketplace Manage |
| `The Personal Access Token is invalid` | Expired or wrong-scope PAT | Create a new PAT with Marketplace → Manage |
| `icon` / README packaging errors | Missing media or `.vscodeignore` over-filtering | Run `yarn validate:marketplace` and `yarn package:dry-run` |
| Tag job skipped publish with warning | Secrets not configured on `zonecog-bridge-publish` | Add `VSCE_PAT` / `OVSX_PAT` environment secrets |
| Version already exists | Tag/version reused | Bump `package.json` version and tag a new release |

## Related documents

- Extension README: `extensions/zonecog-bridge/README.md`
- Cognitive service: `azure_integration/README.md`
- Product release guide (full workbench binaries): `docs/RELEASE_GUIDE.md`
- Roadmap Phase 5.1: `docs/ZONECOG_ROADMAP.md`
