---
name: zonecog-verify
description: >
  Verify that the ZoneCog cognitive workbench is fully functional — compiles cleanly,
  all unit tests pass, smoke tests green, and the bridge extension works. Use this skill
  whenever the user asks to verify, validate, or check ZoneCog functionality, or when a
  scheduled routine needs to confirm azuridecho is fully functional. Triggers on:
  "verify zonecog", "zonecog tests", "azuridecho functional", "check zonecog",
  "run zonecog tests", "is zonecog working", "fullyfunctional", "smoke test zonecog".
---

# ZoneCog Full Verification

This skill runs the complete ZoneCog verification pipeline: dependency installation,
compilation, smoke tests, unit tests, and bridge extension tests. It is read-only — it
never modifies source code, only reports results.

The verification script at `scripts/verify.sh` (relative to this skill) handles the
entire pipeline. Run it and interpret the results.

## Quick path

```bash
bash <this-skill-dir>/scripts/verify.sh
```

The script exits 0 on full success, non-zero on any failure. Its output is
machine-parseable JSON on the last line, preceded by human-readable progress.

## What the script does

### 1. Install dependencies

Runs `yarn install --ignore-scripts --network-timeout 120000` from the repo root.

The azurechodatastudio repo has two private Microsoft GitHub dependencies
(`Microsoft/SlickGrid.ADS` and `Microsoft/azdataGraph`) that are inaccessible from
most CI and cloud environments. The script detects a 403 failure, creates minimal
stub packages under `/tmp/stubs/`, temporarily swaps the `package.json` entries to
`file:` references, runs yarn, and restores `package.json` from git afterward. This
is safe because ZoneCog code does not import either package.

If `node_modules/` already exists and looks populated, the script skips installation.

### 2. Install missing build dependencies

The `--ignore-scripts` flag skips postinstall hooks (needed to avoid the `@vscode/ripgrep`
binary download failing on 403), but this can leave some build-time packages unlinked.
The script checks for and installs these if missing:

`ternary-stream`, `vscode-gulp-watch`, `gulp-merge-json`, `gulp-shell`, `parse-semver`,
`jsonc-parser`, `esbuild`, `byline`, `@vscode/vsce`

### 3. Compile

Runs `npx gulp compile-client`. This compiles the full workbench client code (including
all ZoneCog services) into `out/`. Extension compilation is skipped — it's not needed
for ZoneCog verification and avoids failures from unrelated extension dependencies.

Expected: `Finished compilation with 0 errors`.

### 4. Fix Playwright browser path

The browser test runner expects a specific Chromium revision directory under
`/opt/pw-browsers/`. If the expected path doesn't exist but a different revision is
installed, the script creates a symlink.

### 5. Smoke tests

Runs `bash scripts/test-zonecog-smoke.sh` which verifies:
- 40 registered services in the DI container
- Core service and interface files exist
- 91 Command Palette actions registered
- 10 visualization views registered
- Phase 6.3 host integration files present
- product.json configuration valid
- Test infrastructure present
- Standalone bridge extension boundary present

### 6. Unit tests

Runs all ZoneCog test files (46 files, ~1286 tests) through the browser test runner:

```
node test/unit/browser/index.js --run <each .test.js file> --browser chromium
```

The test files live in `out/sql/workbench/services/zonecog/test/browser/`. The runner
uses Playwright to execute them in a real Chromium instance with the AMD module loader,
matching the production environment.

### 7. Bridge extension tests

Compiles and tests the standalone `extensions/zonecog-bridge/` VS Code extension:
1. `npm install --ignore-scripts` (installs @types/node, @types/vscode, typescript)
2. `npx tsc -p tsconfig.json` (compile)
3. `npx mocha test/*.test.js --timeout 10000` (18 tests)
4. Cleans up any generated `package-lock.json`

## Interpreting results

The script prints a JSON summary as its last line:

```json
{
  "status": "pass",
  "compilation_errors": 0,
  "unit_tests_passing": 1286,
  "unit_tests_failing": 0,
  "smoke_tests": "pass",
  "bridge_tests_passing": 18,
  "bridge_tests_failing": 0
}
```

If `status` is `"fail"`, one or more checks failed. The preceding log output
shows which step failed and why.

## For scheduled routines

When running as a scheduled routine (no human watching), send a `PushNotification`
with the results. Notify on failure or first-time success. On repeated success with
no changes, skip the notification — don't wake someone up to say "still good."

Template:

```
<routine_summary>
ZoneCog verification [PASS/FAIL]: [compilation errors] compile errors,
[passing]/[failing] unit tests, smoke tests [pass/fail],
bridge extension [passing]/[failing] tests.
[If failing: describe what failed and likely cause.]
</routine_summary>
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| yarn 403 on SlickGrid/azdataGraph | Private Microsoft repos | Script handles automatically with stubs |
| gulp "Cannot find module X" | Build dep missing from --ignore-scripts | Script installs missing deps automatically |
| Playwright "Executable doesn't exist" | Chromium revision mismatch | Script creates symlink automatically |
| `assert.match is not a function` | Browser assert module limitation | Use `assert.ok(regex.test(value))` instead |
| WebSocket connection errors in test output | Expected — tests verify connection failure handling | Not a real failure |
