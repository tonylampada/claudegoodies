# Subagent Prompt Templates

Two templates: **Fix** (repair an existing PR) and **New Step** (implement a new step).
The subagent gets a fresh context window with no prior knowledge. Prompts must be self-contained
but lean — the subagent can read files and fetch the issue itself.

---

## Fix Template

Use when an open PR has problems (failed checks, changes requested).

```
You are fixing an existing PR for Step {STEP_ID} of a baby-stepper plan.

**Tracking issue:** {ISSUE_URL}
**PR:** #{PR_NUMBER} — {PR_TITLE}
**Repository:** {REPO_PATH}
**Problem:** {PROBLEM_SUMMARY}

## Instructions

1. Fetch the tracking issue to understand the objective and coding guidelines:
   ```bash
   gh issue view {ISSUE_URL} --json body -q .body
   ```

2. Check out the PR branch:
   ```bash
   git fetch origin && git checkout babystepper/{ISSUE_NUMBER}-step-{STEP_ID}
   git pull origin babystepper/{ISSUE_NUMBER}-step-{STEP_ID}
   ```

3. Diagnose the problem:
   - If build failed: run `gh pr checks {PR_NUMBER}` to see which check failed,
     then `gh run view <run_id> --log-failed` to read the failure logs
   - If changes requested: run `gh pr view {PR_NUMBER} --json reviews --jq '.reviews[] | select(.state == "CHANGES_REQUESTED") | .body'`
     and `gh api repos/{OWNER}/{REPO}/pulls/{PR_NUMBER}/comments --jq '.[] | {path, body, line}'`
     to read all review comments

4. Fix the issue:
   - Read the relevant source files before making changes
   - Stay in scope — only fix what's broken, don't expand the PR
   - Follow existing patterns in the codebase

5. Commit and push:
   ```bash
   git add <specific files> && git commit -m "fix: {SHORT_FIX_DESCRIPTION}"
   git push
   ```

6. Report what was fixed.
```

### Constructing {PROBLEM_SUMMARY}

Summarize the problem concisely for the subagent:
- Build failure: `"Build check failed — likely a compile/lint/test error"`
- Changes requested: `"Reviewer requested changes: {brief summary of comments}"`
- Both: list both problems

---

## New Step Template

Use when implementing a new step (creating a fresh PR).

```
You are implementing Step {STEP_ID} of a baby-stepper plan.

**Tracking issue:** {ISSUE_URL}
**Step:** {STEP_TITLE}
**Repository:** {REPO_PATH}
**Branch:** babystepper/{ISSUE_NUMBER}-step-{STEP_ID}

## Instructions

1. Fetch the tracking issue to understand the objective and coding guidelines:
   ```bash
   gh issue view {ISSUE_URL} --json body -q .body
   ```
   Read the What, How, and Example sections carefully. Follow the patterns described there.

2. Create your branch:
   ```bash
   git checkout {BASE_BRANCH} && git pull
   git checkout -b babystepper/{ISSUE_NUMBER}-step-{STEP_ID}
   ```

3. Implement the step: {STEP_TITLE}
   - Read the relevant source files before making changes
   - Follow existing patterns in the codebase
   - Stay in scope — only change what the step requires

4. Commit and push:
   ```bash
   git add <specific files> && git commit -m "Step {STEP_ID}: {SHORT_DESCRIPTION}"
   git push -u origin HEAD
   ```

5. Create the PR:{PR_INSTRUCTIONS}

6. Report the PR URL when done.
```

## PR Instructions Block

### When the project has a PR command (e.g., `/newpr`)

Subagents cannot invoke skills or slash commands. Instead, tell them to read the command file:

```
   Read the PR template at `.claude/commands/newpr.md` and follow its format.
   Use `gh pr create` with:
   - Title: "Step {STEP_ID}: {SHORT_DESCRIPTION}"
   - Body: Follow the template from the command file
   - Reference "Part of #{ISSUE_NUMBER}" in the description
   - Base: {BASE_BRANCH}
```

### When no PR command exists

Use the default template from `references/pr-strategy.md`:

```
   Create a PR:
   ```bash
   gh pr create --title "Step {STEP_ID}: {SHORT_DESCRIPTION}" --body "$(cat <<'EOF'
   Part of #{ISSUE_NUMBER}

   ## What
   [brief description of changes]

   ## Why
   Step {STEP_ID} of: {OBJECTIVE_TITLE}

   ## Testing
   [how to verify the change]
   EOF
   )" --base {BASE_BRANCH}
   ```
```

## Guidance for the Orchestrator

- **Don't paste issue context into the prompt.** The subagent fetches and reads it.
- **Do include the step title (new) or PR number + problem (fix).** This is the subagent's primary directive.
- **Do specify the repo path, branch name, and issue URL.** These are mechanical details the subagent can't discover.
- **Add step-specific hints only when needed.** If a step has a non-obvious requirement (e.g., "only migrate rename calls, not other fetch calls in the same file"), add it as a note.
- **Fix before new.** Always process all fix subagents before launching any new step subagents.
- **One at a time.** Never launch subagents in parallel. Wait for each to finish before starting the next — they share the git working directory.
