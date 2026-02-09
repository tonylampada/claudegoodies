#!/bin/bash
# parse-issue.sh - Extract BABYSTEPPER_STATE JSON from issue body
#
# Usage: parse-issue.sh "<issue_body>"
# or:    gh issue view <url> --json body -q .body | parse-issue.sh
#
# Returns the JSON state object from the BABYSTEPPER_STATE comment

set -euo pipefail

# Read from argument or stdin
if [ $# -ge 1 ]; then
    BODY="$1"
else
    BODY=$(cat)
fi

# Extract JSON from <!-- BABYSTEPPER_STATE ... --> comment
# Using grep + sed for portability
STATE=$(echo "$BODY" | \
    grep -oP '(?<=<!-- BABYSTEPPER_STATE)[\s\S]*?(?=-->)' 2>/dev/null || \
    echo "$BODY" | sed -n '/<!-- BABYSTEPPER_STATE/,/-->/p' | sed '1d;$d')

# Trim whitespace and output
echo "$STATE" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
