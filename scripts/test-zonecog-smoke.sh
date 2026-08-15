#!/bin/bash
# ZoneCog Smoke Tests for Release Verification
# Part of the release quality gates defined in issue #61
set -e

if [[ "$OSTYPE" == "darwin"* ]]; then
	realpath() { [[ $1 = /* ]] && echo "$1" || echo "$PWD/${1#./}"; }
	ROOT=$(dirname $(dirname $(realpath "$0")))
else
	ROOT=$(dirname $(dirname $(readlink -f $0)))
fi

cd "$ROOT"

echo "=============================================="
echo "ZoneCog Release Smoke Tests"
echo "=============================================="
echo ""

# Count ZoneCog services
echo "1. Verifying ZoneCog services registration..."
EXPECTED_SERVICES=33
ACTUAL_SERVICES=$(grep -c "^registerSingleton" src/sql/workbench/services/zonecog/browser/zonecog.contribution.ts || echo "0")

if [ "$ACTUAL_SERVICES" -ge "$EXPECTED_SERVICES" ]; then
	echo "   ✓ Found $ACTUAL_SERVICES registered services (expected >= $EXPECTED_SERVICES)"
else
	# allow-any-unicode-next-line
	echo "   ✗ Found $ACTUAL_SERVICES registered services (expected >= $EXPECTED_SERVICES)"
	exit 1
fi

# Verify core service files exist
echo ""
echo "2. Verifying core cognitive service files..."

CORE_SERVICES=(
	"zonecogService.ts"
	"hypergraphStore.ts"
	"cognitiveMembraneService.ts"
	"llmProviderService.ts"
	"embodiedCognitionService.ts"
	"cognitiveWorkspaceService.ts"
	"ecanAttentionService.ts"
	"cognitiveLoopService.ts"
	"cognitiveMeshTransport.ts"
	"flareCogService.ts"
	"federatedQueryService.ts"
	"aarOrchestrationService.ts"
	"collaborationBackendService.ts"
	"atomSpaceBackendService.ts"
	"hyperonService.ts"
)

MISSING=0
for SERVICE in "${CORE_SERVICES[@]}"; do
	if [ -f "src/sql/workbench/services/zonecog/browser/$SERVICE" ]; then
		echo "   ✓ $SERVICE"
	else
		# allow-any-unicode-next-line
		echo "   ✗ $SERVICE (MISSING)"
		MISSING=$((MISSING + 1))
	fi
done

if [ "$MISSING" -gt 0 ]; then
	echo ""
	echo "ERROR: $MISSING core service files are missing"
	exit 1
fi

# Verify interface files exist
echo ""
echo "3. Verifying interface files..."

INTERFACE_FILES=(
	"zonecogService.ts"
	"llmProvider.ts"
	"embodiedCognition.ts"
	"cognitiveWorkspace.ts"
	"ecanAttention.ts"
	"cognitiveLoop.ts"
	"cognitiveMesh.ts"
	"flareCog.ts"
	"federatedQuery.ts"
	"aarOrchestration.ts"
	"collaborationBackend.ts"
	"atomSpaceBackend.ts"
	"hyperon.ts"
)

for IFACE in "${INTERFACE_FILES[@]}"; do
	if [ -f "src/sql/workbench/services/zonecog/common/$IFACE" ]; then
		echo "   ✓ $IFACE"
	else
		# allow-any-unicode-next-line
		echo "   ✗ $IFACE (MISSING)"
		exit 1
	fi
done

# Verify actions contribution exists
echo ""
echo "4. Verifying Command Palette actions..."
ACTIONS_FILE="src/sql/workbench/contrib/zonecog/browser/zonecogActions.contribution.ts"
if [ -f "$ACTIONS_FILE" ]; then
	ACTION_COUNT=$(grep -c "registerAction2" "$ACTIONS_FILE" || echo "0")
	echo "   ✓ $ACTION_COUNT actions registered"
else
	# allow-any-unicode-next-line
	echo "   ✗ Actions contribution file missing"
	exit 1
fi

# Verify product.json ZoneCog configuration
echo ""
echo "5. Verifying product.json Zone-Cog configuration..."
if grep -q "zoneCogConfig" product.json; then
	echo "   ✓ zoneCogConfig present in product.json"
else
	# allow-any-unicode-next-line
	echo "   ✗ zoneCogConfig missing from product.json"
	exit 1
fi

# Verify release workflow exists
echo ""
echo "6. Verifying release infrastructure..."
if [ -f ".github/workflows/release.yml" ]; then
	echo "   ✓ release.yml workflow present"
else
	# allow-any-unicode-next-line
	echo "   ✗ release.yml workflow missing"
	exit 1
fi

if [ -f "build/checksums/generate-checksums.js" ]; then
	echo "   ✓ Checksum generator present"
else
	# allow-any-unicode-next-line
	echo "   ✗ Checksum generator missing"
	exit 1
fi

if [ -f "docs/RELEASE_GUIDE.md" ]; then
	echo "   ✓ Release guide present"
else
	# allow-any-unicode-next-line
	echo "   ✗ Release guide missing"
	exit 1
fi

# Verify test files exist
echo ""
echo "7. Verifying test infrastructure..."
TEST_FILES=(
	"zonecogService.test.ts"
	"cognitiveMeshTransport.test.ts"
	"flareCogService.test.ts"
	"federatedQueryService.test.ts"
	"aarOrchestrationService.test.ts"
	"cognitiveLoopService.test.ts"
)

for TEST in "${TEST_FILES[@]}"; do
	if [ -f "src/sql/workbench/services/zonecog/test/browser/$TEST" ]; then
		echo "   ✓ $TEST"
	else
		# allow-any-unicode-next-line
		echo "   ✗ $TEST (MISSING)"
		exit 1
	fi
done

# Verify standalone extension boundary
echo ""
echo "8. Verifying standalone ZoneCog extension..."
EXTENSION_DIR="extensions/zonecog-bridge"
EXTENSION_FILES=(
	"package.json"
	"tsconfig.json"
	"src/extension.ts"
	"src/bridgeClient.ts"
	"test/bridgeClient.test.js"
)

for EXTENSION_FILE in "${EXTENSION_FILES[@]}"; do
	if [ -f "$EXTENSION_DIR/$EXTENSION_FILE" ]; then
		echo "   ✓ $EXTENSION_FILE"
	else
		echo "   ✗ $EXTENSION_FILE (MISSING)"
		exit 1
	fi
done

node <<'NODE'
const manifest = require('./extensions/zonecog-bridge/package.json');
if (manifest.engines.azdata) {
	throw new Error('Standalone ZoneCog extension must not require the ADS API');
}
if (manifest.main !== './out/extension.js') {
	throw new Error('Standalone ZoneCog extension must load compiled TypeScript output');
}
if (!manifest.scripts?.test || !manifest.scripts?.['vscode:prepublish']) {
	throw new Error('Standalone ZoneCog extension must define test and prepublish scripts');
}
NODE
echo "   ✓ Manifest is ADS-independent and publishable"

echo ""
echo "=============================================="
echo "✓ All ZoneCog smoke tests passed!"
echo "=============================================="
echo ""
echo "ZoneCog Edition Release Checklist:"
echo "  [✓] Core services registered"
echo "  [✓] Interface files present"
echo "  [✓] Command Palette actions available"
echo "  [✓] Product configuration valid"
echo "  [✓] Release infrastructure ready"
echo "  [✓] Test infrastructure present"
echo "  [✓] Standalone extension boundary present"
echo ""
