#!/usr/bin/env bash
#
# core-export.sh <zielverzeichnis>
#
# Exportiert den Core-Edition-Baum aus diesem (privaten) Repo in ein
# Zielverzeichnis: derselbe Baum wie hier, aber ohne .git, node_modules, dist,
# das echte ee/ (Enterprise Edition), ee-stub/, private/, die privaten
# Enterprise-Workflows und die interne Tableau-Exchange-Vorbereitung — dafür
# mit ee-stub/ als ee/ (No-op-Enterprise-Edition, siehe ee-stub/README.md).
#
# Verifiziert den Export anschließend im Zielverzeichnis: npm ci, npm run
# typecheck, npm test, npm run build müssen dort grün sein, exakt wie im
# öffentlichen Repo bl0rb/OpenVizPilot. Bricht mit Exit-Code ≠ 0 ab, sobald
# ein Schritt fehlschlägt.
#
# Genutzt von .github/workflows/enterprise-export-core.yml (privates Repo,
# nach v*-Tags) und für die lokale Verifikation vor einem Release.
set -euo pipefail

usage() {
  echo "Usage: $(basename "$0") <zielverzeichnis>" >&2
  exit 1
}

[ $# -eq 1 ] || usage
TARGET=$1
[ -n "$TARGET" ] && [ "$TARGET" != "/" ] || {
  echo "Ungültiges Zielverzeichnis: '$TARGET'" >&2
  exit 1
}

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$TARGET"
TARGET="$(cd "$TARGET" && pwd)"

if [ "$TARGET" = "$SOURCE_ROOT" ]; then
  echo "Zielverzeichnis darf nicht der Quellbaum selbst sein: $TARGET" >&2
  exit 1
fi

echo "== Core-Export: $SOURCE_ROOT -> $TARGET =="
echo

echo "-- 1/6: Baum kopieren (ohne .git, node_modules, dist, ee/, ee-stub/, private/, Enterprise-Workflows, Tableau-Exchange-Vorbereitung, .env) --"
rsync -a --delete \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='/ee' \
  --exclude='/ee-stub' \
  --exclude='/private' \
  --exclude='/.github/workflows/enterprise-*.yml' \
  --exclude='/docs/exchange-submission' \
  --exclude='/.env' \
  --exclude='/.env.local' \
  "$SOURCE_ROOT/" "$TARGET/"
echo "OK"
echo

echo "-- 2/6: ee-stub/ -> ee/ (Core-Stub der Enterprise Edition) --"
mkdir -p "$TARGET/ee"
rsync -a --delete "$SOURCE_ROOT/ee-stub/" "$TARGET/ee/"
echo "OK"
echo

cd "$TARGET"

echo "-- 3/6: npm ci --"
# package-lock.json enthält Workspace-Einträge für ee mit den Abhängigkeiten
# des ECHTEN ee/package.json (@hono/zod-validator, @modelcontextprotocol/sdk,
# ajv, zod, preact, tsx, …) — das schlankere Stub-package.json weicht davon ab,
# `npm ci` kann darum mit "can only install packages when ... in sync"
# fehlschlagen. In dem Fall die Lockdatei einmalig neu schreiben und erneut
# versuchen; ein Fehlschlag danach ist ein echter Fehler.
if npm ci; then
  echo "npm ci: unverändert erfolgreich (Lockfile passte zum Stub-ee/package.json)."
else
  echo "npm ci ist fehlgeschlagen — vermutlich weicht package-lock.json vom schlankeren Stub-ee/package.json ab." >&2
  echo "Repariere die Lockdatei mit 'npm install --package-lock-only' und versuche es erneut." >&2
  npm install --package-lock-only
  npm ci
  echo "npm ci: nach Lockfile-Reparatur erfolgreich."
fi
echo

echo "-- 4/6: npm run typecheck --"
npm run typecheck
echo "OK"
echo

echo "-- 5/6: npm test --"
npm test
echo "OK"
echo

echo "-- 6/6: npm run build --"
npm run build
echo "OK"
echo

echo "== Core-Export erfolgreich exportiert und verifiziert: $TARGET =="
