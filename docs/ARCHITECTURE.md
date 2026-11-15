# Architecture

```
raw_data/ (git-ignored)
   │  scripts/ingest/ingest.py   (PyMuPDF → pdfplumber → pdftotext → OCR, python-docx, python-pptx, openpyxl, csv)
   ▼
data/processed/                      single source of truth, committed
   sources.json        registry: id, title, publisher, year, URL, DOI (only if printed in the file), hash, tier, notes
   chunks.json         passages with source id, PDF page, printed page, section, verbatim text
   tests.json          structured test table (one row per test)
   ranges.json         computed ranges per material and per series
   cards.json          research cards
   outcome_map.json    recorded phrase → outcome_class → marker family
   rating_config.json  tolerances
   rating_fixtures.json  Python-engine ratings used to test the TypeScript engine
   web_context.json    dated web quotes (FM2, JAXA)
   extraction_report.md
   │
   ├── backend/ (FastAPI) reads all of it
   └── dashboard/ copies everything except chunks.json into public/data at dev/build time
```

## Backend (`backend/app`)

| File | Role |
|---|---|
| `store.py` | Loads the JSON. Missing file → `DataMissing` → HTTP 503. No fallback data. |
| `conditions.py` | Deterministic parser: material, oxygen, airflow, pressure, gravity, intent. |
| `rating.py` | Evidence rating. Pure code. |
| `retrieval.py` | BM25 over chunks, quote selection, topicality check. Works offline. |
| `llm.py` | Gemini and Claude calls through the official SDKs. Models and keys from env. |
| `web.py` | Allowlisted, size-limited fetches. Each redirect hop is re-checked. |
| `verifier.py` | Citation verifier. |
| `answer.py` | The pipeline. |
| `main.py` | Routes: `GET /api/status`, `POST /api/chat` (SSE), `POST /api/rate`, `GET /sources/{id}`. CORS, rate limit. |

### One question, in order

1. **Parse** conditions deterministically. If nothing was found and a key exists, ask a model for JSON and validate it with pydantic. Follow-ups reuse the previous turn's conditions. "This fabric" uses the simulator's state.
2. **Layer 1, local.** Query the test table, compute the rating in code, build passages for the nearest tests. Add computed range passages for gap and compare questions, research-card passages when an investigation is named, and dated web context for partial-gravity questions. Run BM25 and keep a passage only if one sentence of it covers the question.
3. **Layer 2, Gemini live search**, when local evidence is insufficient or the user ticks "Search NASA live". Only the grounding metadata URLs are used. Google redirect links are resolved by reading the `Location` header, then every URL is checked against the allowlist. The backend fetches each page itself and turns it into passages.
4. **Layer 3, Claude web search**, with the tool's `allowed_domains`, if Gemini fails or returns nothing allowlisted.
5. **Layer 4, honest empty.** No verified passage → exactly `Not found in NASA sources I can verify`, plus what was searched.
6. **Generate.** With a key: the model gets only the numbered passages and the rating and must return strict JSON (`summary`, `claims[{text, source_ids, quote, tier}]`, `gaps`, `applied_conditions`). Invalid JSON gets one retry, then the deterministic template takes over. Without a key: the template builds claims straight from the rows and passages.
7. **Verify** every claim (below). If every model claim fails, the template claims are verified and used instead. If nothing survives, the answer is the honest empty one. A model summary that contains a number the verified evidence does not is replaced by the template summary.
8. **Respond** over SSE: `status` events, `token` events for the summary, then one `final` payload with claims, numbered sources, gaps, rating, design note, engine, removed statements and every verifier decision.

### Verifier rules

For each claim: the source id is in this request's passage set; the quote is a substring of the cited passage after whitespace and case normalisation (de-hyphenation, then a 94% character-match fallback for PDF noise); every number in the claim text appears in the quote or the cited test row; for web passages the host is on the allowlist and the backend's own fetch of the URL contains the quote. A quote found on a different page of the same source is rejected as a wrong page.

## Frontend (`dashboard/src`)

| Path | Role |
|---|---|
| `store.ts` | zustand store: data, controls, preferences (localStorage in try/catch), chat, UI state. |
| `hooks.ts` | `useDerived()`: rating and flame driver, computed once per change and shared. |
| `engine/rating.ts` | Rating for the live sliders. Mirror of `backend/app/rating.py`. |
| `engine/flame.ts` | Pure function: nearest test's outcome → animation parameters. |
| `viz/` | The 3D scene (kept from the original repo, with labels moved out and the spread-rate input removed). Lazy-loaded. |
| `components/` | `TopBar`, `ChatDock`, `Simulator`, `ResultBanner`, `Controls`, `EvidencePanel`, `FlammabilityMap`, `Library`, `SourcesDrawer`, `About`, `Tour`. |
| `lib/` | Types, data loader, SSE client, CSV export, formatting. |

### Who owns which fact (no repetition)

| Fact | Owner |
|---|---|
| Slider values | the sliders |
| Tested ranges per material | next to the material selector |
| Evidence rating and outcome class | the Result banner |
| Nearest tests, conditions, distances, review notes | the Evidence panel |
| Full citations | the Sources drawer |
| Gravity limits | one tooltip on the gravity control (and answer text when relevant) |
| Disclaimers | one scene label, one footer line |

Everywhere else uses chips: a test-id chip jumps to the Evidence panel, a numbered chip opens the Sources drawer.

## Security

- Keys only in the server environment; the client bundle contains no key names.
- CORS limited to `FRONTEND_ORIGIN`.
- No arbitrary URL fetching: exact-host allowlist, https only, size limit, timeout, every redirect re-checked.
- `/sources/{id}` serves files by registry id, never by path.
- All text is rendered as React text nodes. There is no `dangerouslySetInnerHTML`. Fetched HTML is stripped to text. CSV cells are quoted and formula-neutralised.
- Rate limit on `/api/chat`; timeouts on every external call.
