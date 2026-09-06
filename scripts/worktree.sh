#!/usr/bin/env bash
# One parallel track: a worktree, its own lane, its own port.
#
#   scripts/worktree.sh 2 mi-rama [base]
#
# Lane N lands at ../finances-app-lN on port 3000+N-1, with its own harness
# identities and its own Playwright artefacts. Every lane still shares the one
# remote Postgres, so run at most three suites at a time.
set -euo pipefail

LANE=${1:?lane number, 2 or higher}
BRANCH=${2:?branch name}
BASE=${3:-integracion}

ROOT=$(git rev-parse --show-toplevel)
DIR=$ROOT/../finances-app-l$LANE
PORT=$((3000 + LANE - 1))

cd "$ROOT"
git worktree add -b "$BRANCH" "$DIR" "$BASE"

# Hardlinks, not a symlink: Turbopack refuses a node_modules that points out of
# the filesystem root, and a copy would cost 909 MB a lane.
cp -al node_modules "$DIR/node_modules"
cp .env.local "$DIR/.env.local"
mkdir -p "$DIR/private"

# Once per worktree, and never with that worktree's dev server up: typegen and
# `next dev` race over .next/dev/types.
(cd "$DIR" && npx next typegen >/dev/null)

# The lane's two identities and their token rows. Idempotent: a lane already
# bootstrapped just lands a fresh session.
(cd "$DIR" && HARNESS_LANE="$LANE" npm run harness:token)

cat <<EOF

Lane $LANE ready at $DIR on branch $BRANCH.

  cd $DIR
  PORT=$PORT npm run dev
  HARNESS_LANE=$LANE HARNESS_BASE_URL=http://localhost:$PORT npm run check:e2e

Drop it when the branch lands:

  git worktree remove $DIR --force
EOF
