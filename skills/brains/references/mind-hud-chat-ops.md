# Mind/HUD conversational ops

Use this when Tony is maintaining Brain2 `Mind.md` / HUD from a Telegram topic such as HermesOQTR (“o que tá rolando”).

## Intent

`Mind.md` files are hot caches of what is alive in Tony's attention. They should stay short, current, and useful for the HUD. Conversational updates are a primary high-quality source, not just ad-hoc comments.

## Pattern

1. Run `date '+%Y-%m-%d %A (week %V)'` before date-sensitive edits.
2. Read the relevant current `Mind.md` before editing.
   - Work/Roboflow: `roboflow/Mind.md`
   - Personal/current life: `diario/Mind.md`
3. Apply Tony's instruction directly:
   - “já resolvi / pode apagar” → remove stale item from hot cache.
   - “agora vou entrar em modo…” → add/update a current operating-mode item, usually under `## 🔥 Pushing`.
   - “isso deveria virar outro item” → create a separate radar item, not just a subclause.
4. Renumber the list after insertion/removal. Duplicate numbering is a bug.
5. Rebuild/publish the dashboard when the HUD is the projection users will see:
   ```bash
   cd /home/ai/repos/brain2
   source .brainsrc
   bash dashboard/scripts/publish-dashboard.sh
   ```
6. Verify generated output, not just source edits. Search `dashboard/site/data.json` (or fetch live data if available) for:
   - removed item titles absent
   - new/updated item titles present
7. Report briefly: what changed and the published HUD URL.

## Style for radar lines

- Prefer one concise sentence after the em dash.
- Preserve links only when they materially help next action.
- Do not log completion history in `Mind.md`; git/history/raw inbox preserve provenance.
- Avoid expanding structure unless the user asks; this is hot-cache maintenance, not ontology redesign.

## Example transformations

- “Já consertei o Lebo Assist. Está funcionando na Europa em produção. Pode apagar.”
  → remove the Label/Lebo Assist production issue item.

- “Revamp de observabilidade do Auto Label já tá em produção… produção em série de PRs de observabilidade.”
  → update the observability item to “Observability production-line PRs”.

- “Usar observabilidade pra observar paus em produção e gerar outra linha de PRs pra bugs.”
  → add a separate `Production bugfix PR loop` pushing item.
