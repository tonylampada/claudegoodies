# PR Strategy Guide

Guidelines for creating high-quality baby-step PRs.

## Core Principles

### 1. One Concern Per PR

Each PR should do exactly ONE thing:
- ✅ Add a new function
- ✅ Refactor a module
- ✅ Fix a bug
- ❌ Add function AND refactor AND fix bug

### 2. Self-Contained

The PR should:
- Not break the build
- Not break existing tests
- Be deployable on its own (even if feature incomplete)
- Have clear rollback path

### 3. Reviewable

A reviewer should be able to:
- Understand the change in < 10 minutes
- Review without needing extensive context
- Approve with confidence

## PR Structure

### Title Format
```
Step N: Brief description of change
```

Examples:
- `Step 1: Extract auth logic to AuthService class`
- `Step 3: Add JWT validation middleware`
- `Step 7: Update integration tests for new auth flow`

### Body Template

```markdown
Part of #<tracking_issue_number>

## What
[1-2 sentences describing the change]

## Why
This is step N of the baby-stepper plan for [objective].
[Brief context on why this step is needed]

## How
[Optional: Technical approach if non-obvious]

## Testing
- [ ] Unit tests added/updated
- [ ] Manual testing steps:
  1. ...
  2. ...

## Notes for Reviewer
[Optional: Call out specific areas to focus on]
```

## Implementation Guidelines

### Before Coding

1. **Read the step description** - Understand scope
2. **Check dependencies** - Ensure prerequisite PRs are merged
3. **Pull latest main** - Start from clean state
4. **Create branch** - `babystepper/<issue>-step-<N>`

### While Coding

1. **Stay in scope** - Resist urge to "fix one more thing"
2. **Add tests** - For new functionality
3. **Update types** - If changing interfaces
4. **Small commits** - Multiple commits within PR is fine

### Before Pushing

1. **Run tests locally** - `npm test` or equivalent
2. **Check lint** - `npm run lint` or equivalent
3. **Review diff** - `git diff main` - anything unexpected?
4. **Write good commit message** - Reference step and issue

## Code Quality

### What to Include

✅ The specific change described in the step
✅ Tests for new code
✅ Type updates if needed
✅ Minimal necessary refactoring to make change clean

### What NOT to Include

❌ Unrelated refactoring
❌ Style/formatting changes to untouched code
❌ "While I'm here" improvements
❌ TODO comments for future work (track in issue instead)

## Handling Edge Cases

### Discovering Needed Changes

If you find something else that needs to change:
1. Check if it's truly a prerequisite (blocker) or nice-to-have
2. If blocker → Update the plan, add new step before current
3. If nice-to-have → Note in tracking issue, don't include in PR

### Merge Conflicts

If another step's PR causes conflicts:
1. Wait for that PR to merge
2. Rebase your branch: `git rebase main`
3. Resolve conflicts
4. Force push: `git push --force-with-lease`

### Tests Failing

If existing tests fail:
1. Check if failure is related to your change
2. If yes → Fix in this PR
3. If no → Flag to user, may need to adjust plan

## Branch Naming

```
babystepper/<issue_number>-step-<step_number>
```

Examples:
- `babystepper/42-step-1`
- `babystepper/42-step-3`
- `babystepper/105-step-12`

## Commit Messages

### Single Commit (Preferred)
```
Step N: Brief description

Part of #<issue>

- Detail 1
- Detail 2
```

### Multiple Commits (When Useful)
```
Step N.1: First part of change
Step N.2: Second part of change
Step N.3: Tests for step N

Part of #<issue>
```

## Review Response

### If Changes Requested

1. Address feedback in new commits (don't rewrite history during review)
2. Reply to each comment
3. Re-request review

### If Approved

1. Squash and merge (recommended) or merge commit
2. Delete branch
3. Run `/babystepper go` to continue

## Anti-Patterns

### The Scope Creep PR
Started as "Add validation" but grew to include refactoring, new utilities, and config changes. **Split it.**

### The Drive-By Fix
"Fixed a typo while I was in this file." **Separate PR or skip it.**

### The Incomplete PR
Opens PR before implementation is done. **Wait until ready.**

### The Test-Free PR
"I'll add tests in a later step." **Add tests with implementation.**

### The Documentation Dump
Large markdown changes mixed with code. **Separate docs PRs.**
