#!/bin/bash
# Get diff between base branch and PR branch
# Usage: get_pr_diff.sh <REPO_NAME> <BASE_BRANCH> <PR_BRANCH>
#
# Arguments:
#   REPO_NAME  - Repository name (e.g., "inference")
#   BASE_BRANCH - Base branch name (e.g., "main")
#   PR_BRANCH   - PR branch name
#
# Must be run from within the PR workspace or provide REPO_NAME

set -e

REPO_NAME="$1"
BASE_BRANCH="$2"
PR_BRANCH="$3"

if [ -z "$REPO_NAME" ] || [ -z "$BASE_BRANCH" ] || [ -z "$PR_BRANCH" ]; then
  echo "Error: Missing required arguments" >&2
  echo "Usage: $0 <REPO_NAME> <BASE_BRANCH> <PR_BRANCH>" >&2
  exit 1
fi

WORK_DIR="$HOME/claudework/pr-reviews/${REPO_NAME}"

if [ ! -d "$WORK_DIR" ]; then
  echo "Error: Workspace not found at $WORK_DIR" >&2
  echo "Run setup_pr_workspace.sh first" >&2
  exit 1
fi

cd "$WORK_DIR"

# Ensure we have the latest base branch from origin
# This updates the remote tracking branch origin/<BASE_BRANCH> to latest
echo "Fetching latest ${BASE_BRANCH} from origin..." >&2
git fetch origin "${BASE_BRANCH}" 2>&1 | grep -v "^From " || true

# Verify the remote tracking branch exists
if ! git rev-parse "refs/remotes/origin/${BASE_BRANCH}" >/dev/null 2>&1; then
  echo "Error: Remote tracking branch origin/${BASE_BRANCH} not found after fetch" >&2
  exit 1
fi

# Get the diff between base and PR branch
# IMPORTANT: Use unambiguous remote ref to avoid comparing against stale local branches
# Using refs/remotes/origin/<BASE_BRANCH> prevents ambiguity if someone created a local branch named origin/<BASE_BRANCH>
git diff "refs/remotes/origin/${BASE_BRANCH}...${PR_BRANCH}"
