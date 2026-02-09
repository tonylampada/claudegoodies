---
name: babystepper
description: "Break down large objectives into small, incremental PRs while respecting human review bandwidth. Use when the user wants to: (1) Break down a large refactoring or feature into manageable PRs, (2) Track progress on a multi-PR initiative, (3) Automate PR creation while limiting open PRs to avoid overwhelming reviewers, (4) Pursue open-ended goals that evolve as work progresses. Triggers: /babystepper, 'baby step this', 'incremental PRs', 'break this into small PRs'"
---

# Baby Stepper

Execute long-term objectives through small, incremental PRs while respecting human review bandwidth.

## Quick Reference

| Command | Description |
|---------|-------------|
| `/babystepper plan "objective"` | Create tracking issue with step-by-step plan |
| `/babystepper go <issue_url>` | Execute next batch of eligible steps |

## When to Use

Use this skill when the user wants to:
- Break down a large refactoring or feature into manageable PRs
- Track progress on a multi-PR initiative
- Automate PR creation while limiting open PRs to avoid overwhelming reviewers
- Pursue open-ended goals that evolve as work progresses

**Triggers:** `/babystepper`, "baby step this", "incremental PRs", "break this into small PRs"

---

## Objective Types

### Bounded Objectives
Fixed scope with clear completion criteria. All steps are known upfront.

**Examples:**
- "Migrate authentication from sessions to JWT"
- "Add user avatar support"
- "Refactor the billing module"

### Open-Ended Objectives
Evolving scope where new work is discovered as you progress. The plan grows organically.

**Examples:**
- "Track errors with Sentry and fix the critical ones"
- "Improve test coverage for the API layer"
- "Address tech debt in the data pipeline"

For open-ended objectives:
- Initial plan captures what's visible now
- Each `/babystepper go` includes a **discovery phase**
- New steps are added as they're discovered
- Objective completes when user decides it's done

---

## Plan Command

### `/babystepper plan "objective"`

Creates a GitHub issue as "mission control" for the objective.

### Workflow

1. **Analyze the Objective**
   - Understand what the user wants to achieve
   - Determine if bounded or open-ended
   - Explore the codebase to identify affected areas
   - Note existing patterns and conventions

2. **Break into Steps**
   - Each step should be ONE focused PR
   - Target: reviewable in under 15 minutes
   - Follow the guidelines in `references/planning-guide.md`
   - For open-ended: only plan what's visible now

3. **Identify Dependencies**
   - Which steps must complete before others can start?
   - Maximize parallelism where possible
   - Mark independent steps to enable batch creation

4. **Ensure Label Exists**
   ```bash
   gh label create "👶 babystepper" --description "Tracked by Baby Stepper skill" --color "7057ff" 2>/dev/null || true
   ```

5. **Create the Tracking Issue**
   ```bash
   gh issue create --title "🚀 [BabyStepper] objective_title" \
     --body "$(cat issue_body.md)" \
     --label "👶 babystepper"
   ```

### Writing the Issue Description

The tracking issue is read by another Claude agent with an empty context window. Write it to give **direction**, not implementation details — the agent can read the codebase itself.

Include:
- **What & why** — brief explanation of the objective (1-2 paragraphs)
- **How** — point to existing files/patterns in the codebase to follow (by path, not by pasting their contents)
- **Good/bad example** — when the objective repeats a pattern across steps, include one concise good example and one bad example showing common mistakes to avoid
- **PR instructions** — if the project has a PR command (e.g., `/newpr`), reference its file path (e.g., `.claude/commands/newpr.md`) so the subagent can read and follow it; otherwise keep it minimal

Do NOT include:
- Full code snippets for every step — the agent can read the files
- Line-by-line before/after diffs — the step title tells the agent which files to look at
- Exhaustive API docs or function signatures — the agent will discover these

Step titles should be **pointers**: name the specific files, endpoints, or adapters involved so the agent knows exactly where to look. Trust it to figure out the implementation.

### Issue Body Format

```markdown
# 🚀 Objective: [title]

[description of what we're achieving]

**Type:** 🎯 Bounded | 🔄 Open-ended

## Plan

| # | Step | Depends On | Status | PR |
|---|------|------------|--------|-----|
| 1 | First step description | - | ⏳ pending | - |
| 2 | Second step description | 1 | ⏳ pending | - |
| 3 | Third step (parallel with 2) | 1 | ⏳ pending | - |
| 🔮 | *More steps may be discovered...* | | | |

## Progress

🟢 Completed: 0/N steps
🔵 In Progress: 0 PRs open
⚪ Remaining: N steps
🔮 Horizon: Open (more steps may emerge)

## Discovery Log

*Steps added during execution will be logged here.*

---
<!-- BABYSTEPPER_STATE
{
  "version": 2,
  "objective_type": "open-ended",
  "objective_status": "active",
  "config": {
    "max_open_prs": 5
  },
  "steps": [
    {"id": 1, "title": "First step", "depends_on": [], "status": "pending", "pr": null},
    {"id": 2, "title": "Second step", "depends_on": [1], "status": "pending", "pr": null}
  ],
  "discovery_log": []
}
-->
```

