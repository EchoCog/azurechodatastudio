# Change Log

## Unreleased

- Add a marketplace icon and dark gallery banner.
- Add `yarn package` / `yarn package:dry-run` scripts for local VSIX packaging and pre-publish validation.
- Add a CI packaging-validation workflow that runs `vsce package --no-dependencies` on every change under this directory.
- Fix a README typo in the auth-token storage note.

## 0.1.0

- Add an ADS-independent TypeScript extension host implementation.
- Add bridge health, schema ingestion, table ingestion, and cognitive analysis workflows.
- Store optional bearer credentials in VS Code SecretStorage.
- Validate payloads and bound bridge request time and response size.
- Add real HTTP transport and payload tests.
