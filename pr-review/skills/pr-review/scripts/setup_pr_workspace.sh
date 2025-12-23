#!/bin/bash
# Setup working directory for PR review
# Usage: setup_pr_workspace.sh <OWNER> <REPO> <PR_BRANCH> <BASE_BRANCH>
#
# Arguments:
#   OWNER      - Repository owner (e.g., "johndoe")
#   REPO       - Repository name (e.g., "inference")
#   PR_BRANCH  - PR branch name (from headRefName)
#   BASE_BRANCH - Base branch name (from baseRefName)
#
# Creates/updates working directory at: $HOME/claudework/pr-reviews/<REPO>
# Checks out the PR branch and ensures it's up to date

set -e

REPO_OWNER="$1"
REPO_NAME="$2"
PR_BRANCH="$3"
BASE_BRANCH="$4"

if [ -z "$REPO_OWNER" ] || [ -z "$REPO_NAME" ] || [ -z "$PR_BRANCH" ] || [ -z "$BASE_BRANCH" ]; then
  echo "Error: Missing required arguments" >&2
  echo "Usage: $0 <OWNER> <REPO> <PR_BRANCH> <BASE_BRANCH>" >&2
  exit 1
fi

WORK_DIR="$HOME/claudework/pr-reviews/${REPO_NAME}"

echo "Setting up workspace at: $WORK_DIR"

# Clone if doesn't exist, or fetch if it does
if [ ! -d "$WORK_DIR" ]; then
  echo "Cloning repository..."
  git clone "https://github.com/${REPO_OWNER}/${REPO_NAME}.git" "$WORK_DIR"
  cd "$WORK_DIR"
else
  echo "Repository already exists, fetching updates..."
  cd "$WORK_DIR"
  # Fetch all branches and prune deleted ones
  git fetch origin --prune
fi

# Ensure we have the latest base branch from origin
# This explicitly updates the remote tracking branch origin/<BASE_BRANCH>
echo "Fetching latest base branch: $BASE_BRANCH"
git fetch origin "$BASE_BRANCH":"$BASE_BRANCH" 2>/dev/null || git fetch origin "$BASE_BRANCH"

# Checkout the PR branch
echo "Checking out PR branch: $PR_BRANCH"
git checkout "$PR_BRANCH" 2>&1 || git checkout -b "$PR_BRANCH" --track "origin/$PR_BRANCH"
git pull origin "$PR_BRANCH"

echo "✓ Workspace ready at: $WORK_DIR"
echo "  PR branch: $PR_BRANCH"
echo "  Base branch: $BASE_BRANCH (using refs/remotes/origin/$BASE_BRANCH for comparison)"