---

## Go Command

### `/babystepper go <issue_url>`

Executes the next batch of eligible work.

**IMPORTANT: All subagents run one at a time, sequentially.** They share the same git working
directory, so launching them in parallel would cause conflicts. Always wait for one subagent to
finish completely before launching the next. This applies to both fix subagents and new step
subagents.

### Workflow

1. **Fetch Current State**
   ```bash
   gh issue view <url> --json body,number,title
   ```

2. **Parse State**
   Extract JSON from the `<!-- BABYSTEPPER_STATE ... -->` comment using:
   ```bash
   scripts/parse-issue.sh "$(gh issue view <url> --json body -q .body)"
   ```

3. **Check In-Progress PRs**
   For each step with status `in_progress`:
   ```bash
   gh pr view <pr_number> --json state,mergedAt,reviewDecision,reviews,statusCheckRollup
   ```
   - If `state: MERGED` → update status to `done`
   - If `state: CLOSED` (not merged) → update status to `blocked`, add note
   - If `state: OPEN` → classify the PR's health (see step 4)

4. **Fix Open PRs First** ⚡ *Stop starting, start finishing*

   **Principle:** Always prioritize finishing existing work before opening new PRs.

   For each open PR from step 3, check its health:
   ```bash
   gh pr view <pr_number> --json reviewDecision,reviews,statusCheckRollup
   ```

   A PR **needs fixing** if any of:
   - `statusCheckRollup` has any check with `conclusion: FAILURE` → **build broken**
   - `reviewDecision` is `CHANGES_REQUESTED` → **reviewer requested changes**
   - `reviews` contains entries with `state: CHANGES_REQUESTED` → **review comments to address**

   For each PR that needs fixing, launch **one subagent at a time** using the **fix template**
   in `references/subagent-prompt.md`. Wait for it to finish before launching the next. The subagent should:
   - Check out the PR's branch
   - Diagnose the problem (read failed check logs, review comments)
   - Fix the issue, commit, and push
   - After each fix subagent completes, return to base branch (`git checkout master && git pull`) before starting the next

   PRs that are green and just awaiting review → no action needed, skip them.

5. **Discovery Phase** (for open-ended objectives)
   After updating PR statuses, look for new work:

   a. **Review completed work** - What did the merged PRs reveal?
   b. **Check for new issues** - Errors, warnings, test failures?
   c. **Explore adjacent areas** - What's next logically?
   d. **Add new steps** - Append to the plan with appropriate dependencies

   Log discoveries:
   ```json
   {
     "discovered_at": "2026-02-04",
     "trigger": "Merged PR #5 revealed unhandled edge case",
     "steps_added": [7, 8]
   }
   ```

6. **Find Eligible Steps**
   A step is eligible when:
   - Status is `pending`
   - All `depends_on` steps have status `done`
   - Current `in_progress` count < `max_open_prs`

7. **Create PRs for Eligible Steps** (up to limit)
   For each eligible step, launch a subagent using the Task tool (subagent_type: `general-purpose`).

   Use the **new step template** in `references/subagent-prompt.md` to construct each subagent's prompt.
   The template is designed so the subagent fetches the tracking issue itself — do NOT paste the
   full issue context into the prompt.

   **Key points:**
   - Launch **one subagent at a time** — wait for it to finish before starting the next
   - After each subagent completes, return to the base branch (`git checkout master && git pull`)
   - Subagents cannot invoke skills/commands — if the project has a PR command (e.g., `/newpr`),
     tell the subagent to read the command file (`.claude/commands/<name>.md`) and follow its template
   - Add step-specific notes only when scope clarification is needed

   After each subagent finishes: update step status → `in_progress`, pr → PR number

8. **Update Tracking Issue**
   ```bash
   scripts/update-issue.sh <issue_number> '<new_state_json>'
   ```
   This regenerates both the human-readable table and the JSON comment.

9. **Report Status**
   - Summarize what was done
   - List PRs fixed and what was wrong
   - List new PRs created
   - For open-ended: report any new steps discovered
   - Indicate if more work remains or if user should consider closing

---

## State Management

### Status Values

| Status | Meaning |
|--------|---------|
| `⏳ pending` | Not started, waiting for dependencies or capacity |
| `🔄 in_progress` | PR created and open |
| `✅ done` | PR merged |
| `🚫 blocked` | PR closed without merge, needs attention |

### Objective Status Values

| Status | Meaning |
|--------|---------|
| `active` | Work in progress, more steps may come |
| `complete` | User has marked objective as done |
| `paused` | Temporarily on hold |

### JSON State Schema (v2)

```json
{
  "version": 2,
  "objective_type": "bounded|open-ended",
  "objective_status": "active|complete|paused",
  "config": {
    "max_open_prs": 5
  },
  "steps": [
    {
      "id": 1,
      "title": "Step title",
      "depends_on": [],
      "status": "pending|in_progress|done|blocked",
      "pr": null | 123,
      "notes": "optional notes",
      "discovered_at": null | "2026-02-04"
    }
  ],
  "discovery_log": [
    {
      "date": "2026-02-04",
      "trigger": "What prompted discovery",
      "steps_added": [5, 6, 7]
    }
  ]
}
```

