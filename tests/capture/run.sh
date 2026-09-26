#!/usr/bin/env bash
# Runs the capture harness on Linux: virtual audio devices, synthesized scenarios, a window
# manager (so apps can see each other's windows), then the harness E2E against the built app.
#   tests/capture/run.sh <models-dir> [scenario ...]   (default: every scenario)
# <models-dir> holds the speech models and the TTS model (see tests/capture/README.md).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
models="$(cd "${1:?usage: run.sh <models-dir> [scenario ...]}" && pwd)"
shift || true
scenarios=("$@")
if [ ${#scenarios[@]} -eq 0 ]; then
  for f in "$here"/scenarios/*.json; do scenarios+=("$(basename "$f" .json)"); done
fi
out="${MEETING_ASSISTANT_HARNESS_AUDIO:-$repo/.harness}"
mkdir -p "$out"

"$here/pulse-setup.sh"
for s in "${scenarios[@]}"; do
  node "$here/synth.mjs" "$here/scenarios/$s.json" "$models/vits-piper-en_US-libritts_r-medium" "$out/$s"
done
cd "$repo/apps/desktop"
[ -f out/main/index.js ] || pnpm build
export MEETING_ASSISTANT_HARNESS=1 MEETING_ASSISTANT_TEST_MODELS="$models" MEETING_ASSISTANT_HARNESS_AUDIO="$out"
xvfb-run -a -s "-screen 0 1600x1000x24" bash -c "openbox >/dev/null 2>&1 & xcompmgr -n >/dev/null 2>&1 & sleep 1; pnpm exec playwright test e2e/harness.spec.ts ${PLAYWRIGHT_ARGS:-}"
