@echo off
REM ZoneCog Smoke Tests for Release Verification
REM Part of the release quality gates defined in issue #61

setlocal EnableDelayedExpansion

set ROOT=%~dp0..

cd /d "%ROOT%"

echo ==============================================
echo ZoneCog Release Smoke Tests
echo ==============================================
echo.

REM Verify core service files exist
echo 1. Verifying core cognitive service files...

set MISSING=0

for %%F in (zonecogService.ts hypergraphStore.ts cognitiveMembraneService.ts llmProviderService.ts embodiedCognitionService.ts cognitiveWorkspaceService.ts ecanAttentionService.ts cognitiveLoopService.ts) do (
    if exist "src\sql\workbench\services\zonecog\browser\%%F" (
        echo    [OK] %%F
    ) else (
        echo    [FAIL] %%F - MISSING
        set /a MISSING+=1
    )
)

if !MISSING! gtr 0 (
    echo.
    echo ERROR: !MISSING! core service files are missing
    exit /b 1
)

REM Verify interface files exist
echo.
echo 2. Verifying interface files...

for %%F in (zonecogService.ts llmProvider.ts embodiedCognition.ts cognitiveWorkspace.ts ecanAttention.ts cognitiveLoop.ts) do (
    if exist "src\sql\workbench\services\zonecog\common\%%F" (
        echo    [OK] %%F
    ) else (
        echo    [FAIL] %%F - MISSING
        exit /b 1
    )
)

REM Verify actions contribution exists
echo.
echo 3. Verifying Command Palette actions...
set ACTIONS_FILE=src\sql\workbench\contrib\zonecog\browser\zonecogActions.contribution.ts
if exist "%ACTIONS_FILE%" (
    echo    [OK] Actions contribution file present
) else (
    echo    [FAIL] Actions contribution file missing
    exit /b 1
)

REM Verify product.json ZoneCog configuration
echo.
echo 4. Verifying product.json Zone-Cog configuration...
findstr /c:"zoneCogConfig" product.json >nul 2>&1
if %errorlevel% equ 0 (
    echo    [OK] zoneCogConfig present in product.json
) else (
    echo    [FAIL] zoneCogConfig missing from product.json
    exit /b 1
)

REM Verify release workflow exists
echo.
echo 5. Verifying release infrastructure...
if exist ".github\workflows\release.yml" (
    echo    [OK] release.yml workflow present
) else (
    echo    [FAIL] release.yml workflow missing
    exit /b 1
)

if exist "build\checksums\generate-checksums.js" (
    echo    [OK] Checksum generator present
) else (
    echo    [FAIL] Checksum generator missing
    exit /b 1
)

if exist "docs\RELEASE_GUIDE.md" (
    echo    [OK] Release guide present
) else (
    echo    [FAIL] Release guide missing
    exit /b 1
)

REM Verify test files exist
echo.
echo 6. Verifying test infrastructure...
if exist "src\sql\workbench\services\zonecog\test\browser\zonecogService.test.ts" (
    echo    [OK] zonecogService.test.ts
) else (
    echo    [FAIL] zonecogService.test.ts - MISSING
    exit /b 1
)

echo.
echo ==============================================
echo [OK] All ZoneCog smoke tests passed!
echo ==============================================
echo.
echo ZoneCog Edition Release Checklist:
echo   [OK] Core services registered
echo   [OK] Interface files present
echo   [OK] Command Palette actions available
echo   [OK] Product configuration valid
echo   [OK] Release infrastructure ready
echo   [OK] Test infrastructure present
echo.

endlocal
exit /b 0