---

## Discovery Guidelines

### When to Add New Steps

**DO add steps when:**
- A merged PR reveals a bug or edge case
- Tests start failing after a change
- You notice related code that needs the same treatment
- The user's objective naturally expands (e.g., "fix errors" → new errors appear)
- A step turns out to be bigger than expected and should be split

**DON'T add steps for:**
- Unrelated improvements ("while I'm here...")
- Scope creep beyond the objective
- Nice-to-haves that don't serve the goal

### How to Add Steps

1. Assign the next available ID
2. Set appropriate `depends_on` (usually recent steps)
3. Set `discovered_at` to today's date
4. Add entry to `discovery_log` explaining why
5. Keep step focused and PR-sized

### When to Complete an Open-Ended Objective

Suggest completion when:
- No new issues discovered in last 2-3 runs
- Core goal has been achieved
- Remaining items are better tracked separately

Ask the user: "The objective seems complete. Should I mark it done, or is there more to explore?"

---

## PR Guidelines

See `references/pr-strategy.md` for detailed guidelines. Key principles:

1. **One Concern Per PR** - Single logical change
2. **< 400 Lines Changed** - Aim for reviewable size
3. **Self-Contained** - Should not break the build
4. **Clear Description** - Reference the tracking issue

---

## Dependency Logic

### Determining Eligibility

```
eligible_steps = []
in_progress_count = count(steps where status == "in_progress")
available_slots = max_open_prs - in_progress_count

for step in steps:
    if step.status != "pending":
        continue

    dependencies_met = all(
        steps[dep_id].status == "done"
        for dep_id in step.depends_on
    )

    if dependencies_met and len(eligible_steps) < available_slots:
        eligible_steps.append(step)

return eligible_steps
```

### Maximizing Parallelism

When planning, identify steps that:
- Have the same dependencies (can run in parallel)
- Are independent modules/files (no conflicts)
- Have no runtime interdependencies

---

## Error Handling

### PR Was Closed Without Merge
- Mark step as `blocked`
- Add note explaining the issue
- Skip to next eligible step
- Report to user for manual intervention

### Merge Conflicts
- Do not force-push
- Report conflict to user
- Suggest rebasing the branch

### Rate Limits
- Check `gh api rate_limit` before bulk operations
- Space out PR creation if near limit

---

## Example Sessions

### Bounded Objective

```
User: /babystepper plan "Migrate authentication from sessions to JWT"

Claude: [Analyzes codebase, identifies auth-related files]
        [Creates tracking issue #42 with 8 steps]

        Created tracking issue: https://github.com/org/repo/issues/42

        Plan (Bounded - 8 steps):
        1. Extract auth logic to AuthService class
        2. Add JWT token generation
        3. Add JWT validation middleware
        4. Migrate /login endpoint
        5. Migrate /signup endpoint
        6. Add /refresh endpoint
        7. Update integration tests
        8. Remove old session code

        Run `/babystepper go #42` when ready to start.
```

### Open-Ended Objective

```
User: /babystepper plan "Track errors with Sentry and fix critical ones"

Claude: [Sets up Sentry, identifies current error patterns]
        [Creates tracking issue #50]

        Created tracking issue: https://github.com/org/repo/issues/50

        Plan (Open-ended - initial 4 steps):
        1. Add Sentry SDK and configuration
        2. Fix NullPointerException in UserService (47 occurrences)
        3. Fix timeout errors in PaymentProcessor (23 occurrences)
        4. Add error boundary to React components
        🔮 More steps will be discovered as errors are tracked...

        Run `/babystepper go #50` when ready to start.

User: /babystepper go #50

Claude: [Checks PRs - steps 1-3 merged, step 4 in progress]

        **Discovery:** After merging the Sentry config, 2 new error patterns emerged:
        - DatabaseConnectionPool exhaustion (15/hour)
        - Race condition in CacheService (8/hour)

        Added steps:
        5. Fix connection pool leak in DatabaseService
        6. Add mutex to CacheService.refresh()

        Created PR #58: Step 5 - Fix connection pool leak

        Progress: 3/6 done, 2 in progress, 1 pending
        🔮 Horizon: Open (monitoring for new patterns)

User: /babystepper go #50

Claude: [All steps done, no new errors in 24h]

        All 6 steps complete. Error rate dropped 94%.
        No new critical errors discovered in the last day.

        Should I mark this objective as complete, or keep monitoring?

User: Mark it complete

Claude: [Updates objective_status to "complete"]

        ✅ Objective complete! Final stats:
        - 6 PRs merged
        - Error rate: 147/hour → 9/hour (94% reduction)
        - Tracking issue #50 closed
```

---

## Files

- `SKILL.md` - This file
- `references/planning-guide.md` - How to break down objectives
- `references/pr-strategy.md` - Guidelines for PR sizing and content
- `references/subagent-prompt.md` - Template for constructing subagent prompts
- `scripts/parse-issue.sh` - Extract state JSON from issue body
- `scripts/update-issue.sh` - Update issue with new state
