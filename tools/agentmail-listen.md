# agentmail-listen

Generic AgentMail websocket listener. It subscribes to inbox/pod events and runs a configured command for each matching email.

Dependencies are declared inline in `agentmail-listen.py` using PEP 723 metadata and installed automatically by `uv`.

## Create config

```bash
./tools/agentmail-listen --init-config
$EDITOR ~/.config/agentmail-listen/config.json
```

Minimal config:

```json
{
  "apiKeyEnv": "AGENTMAIL_API_KEY",
  "inboxIds": ["agent@agentmail.to"],
  "eventTypes": ["message.received"],
  "command": "~/bin/on-agentmail-email.sh",
  "shell": true,
  "commandTimeoutSeconds": 300,
  "logPath": "~/.cache/agentmail-listen/listener.log",
  "filters": {
    "fromAllowlist": ["example.com"],
    "subjectRegex": null,
    "labelAllowlist": []
  }
}
```

## Run

```bash
export AGENTMAIL_API_KEY=...
./tools/agentmail-listen --config ~/.config/agentmail-listen/config.json
```

Useful modes:

```bash
./tools/agentmail-listen --dry-run   # print event JSON instead of running command
./tools/agentmail-listen --once      # handle one matching event and exit
```

## Command contract

The configured command receives the full normalized AgentMail event JSON on stdin.

Environment variables include:

- `AGENTMAIL_EVENT_TYPE`
- `AGENTMAIL_INBOX_ID`
- `AGENTMAIL_MESSAGE_ID`
- `AGENTMAIL_THREAD_ID`
- `AGENTMAIL_FROM`
- `AGENTMAIL_TO`
- `AGENTMAIL_SUBJECT`
- `AGENTMAIL_TEXT`
- `AGENTMAIL_ATTACHMENT_COUNT`

Example handler:

```bash
#!/usr/bin/env bash
set -euo pipefail
payload=$(mktemp)
cat > "$payload"
echo "New email from $AGENTMAIL_FROM: $AGENTMAIL_SUBJECT"
# Do anything here; full JSON is in $payload.
```

Events are deduped by message id in `~/.cache/agentmail-listen/seen.json` by default. A command exit code of `0` marks the event as seen; non-zero leaves it retryable after reconnect/replay.

If `logPath` is set, the listener appends connection, event, filter, dedupe, and command-exit diagnostics there. Command stdout/stderr still goes to the parent process or systemd journal.
