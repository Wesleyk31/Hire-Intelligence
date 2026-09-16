#!/usr/bin/env bash
set -euo pipefail
printf 'Hire Intelligence Codex verification\n'
python -m py_compile hardening/patches/apply_repairs.py hardening/tests/audit_static.py
if [ -f package.json ]; then
  npm install
  npm run build
  python hardening/tests/audit_static.py .
else
  echo 'Baseline source is not yet restored at repository root.' >&2
  echo 'Read CODEX_HANDOFF.md and restore AppDeploy snapshot 1789467699311 before integration.' >&2
  exit 2
fi
