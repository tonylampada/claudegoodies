#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "agentmail",
# ]
# ///
"""Listen to AgentMail websocket events and run a configured command.

Config is JSON. The command receives the full event JSON on stdin and useful
fields in environment variables (AGENTMAIL_FROM, AGENTMAIL_SUBJECT, etc.).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


DEFAULT_CONFIG_PATH = "~/.config/agentmail-listen/config.json"
DEFAULT_STATE_PATH = "~/.cache/agentmail-listen/seen.json"


EXAMPLE_CONFIG = {
    "apiKeyEnv": "AGENTMAIL_API_KEY",
    "inboxIds": ["agent@agentmail.to"],
    "eventTypes": ["message.received"],
    "command": "~/bin/on-agentmail-email.sh",
    "commandTimeoutSeconds": 300,
    "cwd": None,
    "shell": True,
    "dedupe": True,
    "statePath": DEFAULT_STATE_PATH,
    "filters": {
        "fromAllowlist": [],
        "subjectRegex": None,
        "labelAllowlist": [],
    },
}


def eprint(*args: Any) -> None:
    print(*args, file=sys.stderr, flush=True)


def load_agentmail():
    try:
        from agentmail import AgentMail, Subscribe, MessageReceivedEvent  # type: ignore
        return AgentMail, Subscribe, MessageReceivedEvent
    except ImportError as exc:
        eprint("Missing Python package: agentmail")
        eprint("Install with: python3 -m pip install agentmail")
        raise SystemExit(2) from exc


def expand_path(value: str | None) -> str | None:
    if not value:
        return value
    return os.path.abspath(os.path.expandvars(os.path.expanduser(value)))


def log_line(config: dict[str, Any], message: str) -> None:
    path = config.get("logPath")
    if not path:
        return
    p = Path(expand_path(str(path)) or str(path))
    p.parent.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with p.open("a", encoding="utf-8") as f:
        f.write(f"[{stamp}] {message}\n")


def event_summary(payload: dict[str, Any]) -> str:
    msg = payload.get("message") or {}
    return (
        f"type={payload.get('eventType')} "
        f"id={pick(msg, 'messageId', 'message_id', 'id') or '?'} "
        f"inbox={pick(msg, 'inboxId', 'inbox_id') or '?'} "
        f"from={pick(msg, 'from', 'from_') or '?'} "
        f"subject={pick(msg, 'subject') or '?'} "
        f"labels={pick(msg, 'labels') or []}"
    )


def read_json(path: str) -> dict[str, Any]:
    with open(expand_path(path) or path, "r", encoding="utf-8") as f:
        return json.load(f)


def deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = deep_merge(out[key], value)
        else:
            out[key] = value
    return out


def to_jsonable(obj: Any) -> Any:
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, (list, tuple, set)):
        return [to_jsonable(v) for v in obj]
    if isinstance(obj, dict):
        return {str(k): to_jsonable(v) for k, v in obj.items()}
    for method in ("model_dump", "dict"):
        fn = getattr(obj, method, None)
        if callable(fn):
            try:
                return to_jsonable(fn())
            except TypeError:
                try:
                    return to_jsonable(fn(by_alias=True))
                except Exception:
                    pass
            except Exception:
                pass
    if hasattr(obj, "__dict__"):
        return {k: to_jsonable(v) for k, v in vars(obj).items() if not k.startswith("_")}
    return str(obj)


def pick(data: dict[str, Any], *names: str) -> Any:
    for name in names:
        if name in data and data[name] is not None:
            return data[name]
    return None


def normalize_event(event: Any) -> dict[str, Any]:
    data = to_jsonable(event)
    if not isinstance(data, dict):
        data = {"raw": data}

    event_type = pick(data, "eventType", "event_type", "type") or event.__class__.__name__
    message = pick(data, "message") or {}
    if not isinstance(message, dict):
        message = to_jsonable(message)
        if not isinstance(message, dict):
            message = {"raw": message}

    return {
        "eventType": event_type,
        "message": message,
        "event": data,
        "receivedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def event_id(payload: dict[str, Any]) -> str:
    msg = payload.get("message") or {}
    mid = pick(msg, "messageId", "message_id", "id")
    if mid:
        return str(mid)
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def load_seen(path: str) -> set[str]:
    p = Path(expand_path(path) or path)
    if not p.exists():
        return set()
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return set(map(str, data))
    except Exception as exc:
        eprint(f"Warning: could not read state file {p}: {exc}")
    return set()


def save_seen(path: str, seen: set[str], max_seen: int = 5000) -> None:
    p = Path(expand_path(path) or path)
    p.parent.mkdir(parents=True, exist_ok=True)
    items = list(seen)[-max_seen:]
    p.write_text(json.dumps(items, indent=2), encoding="utf-8")


def matches_filters(payload: dict[str, Any], filters: dict[str, Any]) -> bool:
    msg = payload.get("message") or {}
    sender = (pick(msg, "from", "from_") or "").lower()
    subject = pick(msg, "subject") or ""
    labels = pick(msg, "labels") or []

    allow = [str(x).lower() for x in filters.get("fromAllowlist") or []]
    if allow and not any(token in sender for token in allow):
        return False

    subject_re = filters.get("subjectRegex")
    if subject_re and not re.search(str(subject_re), str(subject)):
        return False

    label_allow = set(map(str, filters.get("labelAllowlist") or []))
    if label_allow and not (label_allow & set(map(str, labels))):
        return False

    return True


def env_for(payload: dict[str, Any]) -> dict[str, str]:
    msg = payload.get("message") or {}
    attachments = pick(msg, "attachments") or []
    fields = {
        "AGENTMAIL_EVENT_TYPE": payload.get("eventType"),
        "AGENTMAIL_INBOX_ID": pick(msg, "inboxId", "inbox_id"),
        "AGENTMAIL_MESSAGE_ID": pick(msg, "messageId", "message_id", "id"),
        "AGENTMAIL_THREAD_ID": pick(msg, "threadId", "thread_id"),
        "AGENTMAIL_FROM": pick(msg, "from", "from_"),
        "AGENTMAIL_TO": ",".join(pick(msg, "to") or []),
        "AGENTMAIL_SUBJECT": pick(msg, "subject"),
        "AGENTMAIL_TEXT": pick(msg, "extractedText", "extracted_text", "text"),
        "AGENTMAIL_ATTACHMENT_COUNT": str(len(attachments) if isinstance(attachments, list) else 0),
    }
    return {k: str(v) for k, v in fields.items() if v is not None}


def run_command(config: dict[str, Any], payload: dict[str, Any], dry_run: bool) -> int:
    command = config.get("command")
    if not command:
        raise SystemExit("Config must set command")

    stdin = json.dumps(payload, ensure_ascii=False)
    env = os.environ.copy()
    env.update(env_for(payload))
    env.update({str(k): str(v) for k, v in (config.get("env") or {}).items()})
    cwd = expand_path(config.get("cwd")) if config.get("cwd") else None
    timeout = int(config.get("commandTimeoutSeconds") or 300)
    shell = bool(config.get("shell", True))

    printable = command if isinstance(command, str) else " ".join(map(shlex.quote, command))
    eprint(f"Running: {printable}")
    if dry_run:
        print(stdin)
        return 0

    result = subprocess.run(
        command,
        input=stdin,
        text=True,
        shell=shell,
        cwd=cwd,
        env=env,
        timeout=timeout,
    )
    return result.returncode


def build_subscribe(Subscribe: Any, config: dict[str, Any]) -> Any:
    kwargs: dict[str, Any] = {}
    if config.get("inboxIds"):
        kwargs["inbox_ids"] = config["inboxIds"]
    if config.get("podIds"):
        kwargs["pod_ids"] = config["podIds"]
    if config.get("eventTypes"):
        kwargs["event_types"] = config["eventTypes"]
    return Subscribe(**kwargs)


def listen(config: dict[str, Any], once: bool, dry_run: bool) -> None:
    AgentMail, Subscribe, MessageReceivedEvent = load_agentmail()
    api_key = config.get("apiKey") or os.environ.get(config.get("apiKeyEnv") or "AGENTMAIL_API_KEY")
    if not api_key:
        raise SystemExit(f"Missing API key; set {config.get('apiKeyEnv') or 'AGENTMAIL_API_KEY'} or config.apiKey")

    if not config.get("inboxIds") and not config.get("podIds"):
        raise SystemExit("Config must set inboxIds or podIds")

    client = AgentMail(api_key=api_key)
    state_path = config.get("statePath") or DEFAULT_STATE_PATH
    dedupe = bool(config.get("dedupe", True))
    seen = load_seen(state_path) if dedupe else set()
    reconnect = float(config.get("reconnectSeconds") or 5)

    while True:
        try:
            eprint("Connecting to AgentMail websocket...")
            log_line(config, "connecting to AgentMail websocket")
            with client.websockets.connect() as socket:
                socket.send_subscribe(build_subscribe(Subscribe, config))
                eprint("Subscribed.")
                log_line(config, "subscribed")

                for event in socket:
                    payload = normalize_event(event)
                    log_line(config, "event received " + event_summary(payload))
                    is_message = isinstance(event, MessageReceivedEvent) or payload["eventType"] in set(config.get("eventTypes") or [])
                    if not is_message:
                        eprint(f"Ignoring event: {payload['eventType']}")
                        log_line(config, f"ignored non-message event type={payload['eventType']}")
                        continue
                    if not matches_filters(payload, config.get("filters") or {}):
                        eprint("Filtered event.")
                        log_line(config, "filtered event " + event_summary(payload))
                        continue

                    eid = event_id(payload)
                    if dedupe and eid in seen:
                        eprint(f"Duplicate event skipped: {eid}")
                        log_line(config, f"duplicate skipped id={eid}")
                        continue

                    rc = run_command(config, payload, dry_run=dry_run)
                    log_line(config, f"command exited rc={rc} id={eid}")
                    if rc == 0 and dedupe:
                        seen.add(eid)
                        save_seen(state_path, seen)
                        log_line(config, f"marked seen id={eid}")
                    elif rc != 0:
                        eprint(f"Command exited with {rc}; event not marked seen")
                        log_line(config, f"not marked seen id={eid} rc={rc}")

                    if once:
                        raise SystemExit(rc)
        except KeyboardInterrupt:
            raise
        except SystemExit:
            raise
        except Exception as exc:
            eprint(f"Websocket/listener error: {exc}")
            log_line(config, f"ERROR websocket/listener error: {exc}")
            eprint(f"Reconnecting in {reconnect:g}s...")
            time.sleep(reconnect)


def main() -> int:
    parser = argparse.ArgumentParser(description="Listen to AgentMail websocket events and run a command.")
    parser.add_argument("--config", default=DEFAULT_CONFIG_PATH, help=f"JSON config path (default: {DEFAULT_CONFIG_PATH})")
    parser.add_argument("--init-config", action="store_true", help="Write an example config and exit")
    parser.add_argument("--once", action="store_true", help="Exit after handling one matching event")
    parser.add_argument("--dry-run", action="store_true", help="Print event JSON instead of running the command")
    args = parser.parse_args()

    config_path = expand_path(args.config) or args.config
    if args.init_config:
        p = Path(config_path)
        p.parent.mkdir(parents=True, exist_ok=True)
        if p.exists():
            raise SystemExit(f"Refusing to overwrite existing config: {p}")
        p.write_text(json.dumps(EXAMPLE_CONFIG, indent=2), encoding="utf-8")
        print(p)
        return 0

    config = deep_merge(EXAMPLE_CONFIG, read_json(config_path))
    listen(config, once=args.once, dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
