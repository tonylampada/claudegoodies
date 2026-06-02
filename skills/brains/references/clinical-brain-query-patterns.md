# Clinical brain query patterns

Session-derived patterns for medical/clinical brains with structured JSONL + source PDFs.

## Structured-first, source-verified

For clinical questions about exams, prescriptions, supplements, doses, or lab values:

1. Read the brain `MAP.md` and relevant section README(s), usually `clinica/exames/README.md` and/or `clinica/prescricoes/README.md`.
2. Query structured JSONL first (`exames.jsonl`, `resultados.jsonl`, `prescricoes.jsonl`) using synonyms and normalized analytes/names.
3. Join result rows back to their parent study and source file; quote dates, units, references, and source context.
4. Verify exact values or wording in the original PDF when the answer depends on precision (`pdftotext -layout ... | grep -i -C ...`, or OCR if needed).
5. Be explicit about specimen/method: urine vs blood vs stool vs buccal cells; direct measurement vs proxy marker.

## When a clinic note says only “lab set / labs pending”

If the foreign/clinic note mentions a prepared lab set but does not list analytes:

1. Search local `clinica/pedidos/` and nearby dated PDFs for the corresponding local physician order.
2. Search `clinica/exames/originais/` for results collected shortly after the order.
3. Use `pdftotext` on candidate pedido PDFs to extract the exact analyte list.
4. Cross-check with `exames.jsonl` / `resultados.jsonl` for the result panel name and analyte coverage.
5. Phrase uncertainty clearly: e.g. “the Lighthouse PDF says lab set/labs pending; the detailed analyte list appears in the local order dated X.”

Example from Isaac/Lighthouse: Lighthouse notes in 2023 mention a lab set/labs pending, but the detailed blood panel appears in a local Dr. Rogério order dated 2023-09-05 and resulting Oswaldo Cruz blood panel dated 2023-09-14.

## External supplement labels when the dose depends on product facts

When a prescription names a commercial supplement but the brain only has the prescribed amount (e.g. “Spectrum Needs 1.5 scoop 2x/day”), verify the product's Supplement Facts before calculating ingredient totals:

1. Search the brain first for local evidence/label photos and `compras.jsonl`/`prescricoes.jsonl` product records.
2. If the official product page hides the facts in galleries or JS, query the site's public media/API where available. For WordPress/WooCommerce sites, try:
   ```bash
   python3 - <<'PY'
   import requests
   for q in ['ProductName Supplement Facts', 'ProductName']:
       r=requests.get('https://example.com/wp-json/wp/v2/media', params={'search': q, 'per_page': 50}, headers={'User-Agent':'Mozilla/5.0'}, timeout=30)
       print(q, r.status_code)
       for m in r.json(): print(m.get('title',{}).get('rendered'), m.get('source_url'), m.get('alt_text'))
   PY
   ```
3. Use vision/OCR on the Supplement Facts image to extract serving size and ingredient amount. Note when a label gives only a blend total rather than ingredient-level split.
4. Calculate from serving size, not from product name. Example: SpectrumNeeds label showed **250 mg Carnitine Blend per 2 heaping scoops**; Dr. Rogério prescribed **1.5 scoops 2x/day**, so SpectrumNeeds contributes `250/2*1.5*2 = 375 mg/day` of carnitine blend.

## Clinical answer style for this user

- Answer in Portuguese when the user asks in Portuguese.
- Prefer short, practical lists with dates, values, units, and “what it was for.”
- Do not over-medicalize or give definitive treatment advice; frame interpretation as “pela lógica do médico/da clínica” or “levar ao médico.”
- Do not include sensitive registration details, phone/address/email, credentials, or lab account data from PDFs unless explicitly necessary; redact secrets.