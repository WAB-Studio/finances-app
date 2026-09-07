#!/usr/bin/env bash
# One parallel track: a worktree, its own lane, its own port.
#
#   scripts/worktree.sh 2 mi-rama [base]
#
# Lane N lands beside this checkout as <checkout>-lN on port 3000+N-1, with its
# own harness identities and its own Playwright artefacts. Every lane still
# shares the one remote Postgres, so run at most three suites at a time.
set -euo pipefail

LANE=${1:?lane number, 2 or higher}
BRANCH=${2:?branch name}
BASE=${3:-integracion}

ROOT=$(git rev-parse --show-toplevel)
# Derived from the checkout's own name, so renaming the repo never strands a lane.
DIR=$(dirname "$ROOT")/$(basename "$ROOT")-l$LANE
APP=$DIR/apps/finances
PORT=$((3000 + LANE - 1))

cd "$ROOT"
git worktree add -b "$BRANCH" "$DIR" "$BASE"

# Hardlinks, not a symlink: Turbopack refuses a node_modules that points out of
# the filesystem root, and a copy would cost 909 MB a lane. Workspaces hoist to
# the monorepo root, so this one tree covers every app.
cp -al node_modules "$DIR/node_modules"
cp apps/finances/.env.local "$APP/.env.local"
# `private/` is gitignored, so the worktree is born without the plans a dispatch
# names. Reports stay behind: the lane writes its own and it is copied out.
mkdir -p "$DIR/private/planes" "$DIR/private/reportes"
cp private/planes/*.md "$DIR/private/planes/"

# Once per worktree, and never with that worktree's dev server up: typegen and
# `next dev` race over .next/dev/types.
(cd "$APP" && npx next typegen >/dev/null)

# The lane's two identities and their token rows. Idempotent: a lane already
# bootstrapped just lands a fresh session.
(cd "$APP" && HARNESS_LANE="$LANE" npm run harness:token)

cat <<EOF

Lane $LANE ready at $DIR on branch $BRANCH.

  cd $APP
  PORT=$PORT npm run dev
  HARNESS_LANE=$LANE HARNESS_BASE_URL=http://localhost:$PORT npm run check:e2e

Drop it when the branch lands:

  git worktree remove $DIR --force
EOF
