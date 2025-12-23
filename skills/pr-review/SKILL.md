---
name: pr-review
description: Conduct thorough pull request reviews using gh CLI and local git repository. Use when the user asks to "review a PR", "check pull request", or references a GitHub PR number. Provides concise, high-quality reviews focused on code quality, bug prevention, and architectural improvements following three-layer architecture principles.
---

# PR Review

Conduct expert-level pull request reviews using a local working directory. Focus on code quality, bug prevention, and architectural improvements with concise, actionable feedback.

## Review Workflow

PR reviews follow this process:

1. **Fetch PR information** - Get PR metadata using `gh` CLI
2. **Setup working directory** - Clone repo and checkout PR branch
3. **Examine changes** - Analyze diff against base branch
4. **Read context** - Read full file contents directly when needed
5. **Analyze architecture** - Check adherence to three-layer principles
6. **Write review** - Create and save markdown review to ./pr-reviews/

## Step 1: Fetch PR Information

Use the fetch metadata script to get PR details:

```bash
scripts/fetch_pr_metadata.sh <PR_NUMBER> [REPO]
```

This returns JSON with PR metadata including:
- `number`: PR number
- `title`: PR title
- `headRefName`: PR branch name
- `baseRefName`: base branch (usually main/master)
- `headRepository`: owner/repo info
- `body`, `comments`, `author`, `url`

If PR number unknown, list open PRs:

```bash
gh pr list --state open
```

## Step 2: Setup Working Directory

Use the setup script to clone/update the repository and checkout the PR branch:

```bash
scripts/setup_pr_workspace.sh <OWNER> <REPO> <PR_BRANCH> <BASE_BRANCH>
```

Extract these values from the PR metadata obtained in Step 1:
- `OWNER`: From `headRepository.owner.login`
- `REPO`: From `headRepository.name`
- `PR_BRANCH`: From `headRefName`
- `BASE_BRANCH`: From `baseRefName`

**Working directory location:** `$HOME/claudework/pr-reviews/<repo-name>`

The script will:
- Clone the repository if it doesn't exist
- Fetch updates if repository already exists (including the base branch)
- Checkout the PR branch and pull latest changes

**Important:**
- All subsequent file operations should use paths relative to `$HOME/claudework/pr-reviews/<repo-name>`
- The script fetches the latest base branch from origin to ensure accurate diff comparisons
- Diffs always compare against `refs/remotes/origin/<BASE_BRANCH>` (the unambiguous remote tracking branch), never local branches that may be stale

## Step 3: Examine Changes

Analyze the diff output focusing on:

- **Modified lines** - What changed and why
- **File patterns** - Which parts of codebase affected
- **Scope** - Size and complexity of changes

Get the diff using the script:

```bash
scripts/get_pr_diff.sh <REPO_NAME> <BASE_BRANCH> <PR_BRANCH>
```

**Critical:** The script automatically uses `refs/remotes/origin/<BASE_BRANCH>` (the unambiguous remote tracking branch) to ensure comparison against the latest remote branch, not a potentially stale local branch. This prevents false positives from already-merged changes.

Alternatively, use `gh pr diff <PR_NUMBER>` for formatted output.

## Step 4: Read Full File Context

Read complete file contents directly from the working directory when diff alone is insufficient.

**Use the `read_file` tool** with absolute paths:

```
# Read file from PR branch (already checked out)
read_file $HOME/claudework/pr-reviews/<repo-name>/<file-path>

# Example
read_file $HOME/claudework/pr-reviews/awesomeproject/app/services/auth.js
```

Read full files when:
- Diff shows partial context and full function/class needed
- Understanding file structure or imports
- Checking consistency across file
- Verifying architectural placement

**Pro tip:** You can also checkout the base branch to compare:
```bash
cd "$WORK_DIR"
git checkout "$BASE_BRANCH"
# read old version
git checkout "$PR_BRANCH"
# read new version
```

## Step 5: Analyze Architecture

Check adherence to three-layer architecture from references/architecture-principles.md:

**Layer violations to catch:**
- Business logic in endpoints/routes (should be in services)
- External API calls in business logic (should be in adapters)
- Multiple responsibilities in single function
- Stateful services (should be stateless)

**Quality checks:**
- DRY violations (especially error handling, logging)
- Error handling patterns (expected vs unexpected errors)
- Naming clarity (business vocabulary > tech vocabulary)
- Test coverage for new/modified services

## Step 6: Write Review

Create concise markdown review and save to file.

### Save Location

**Always save review to current project:** `PROJECT_ROOT/pr-reviews/<repo-name>-<pr-number>.md`

```bash
# Example paths:
pr-reviews/awesomeproject-1234.md
pr-reviews/anotherproject-567.md
```

Create the `pr-reviews` directory if it doesn't exist.

### Review Structure

```markdown
# PR Review: [PR Title]

**Repository:** owner/repo  
**PR:** #123  
**Branch:** feature-branch → base-branch  
**Author:** @username  
**Review Date:** YYYY-MM-DD

## Summary
[1-2 sentences: what does this PR do?]

## Architectural Review
[Layer separation, placement, patterns - be specific]

## Code Quality Issues
[Bugs, DRY violations, naming - quote code, give line numbers]

## Recommendations
[Concrete suggestions with code snippets]

## Verdict
[Approve / Request Changes / Needs Discussion]
```

### Writing Guidelines

- **Be concise** - No fluff, direct feedback only
- **Be specific** - Quote code, give line numbers, reference files
- **Be constructive** - Suggest better alternatives with code examples
- **Focus on impact** - Prioritize bugs and architectural issues over style

### Example Feedback

Good:
```
In auth.js:47-52, business logic (user role calculation) is in the 
endpoint handler. Move to authService.calculateUserRole():

// auth.js (endpoint - just plumbing)
const role = await authService.calculateUserRole(user);

// authService.js (business logic)
async function calculateUserRole(user) {
  // logic here
}
```

Bad:
```
Consider moving some logic to a service layer for better separation of concerns.
```

## Review Principles

### Three Questions
1. "Is this the simplest solution that could work?"
2. "Does this follow three-layer architecture?"
3. "Will this be easy to change when requirements evolve?"

### Red Flags
- Business logic in endpoints or adapters
- Duplicate error handling/logging
- Direct DB/API calls outside adapters
- Complex try-catch that should be middleware
- Solutions looking for problems (YAGNI)

### Quality as Investment
- Pay tech debt while it's cheap
- Celebrate incremental improvements
- Don't let perfect be enemy of good
- Both debt and quality compound over time

## Detailed Guidelines

For comprehensive review principles, error handling patterns, and JavaScript best practices, see references/review-guidelines.md.
