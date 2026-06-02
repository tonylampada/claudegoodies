# agentmail-avoma-meeting-ids

Scan recent AgentMail messages, fetch full matching Avoma/AI Notes emails, and extract Avoma meeting UUIDs.

## Usage

```bash
export AGENTMAIL_API_KEY=...
./tools/agentmail-avoma-meeting-ids --inbox jarbas2@agentmail.to --limit 50
```

Output is tab-separated:

```text
<meeting_uuid>\t<created_at>\t<email_subject>
```

Fetch a transcript:

```bash
uuid=$(./tools/agentmail-avoma-meeting-ids --limit 50 | head -1 | cut -f1)
node ./tools/avoma-cli.js transcription "$uuid"
```

Options:

- `--inbox`: AgentMail inbox, defaults to `$AGENTMAIL_INBOX_ID` or `jarbas2@agentmail.to`
- `--limit`: recent message summaries to scan, default `25`
- `--json`: print structured JSON with email metadata and all UUIDs
