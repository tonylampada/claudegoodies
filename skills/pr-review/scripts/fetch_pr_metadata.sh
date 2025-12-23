#!/bin/bash
# Fetch PR metadata using gh CLI
# Usage: fetch_pr_metadata.sh <PR_NUMBER> [REPO]
#
# Arguments:
#   PR_NUMBER - The pull request number
#   REPO      - Optional repo in format owner/repo (defaults to current repo)
#
# Output: JSON with PR details including number, title, body, comments, author,
#         url, headRefName, baseRefName, and headRepository

set -e

PR_NUMBER="$1"
REPO="${2:-}"

if [ -z "$PR_NUMBER" ]; then
  echo "Error: PR number required" >&2
  echo "Usage: $0 <PR_NUMBER> [REPO]" >&2
  exit 1
fi

if [ -n "$REPO" ]; then
  gh pr view "$PR_NUMBER" --repo "$REPO" --json number,title,body,comments,author,url,headRefName,baseRefName,headRepository
else
  gh pr view "$PR_NUMBER" --json number,title,body,comments,author,url,headRefName,baseRefName,headRepository
fi
