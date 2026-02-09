#!/bin/bash
# update-step.sh - Update a single step's status and/or PR number
#
# Usage: update-step.sh <issue_number> <step_id> <status> [pr_number] [--note "text"] [--repo owner/repo]
#
# Examples:
#   update-step.sh 9701 3 in_progress 9750
#   update-step.sh 9701 6 blocked --note "PR closed - could not test"
#   update-step.sh 9701 1 done
#   update-step.sh 6 1 in_progress 42 --repo tonylampada/babystepper-test

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ $# -lt 3 ]; then
    echo "Usage: update-step.sh <issue_number> <step_id> <status> [pr_number] [--note \"text\"] [--repo owner/repo]"
    echo ""
    echo "Statuses: pending, in_progress, done, blocked"
    echo ""
    echo "Examples:"
    echo "  update-step.sh 9701 3 in_progress 9750"
    echo "  update-step.sh 9701 6 blocked --note \"PR closed\""
    echo "  update-step.sh 9701 1 done"
    exit 1
fi

ISSUE_NUMBER="$1"
STEP_ID="$2"
STATUS="$3"
shift 3

# Parse optional args
PR_NUMBER=""
NOTE=""
REPO_FLAG=""
while [ $# -gt 0 ]; do
    case "$1" in
        --note)
            NOTE="$2"
            shift 2
            ;;
        --repo)
            REPO_FLAG="--repo $2"
            shift 2
            ;;
        *)
            # positional arg = PR number
            PR_NUMBER="$1"
            shift
            ;;
    esac
done

# Validate status
case "$STATUS" in
    pending|in_progress|done|blocked) ;;
    *)
        echo "Error: Invalid status '$STATUS'. Must be: pending, in_progress, done, blocked"
        exit 1
        ;;
esac

# Fetch current state from issue
BODY=$(gh issue view "$ISSUE_NUMBER" $REPO_FLAG --json body -q .body)
STATE_JSON=$("$SCRIPT_DIR/parse-issue.sh" "$BODY")

# Verify step exists
STEP_EXISTS=$(echo "$STATE_JSON" | jq --argjson id "$STEP_ID" '[.steps[] | select(.id == $id)] | length')
if [ "$STEP_EXISTS" -eq 0 ]; then
    echo "Error: Step $STEP_ID not found in issue #$ISSUE_NUMBER"
    exit 1
fi

# Build the jq update expression
JQ_EXPR="(.steps[] | select(.id == $STEP_ID)).status = \"$STATUS\""

if [ -n "$PR_NUMBER" ]; then
    JQ_EXPR="$JQ_EXPR | (.steps[] | select(.id == $STEP_ID)).pr = $PR_NUMBER"
fi

if [ -n "$NOTE" ]; then
    JQ_EXPR="$JQ_EXPR | (.steps[] | select(.id == $STEP_ID)).notes = \"$NOTE\""
fi

# Apply update
NEW_STATE=$(echo "$STATE_JSON" | jq "$JQ_EXPR")

# Write back to issue
"$SCRIPT_DIR/update-issue.sh" "$ISSUE_NUMBER" "$NEW_STATE" $REPO_FLAG

echo "Step $STEP_ID → $STATUS${PR_NUMBER:+ (PR #$PR_NUMBER)}${NOTE:+ [note: $NOTE]}"
