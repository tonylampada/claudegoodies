# Slack + Brain Research Dossiers

Use this pattern when the user asks to research what has already been discussed in Slack, especially when they mention a work brain may also contain context.

## Workflow

1. Load the relevant brain skill and read the brain `MAP.md` first.
2. Search the brain with multiple synonyms before Slack:
   - acronym and expanded form (`OBB`, `oriented bounding box`, `rotated bounding box`)
   - feature/model names (`yolov8-obb`, `rf-detr OBB`, `DOTA`)
   - related product surfaces (`deployment`, `inference`, `annotation`, `export`).
3. Use `slack-cli search` with the same synonym set and `--links`.
4. For high-signal search hits, fetch the full thread with:
   ```bash
   slack-cli thread <channel_id> <ts> --limit 80 --links
   ```
5. Separate evidence into buckets:
   - product/roadmap signal
   - customer demand
   - current support/gaps
   - technical format details
   - implementation risks/checklist
6. Save a dated dossier under the brain’s `_reports/`, not just a chat summary.
7. Reply with the path plus a short executive summary.

## Pitfalls

- Acronyms collide. Confirm the domain meaning before researching external docs; e.g. in Roboflow Slack, `OBB` meant oriented bounding boxes, not Android APK expansion files.
- Slack search snippets often hide the useful replies. Always fetch full threads for roadmap/decision claims.
- Brain processed notes may point to raw transcripts in `_processed/`; read both when exact wording matters.
- Don’t say a platform “supports” a feature when only one slice works. Build a support matrix: annotation, import/export, training, hosted inference/deploy, label assist, UI rendering, docs.
