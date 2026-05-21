#!/usr/bin/env bash
# Single-shot release: bump, tag, build, upload, publish.
# Triggers ONLY when explicitly run. No automation on commits.
#
# Usage:
#   npm run release            # bumps patch (1.11.1 -> 1.11.2)
#   npm run release -- 1.12.0  # explicit version
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO_ROOT"

REPO_OWNER="giovannilombi"
REPO_NAME="dgiwhisper"
API="https://api.github.com/repos/$REPO_OWNER/$REPO_NAME"

# --- 1. Load GH_TOKEN -------------------------------------------------------
if [ -f .env.local ]; then
  set -a; source .env.local; set +a
fi
if [ -z "${GH_TOKEN:-}" ]; then
  echo "❌ GH_TOKEN missing (expected in .env.local)" >&2
  exit 1
fi

# --- 2. Sanity checks -------------------------------------------------------
if [ -n "$(git status --porcelain)" ]; then
  echo "❌ Working tree not clean — commit or stash first." >&2
  git status --short >&2
  exit 1
fi
BRANCH=$(git symbolic-ref --short HEAD)
if [ "$BRANCH" != "main" ]; then
  echo "❌ Must be on main (currently on $BRANCH)" >&2
  exit 1
fi
git fetch --quiet origin main
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "❌ Local main diverged from origin/main — sync first." >&2
  exit 1
fi

# --- 3. Determine new version ----------------------------------------------
CURRENT=$(node -p "require('./package.json').version")
if [ $# -gt 0 ] && [ -n "$1" ]; then
  NEW="$1"
else
  IFS='.' read -ra V <<< "$CURRENT"
  NEW="${V[0]}.${V[1]}.$((V[2]+1))"
fi

if ! [[ "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "❌ Invalid version: $NEW (expected X.Y.Z)" >&2
  exit 1
fi

if git rev-parse "v$NEW" >/dev/null 2>&1; then
  echo "❌ Tag v$NEW already exists." >&2
  exit 1
fi

# --- 4. Build release notes from commits since last tag --------------------
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [ -n "$LAST_TAG" ]; then
  NOTES=$(git log "${LAST_TAG}..HEAD" --pretty='format:- %s' --no-merges \
    | grep -E '^- (feat|fix|perf|refactor)' || echo "- Maintenance release")
else
  NOTES="- Initial release"
fi

# --- 5. Confirm -------------------------------------------------------------
echo ""
echo "📦 Release plan"
echo "   Version : $CURRENT → $NEW"
echo "   Last tag: ${LAST_TAG:-<none>}"
echo ""
echo "   Notes:"
echo "$NOTES" | sed 's/^/     /'
echo ""
echo "   Steps  : bump → commit → push → tag → build (~10 min) → upload → publish"
echo ""
read -r -p "Continue? [y/N] " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 0
fi

# --- 6. Bump + commit + push -----------------------------------------------
echo "→ Bumping version to $NEW…"
npm version "$NEW" --no-git-tag-version --allow-same-version >/dev/null
git add package.json package-lock.json
git commit -m "chore: bump version to $NEW"
git push origin main

# --- 7. Tag + push ----------------------------------------------------------
echo "→ Creating tag v$NEW…"
git tag -a "v$NEW" -m "Release v$NEW"
git push origin "v$NEW"

# --- 8. Build + upload (creates draft release) -----------------------------
echo "→ Building + uploading assets (this is the long step)…"
npm run electron:build -- --publish always

# --- 9. Find draft, set body + publish -------------------------------------
echo "→ Publishing draft release…"
REL_ID=$(curl -s -H "Authorization: Bearer $GH_TOKEN" \
  "$API/releases?per_page=10" \
  | python3 -c "
import json, sys
arr = json.load(sys.stdin)
draft = next((r for r in arr if r.get('draft') and r.get('tag_name') == 'v$NEW'), None)
if not draft:
    print('Draft v$NEW not found', file=sys.stderr)
    sys.exit(1)
print(draft['id'])
")

PAYLOAD=$(python3 -c "
import json, sys
body = '''$NOTES'''
print(json.dumps({
    'draft': False,
    'name': '$NEW',
    'tag_name': 'v$NEW',
    'body': body,
}))
")

curl -s -X PATCH -H "Authorization: Bearer $GH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -d "$PAYLOAD" \
  "$API/releases/$REL_ID" >/dev/null

echo ""
echo "✅ Released v$NEW"
echo "   https://github.com/$REPO_OWNER/$REPO_NAME/releases/tag/v$NEW"
