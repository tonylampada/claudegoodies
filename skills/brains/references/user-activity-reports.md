# User activity reports from Slack + GitHub

Use this when reconstructing "what did I do yesterday?" or similar work-log reports from a work brain.

## Scope

Answer from three layers, in this order:

1. Existing brain files for the date (`weekly/YYYY-Www.md`, `_reports/daily/YYYY-MM-DD.md`, relevant project/bug files).
2. Live Slack messages by the user for the exact local-date window.
3. GitHub PR activity by the user: authored PRs, reviews, inline comments, issue comments, approvals, and merged authored PRs.

## Slack pattern

- Resolve the user's Slack handle/ID if needed (`slack-cli users --search <name>`).
- `slack-cli search 'from:<handle>' --limit 200 --links` is often more reliable than trying date qualifiers first; filter locally to `[YYYY-MM-DD ...]`.
- Keep DMs and self-channel results in the synthesis when they show work orchestration, PR review requests, handoffs, or agent dogfooding.
- Ignore Slackbot/meta noise unless it affects a durable workflow preference or task result.

## GitHub pattern

Search broad, then verify exact actions per PR.

Candidate discovery:

```bash
gh search prs --owner <org> --involves <github_user> --updated 'YYYY-MM-DD..YYYY-MM-DD+1' --limit 50 --json repository,number,title,state,url,author,updatedAt
gh search prs --owner <org> --reviewed-by <github_user> --updated 'YYYY-MM-DD..YYYY-MM-DD+1' --limit 50 --json repository,number,title,state,url,author,updatedAt
gh search prs --owner <org> --commenter <github_user> --updated 'YYYY-MM-DD..YYYY-MM-DD+1' --limit 50 --json repository,number,title,state,url,author,updatedAt
gh search prs --owner <org> --author <github_user> --updated 'YYYY-MM-DD..YYYY-MM-DD+1' --limit 50 --json repository,number,title,state,url,author,updatedAt
```

Then for each candidate, verify user-authored activity:

```bash
gh api repos/OWNER/REPO/issues/PR/comments --jq '.[] | select(.user.login=="USER") | {created_at,html_url,body}'
gh api repos/OWNER/REPO/pulls/PR/comments --jq '.[] | select(.user.login=="USER") | {created_at,html_url,body}'
gh api repos/OWNER/REPO/pulls/PR/reviews --jq '.[] | select(.user.login=="USER") | {state,submitted_at,html_url,body}'
gh pr view PR --repo OWNER/REPO --json title,url,state,createdAt,mergedAt,author
```

Notes:

- `gh search prs --json reviewDecision` is not supported in some gh versions; do not depend on it.
- GitHub API timestamps are UTC. Convert/filter to the user's local date before reporting.
- `--involves` is broad and includes stale/indirect PRs; only report PRs with verified comments/reviews/creation/merge by the user in the target date.
- For authored PRs, include merged-at if it happened that date even if the PR was created earlier.

## Output shape

For Telegram/chat, keep the answer short:

- top 5–8 bullets of actual work
- list key PRs with repo and number
- mention saved report path if a report was written

For the brain, save a factual report under `_reports/daily/YYYY-MM-DD-<user>-activity.md` with frontmatter and sections: Summary, Slack, GitHub PR activity, Main themes.
