# SysOp service operation + brain documentation

Use this when the user asks to install/start a service and “record it in sysop”.

## Pattern

1. Get the real date first: `date '+%Y-%m-%d %A (week %V)'`.
2. Read `sysop/MAP.md` before writing; preserve its existing service table conventions.
3. Discover runtime facts from the live machine, not memory: unit file path, repo, port/bind, healthcheck, boot/linger state, logs command, credentials mode without secret values.
4. Prefer `systemd --user` for per-user developer services when the repo/runtime lives under `/home/ai`; set `WorkingDirectory`, `EnvironmentFile`, explicit runtime binary paths, `Restart=on-failure`, and bind loopback unless the user asked to expose it.
5. Verify after enabling: `systemctl --user is-enabled`, `is-active`, `status`, and an HTTP health/Web check if available.
6. Document in `sysop/servicos/<slug>.md` with: what it is, repo/code, how it runs, operation commands, update/rebuild steps, initial verified state, and safety notes.
7. For notification services that send Telegram messages, do not assume the current Hermes chat id is valid for the bot token. Inspect existing brain heartbeat/scripts for the canonical `TELEGRAM_CHAT_ID` (for brain2, Roboflow/Isaac scripts used the same group id) and test the handler directly with synthetic env vars before enabling the service.
8. Update `sysop/MAP.md` only for index/structure/current-state changes: add the service row and `Last Updated` entry. Do not rewrite unrelated service docs.

## Example shape

```markdown
---
title: <Service Name>
description: <one-line operational role>
updated: YYYY-MM-DD
source: configuração local e systemd user
---

## O que é
...

## Repo / Código
`/path/to/repo`

## Como roda
- **Tipo:** systemd user service
- **Unit:** `<unit>.service`
- **Porta:** `<port>`
- **Bind:** `127.0.0.1`
- **Healthcheck:** `http://127.0.0.1:<port>/api/health`

## Operação
```bash
systemctl --user status <unit>.service
journalctl --user -u <unit>.service -f
systemctl --user restart <unit>.service
```
```

## Pitfalls

- Do not paste secrets or full tokens from env files into the brain. Record the credential mode/path only.
- Do not mark a service as running from a successful install alone; verify the actual unit and health endpoint.
- If exposing outside loopback, document the proxy/Tailscale/nginx boundary and any internal endpoints that must not be public.
