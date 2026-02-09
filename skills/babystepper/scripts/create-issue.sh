#!/bin/bash
# create-issue.sh - Create a new babystepper tracking issue from a state JSON file
#
# Usage: create-issue.sh <state_json_file> [--repo owner/repo]
#
# The state JSON file should contain the full babystepper state (version 2).
# If --repo is not provided, uses the current repo.
#
# Example:
#   create-issue.sh plan.json
#   create-issue.sh plan.json --repo roboflow/roboflow

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ $# -lt 1 ]; then
    echo "Usage: create-issue.sh <state_json_file> [--repo owner/repo]"
    exit 1
fi

STATE_FILE="$1"
shift

# Parse optional args
REPO_FLAG=""
while [ $# -gt 0 ]; do
    case "$1" in
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

# Read and validate state JSON
if [ ! -f "$STATE_FILE" ]; then
    echo "Error: File '$STATE_FILE' not found"
    exit 1
fi

STATE_JSON=$(cat "$STATE_FILE")

# Validate required fields
TITLE=$(echo "$STATE_JSON" | jq -r '.title // empty')
if [ -z "$TITLE" ]; then
    echo "Error: State JSON must have a 'title' field"
    exit 1
fi

STEPS_COUNT=$(echo "$STATE_JSON" | jq '.steps | length')
if [ "$STEPS_COUNT" -eq 0 ]; then
    echo "Error: State JSON must have at least one step"
    exit 1
fi

# Ensure label exists
gh label create "👶 babystepper" --description "Tracked by Baby Stepper skill" --color "7057ff" $REPO_FLAG 2>/dev/null || true

# Generate the issue body using update-issue.sh's logic
# We create a temp issue first, then update it with the proper body
VERSION=$(echo "$STATE_JSON" | jq -r '.version // 2')
DESCRIPTION=$(echo "$STATE_JSON" | jq -r '.description // ""')
OBJECTIVE_TYPE=$(echo "$STATE_JSON" | jq -r '.objective_type // "bounded"')
OBJECTIVE_STATUS=$(echo "$STATE_JSON" | jq -r '.objective_status // "active"')

# Count stats
TOTAL=$(echo "$STATE_JSON" | jq '.steps | length')
DONE=$(echo "$STATE_JSON" | jq '[.steps[] | select(.status == "done")] | length')
IN_PROGRESS=$(echo "$STATE_JSON" | jq '[.steps[] | select(.status == "in_progress")] | length')
BLOCKED=$(echo "$STATE_JSON" | jq '[.steps[] | select(.status == "blocked")] | length')
PENDING=$((TOTAL - DONE - IN_PROGRESS - BLOCKED))

# Generate table rows
TABLE_ROWS=$(echo "$STATE_JSON" | jq -r '.steps[] |
    "| \(.id) | \(.title) | \(if .depends_on | length == 0 then "-" else (.depends_on | map(tostring) | join(",")) end) | \(
        if .status == "done" then "✅ done"
        elif .status == "in_progress" then "🔄 in-progress"
        elif .status == "blocked" then "🚫 blocked"
        else "⏳ pending"
        end
    ) | \(if .pr then "#\(.pr)" else "-" end) |"')

# Build type indicator
if [ "$OBJECTIVE_TYPE" = "open-ended" ]; then
    TYPE_INDICATOR="**Type:** 🔄 Open-ended"
else
    TYPE_INDICATOR="**Type:** 🎯 Bounded"
fi

# Build the issue body
BODY="# 🚀 Objective: ${TITLE}

${DESCRIPTION}

${TYPE_INDICATOR}

## Plan

| # | Step | Depends On | Status | PR |
|---|------|------------|--------|-----|
${TABLE_ROWS}"

# Add horizon row for open-ended objectives
if [ "$OBJECTIVE_TYPE" = "open-ended" ] && [ "$OBJECTIVE_STATUS" = "active" ]; then
    BODY="${BODY}
| 🔮 | *More steps may be discovered...* | | | |"
fi

# Add progress section
BODY="${BODY}

## Progress

🟢 Completed: ${DONE}/${TOTAL} steps
🔵 In Progress: ${IN_PROGRESS} PRs open
⚪ Remaining: ${PENDING} steps"

# Add blocked note if any
if [ "$BLOCKED" -gt 0 ]; then
    BODY="${BODY}
🚫 Blocked: ${BLOCKED} steps need attention"
fi

# Add horizon status for open-ended
if [ "$OBJECTIVE_TYPE" = "open-ended" ]; then
    if [ "$OBJECTIVE_STATUS" = "active" ]; then
        BODY="${BODY}
🔮 Horizon: Open (more steps may emerge)"
    fi
fi

# Add discovery log
if [ "$VERSION" = "2" ]; then
    DISCOVERY_LOG=$(echo "$STATE_JSON" | jq -r '
        if .discovery_log and (.discovery_log | length > 0) then
            "\n## Discovery Log\n\n" + (.discovery_log | map("- **\(.date)**: \(.trigger) (added steps \(.steps_added | map(tostring) | join(", ")))") | join("\n"))
        else
            "\n## Discovery Log\n\n*Steps added during execution will be logged here.*"
        end
    ')
    BODY="${BODY}
${DISCOVERY_LOG}"
fi

# Add the JSON state comment
BODY="${BODY}

---
<!-- BABYSTEPPER_STATE
${STATE_JSON}
-->"

# Create the issue
ISSUE_URL=$(gh issue create \
    --title "🚀 [BabyStepper] ${TITLE}" \
    --body "$BODY" \
    --label "👶 babystepper" \
    $REPO_FLAG)

echo "$ISSUE_URL"
echo "Created issue with ${TOTAL} steps"
