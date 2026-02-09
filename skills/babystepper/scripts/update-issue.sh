#!/bin/bash
# update-issue.sh - Update GitHub issue with new babystepper state
#
# Usage: update-issue.sh <issue_number> '<state_json>'
#
# This script:
# 1. Takes the new state JSON (v1 or v2)
# 2. Generates the human-readable markdown table
# 3. Updates the issue body with both table and JSON comment

set -euo pipefail

if [ $# -lt 2 ]; then
    echo "Usage: update-issue.sh <issue_number> '<state_json>'"
    exit 1
fi

ISSUE_NUMBER="$1"
STATE_JSON="$2"

# Parse the state using jq
VERSION=$(echo "$STATE_JSON" | jq -r '.version // 1')
TITLE=$(echo "$STATE_JSON" | jq -r '.title // "Objective"')
DESCRIPTION=$(echo "$STATE_JSON" | jq -r '.description // ""')
MAX_OPEN_PRS=$(echo "$STATE_JSON" | jq -r '.config.max_open_prs // 5')

# v2 fields
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
BODY=$(cat <<EOF
# 🚀 Objective: ${TITLE}

${DESCRIPTION}

${TYPE_INDICATOR}

## Plan

| # | Step | Depends On | Status | PR |
|---|------|------------|--------|-----|
${TABLE_ROWS}
EOF
)

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
    elif [ "$OBJECTIVE_STATUS" = "complete" ]; then
        BODY="${BODY}
✅ Objective: Complete"
    elif [ "$OBJECTIVE_STATUS" = "paused" ]; then
        BODY="${BODY}
⏸️ Objective: Paused"
    fi
fi

# Add discovery log for v2/open-ended
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

# Update the issue
gh issue edit "$ISSUE_NUMBER" --body "$BODY"

echo "Updated issue #${ISSUE_NUMBER}"
echo "Progress: ${DONE}/${TOTAL} done, ${IN_PROGRESS} in progress, ${PENDING} pending"
if [ "$OBJECTIVE_TYPE" = "open-ended" ]; then
    echo "Type: Open-ended (${OBJECTIVE_STATUS})"
fi
