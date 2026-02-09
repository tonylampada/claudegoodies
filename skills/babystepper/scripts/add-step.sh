#!/bin/bash
# add-step.sh - Add a new step to the plan
#
# Usage: add-step.sh <issue_number> "Step title" [--depends-on 1,2] [--note "text"] [--repo owner/repo]
#
# The new step gets the next available ID and status "pending".
# For open-ended objectives, discovered_at is set to today's date.
#
# Examples:
#   add-step.sh 9701 "Add getPortalUrl to paymentsApi.js"
#   add-step.sh 9701 "Migrate remaining fetch calls" --depends-on 1,2
#   add-step.sh 9701 "Fix new error pattern" --note "Discovered after step 3 merged"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ $# -lt 2 ]; then
    echo "Usage: add-step.sh <issue_number> \"Step title\" [--depends-on 1,2] [--note \"text\"] [--repo owner/repo]"
    echo ""
    echo "Examples:"
    echo "  add-step.sh 9701 \"Add getPortalUrl to paymentsApi.js\""
    echo "  add-step.sh 9701 \"Migrate remaining fetch calls\" --depends-on 1,2"
    exit 1
fi

ISSUE_NUMBER="$1"
STEP_TITLE="$2"
shift 2

# Parse optional args
DEPENDS_ON=""
NOTE=""
REPO_FLAG=""
while [ $# -gt 0 ]; do
    case "$1" in
        --depends-on)
            DEPENDS_ON="$2"
            shift 2
            ;;
        --note)
            NOTE="$2"
            shift 2
            ;;
        --repo)
            REPO_FLAG="--repo $2"
            shift 2
            ;;
        *)
            echo "Error: Unknown option '$1'"
            exit 1
            ;;
    esac
done

# Fetch current state from issue
BODY=$(gh issue view "$ISSUE_NUMBER" $REPO_FLAG --json body -q .body)
STATE_JSON=$("$SCRIPT_DIR/parse-issue.sh" "$BODY")

# Get next ID
NEXT_ID=$(echo "$STATE_JSON" | jq '[.steps[].id] | max + 1')

# Build depends_on array
if [ -n "$DEPENDS_ON" ]; then
    DEPS_JSON=$(echo "$DEPENDS_ON" | jq -R 'split(",") | map(tonumber)')
else
    DEPS_JSON="[]"
fi

# Check if open-ended (add discovered_at)
OBJ_TYPE=$(echo "$STATE_JSON" | jq -r '.objective_type // "bounded"')
TODAY=$(date +%Y-%m-%d)

# Build new step object
NEW_STEP=$(jq -n \
    --argjson id "$NEXT_ID" \
    --arg title "$STEP_TITLE" \
    --argjson depends_on "$DEPS_JSON" \
    --arg note "$NOTE" \
    --arg obj_type "$OBJ_TYPE" \
    --arg today "$TODAY" \
    '{
        id: $id,
        title: $title,
        depends_on: $depends_on,
        status: "pending",
        pr: null
    }
    + (if $note != "" then {notes: $note} else {} end)
    + (if $obj_type == "open-ended" then {discovered_at: $today} else {} end)')

# Add step to state
NEW_STATE=$(echo "$STATE_JSON" | jq --argjson step "$NEW_STEP" '.steps += [$step]')

# For open-ended objectives, add discovery log entry
if [ "$OBJ_TYPE" = "open-ended" ] && [ -n "$NOTE" ]; then
    NEW_STATE=$(echo "$NEW_STATE" | jq \
        --arg today "$TODAY" \
        --arg trigger "$NOTE" \
        --argjson step_id "$NEXT_ID" \
        '.discovery_log += [{date: $today, trigger: $trigger, steps_added: [$step_id]}]')
fi

# Write back to issue
"$SCRIPT_DIR/update-issue.sh" "$ISSUE_NUMBER" "$NEW_STATE" $REPO_FLAG

echo "Added step $NEXT_ID: $STEP_TITLE"
