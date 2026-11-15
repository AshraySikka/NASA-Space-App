# EMBER: Evidence Mapping for Burning Experiments and Research

Team Apex, NASA Space Apps Challenge 2026 ("Flame in Freefall", Toronto).

A researcher or spacecraft designer asks a question ("will this fabric burn on the Moon?", "what happens at 30% oxygen at 5 cm/s?"). The tool answers **only from NASA data and documents**, cites the exact source and page, rates how strong the evidence is, and shows the answer on a flame simulator and a flammability map.

It is an evidence finder and a gap finder. It never declares a material safe. It reports what NASA tested, what was observed, and where nothing has been tested.

Not affiliated with or endorsed by NASA. No NASA logo or insignia is used.

## Quick start

```bash
make install                    # Python deps (backend + ingestion) and Node deps
cp .env.example .env            # optional: add API keys and model names
make dev                        # API on :8000, frontend on :5173
```

Open http://localhost:5173. With no keys the app runs fully on local data (Layer 1) and says so in the chat panel.

Other commands:

| Command | What it does |
|---|---|
| `make ingest` | Rebuilds `data/processed/*.json`, `docs/DATA_AUDIT.md`, the rating fixtures and the generated docs from `raw_data/`. Needs the raw files and Tesseract for OCR. |
| `make backend` / `make frontend` | Start one side only. |
| `make test` | Backend tests, typecheck, frontend tests, production build. |
| `make smoke` | Playwright smoke test (see "Tests"). |

`raw_data/` is git-ignored (about 227 MB). `data/processed/` is committed, so the demo works without the raw files. The only thing you lose without `raw_data/` is the "Local PDF at page" link; the NASA link still works.

## Environment variables

Server side only. Nothing here reaches the browser.

| Variable | Needed | Purpose |
|---|---|---|
| `GEMINI_API_KEY`, `GEMINI_MODEL` | optional | Answer drafting and live NASA search (Layer 2). |
| `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` | optional | Fallback drafting and web search (Layer 3). |
| `CLAUDE_WEB_SEARCH_TOOL` | optional | Version string of Anthropic's web search tool. |
| `ALLOWED_DOMAINS` | optional | Hosts the backend may cite or fetch. Default is the list in `.env.example`. |
| `FRONTEND_ORIGIN` | for deploy | Exact origin(s) allowed by CORS. |
| `DATA_DIR`, `RAW_DATA_DIR`, `CHAT_RATE_LIMIT`, `LLM_TIMEOUT_S`, `FETCH_TIMEOUT_S`, `FETCH_MAX_BYTES` | optional | See `.env.example`. |

Frontend: `VITE_API_BASE` (URL of the API; defaults to `http://localhost:8000`).

**Model names are not hardcoded.** Take the current model names from each vendor's documentation and put them in `GEMINI_MODEL` and `CLAUDE_MODEL`. Check Anthropic's web search tool page for the current tool version string and its `allowed_domains` parameter.

## Truth rules the code enforces

1. **No answer from model memory.** The model receives only retrieved passages and the code-computed rating. Every claim needs a source and a verbatim quote.
2. **No invented numbers.** The data records outcomes, not spread rates. `spread_rate_mm_s` is null on every row, so no rate is shown. A blank cell is unknown, not zero. "Ending unstated" is never turned into "burned out" or "extinguished".
3. **No partial-gravity data.** Every structured row is microgravity. A Moon or Mars question gets a red rating, the nearest microgravity evidence, and dated context from NASA's FM2 page and a JAXA leaflet. Nothing is drawn between 0 g and 1 g. The scene reads "ESTIMATE, NOT MEASURED".
4. **The flame is an illustration.** It is driven by the outcome recorded for the nearest real test and is labelled "Illustrative, not a measurement".
5. **Ranges come from data.** Tested ranges, counts and outcome lists are read from `ranges.json` and `tests.json`. See `docs/DATA_AUDIT.md` for the current values.
6. **Material labels stay exact.** SIBAL is never called cotton. PMMA film is never called fabric.
7. **Old standards are labelled.** NTRS 19990036744 is shown as the 1998 version of NASA-STD-6001.
8. **Flow is a path.** A test is its start flow, its final flow, and the outcome at the end.

## Evidence rating (code, never a model)

Using only tests of the exact material:

- **Green, "Inside tested range":** a test with published airflow within the match tolerance on oxygen and airflow. A point anywhere on a test's start-to-final airflow path counts as on the path.
- **Yellow, "Near the edge":** a test within the near tolerance, or a match on oxygen whose airflow or pressure cannot be confirmed (airflow not published, raw display reading only, or pressure not comparable).
- **Red, "Outside tested data":** nothing within the near tolerance, a gravity level that was never tested, or a pressure far from every nearby row.

Tolerances live in `scripts/ingest/config.json` under `rating`, are copied to `data/processed/rating_config.json`, and are printed in the Result banner and the About page. The Python engine (`backend/app/rating.py`) and the TypeScript engine (`dashboard/src/engine/rating.ts`) are tested against the same fixtures, so the sliders and the chat cannot disagree.

## Evidence tiers

| Tier | Meaning |
|---|---|
| 1, local verified | From a file in the local corpus, page-referenced. |
| 2, NASA web | On an allowlisted NASA site and confirmed by the backend, which fetches the page and finds the quote. |
| 3, context | Allowlisted background (JAXA, UCL, NSF PAR, DOI), or a row whose source document is not in the local corpus. Never used for numbers about the fabrics. |

The two partial-gravity context quotes (NASA FM2, JAXA leaflet) are stored in `scripts/ingest/web_context.json` with the date they were read. At answer time the backend re-fetches them. If it cannot, the UI says the quote is a dated snapshot.

## Tests

```bash
make test
```

- **Backend (pytest):** citation verifier (pass, fail, hallucinated number, wrong page, off-allowlist URL, live re-fetch), allowlist, rating including the flow-path logic, condition parser, BM25 retrieval, the Moon answer, the exact not-found answer, model failure and model hallucination paths, and ingestion helpers (date-corruption repair, anomaly flagging, outcome mapping, conflict flagging, Table 7.1 parser).
- **Frontend (Vitest):** rating parity with the Python engine on the shared fixtures, outcome classes, and the **no-repetition test** (`dashboard/src/test/repetition.test.tsx`). That test renders the main screen with the real data and fails if a slider value, a test id, an oxygen percentage, the tested ranges or the rating label is printed in more than one primary panel outside the allowed chips. The file header lists exactly what it checks.
- **Smoke (Playwright):** ask a question, see citations, open Sources, apply to the simulator, export CSV, the Moon answer, the not-found answer, theme persistence, keyboard use, and the narrow layout.

```bash
# terminal 1
cd backend && FRONTEND_ORIGIN=http://localhost:4173 python -m uvicorn app.main:app --port 8000
# terminal 2
cd dashboard && npm run build && npm run preview
# terminal 3
make smoke
```

The smoke test uses the system Chrome when `/usr/bin/google-chrome` exists or `CHROME_PATH` is set. Otherwise run `npx playwright install chromium` first.

## Deployment

**API (Render, Fly or any container host)**

- Render: `render.yaml` is a ready blueprint. Build `pip install -r backend/requirements.txt`, start `cd backend && uvicorn app.main:app --host 0.0.0.0 --port $PORT`, health check `/api/status`.
- Docker / Fly: `docker build -f backend/Dockerfile -t fif-api .` from the repo root. The image contains `data/processed` and no raw files.
- Set `FRONTEND_ORIGIN` to the exact frontend URL, plus the keys and model names if you want Layers 2 and 3.

**Frontend (Vercel)**

- Import the repo, set the root directory to `dashboard`, and turn on "Include files outside the root directory" (the build copies `../data/processed` into `public/data`).
- Set `VITE_API_BASE` to the public API URL.
- `dashboard/vercel.json` sets the build command and security headers.

After both are up, open the frontend URL, check the status pill reads "Real NASA data", and run the three demo questions in `docs/DEMO_SCRIPT.md`.

## Ownership map

| Area | Path | Owner |
|---|---|---|
| Backend, retrieval, verifier, chat UI, deployment | `backend/`, `dashboard/src/components/ChatDock.tsx`, `SourcesDrawer.tsx` | Ashray |
| Flame scene and charts | `dashboard/src/viz/`, `dashboard/src/components/FlammabilityMap.tsx`, `dashboard/src/engine/flame.ts` | Ajeet |
| Data review and pitch | `raw_data/BASS_II_Verified_Fabric_Outcomes.xlsx`, `docs/DEMO_SCRIPT.md` | Moises |
| Research cards and submission text | `raw_data/NASA_Fire_Research_Cards.xlsx`, `docs/SUBMISSION.md` | Olly |
| Ingestion and data contract | `scripts/ingest/`, `data/processed/`, `dashboard/src/lib/types.ts` | shared |

To add a document: put the file in `raw_data/`, add an entry to `scripts/ingest/source_registry.json`, run `make ingest`.

## Decisions made where the brief was open

- **Material groups.** Raw fuel labels are kept verbatim on each row and grouped by rule (`lib.material_group`). PSI-25 labels such as `1/4" clear rod` and `100 micron film` are grouped as PMMA rod and PMMA film from the report's description of those samples.
- **Context rows.** PSI-25 rows other than the reviewed fabric tests stay in their own material groups with outcome "Outcome not reviewed". Their airflow is the raw air-display reading, so they can never rate green.
- **Outcome classes** are slugs of the recorded phrases. `scripts/ingest/outcome_visuals.json` only chooses a marker and an animation style per phrase.
- **Saffire VI** rows are checked against the text of `Vehicle Modeling_FINAL.pdf`. They are Tier 1 only because that paper is in `raw_data/` and the values were found on its Table 1 page. Without the file they drop to Tier 3 and the report tells you which file to add.
- **Map hatching** covers everything that is not within the match tolerance of a test with published airflow. Nothing is interpolated.
- **Map distances.** The map draws connector lines from your point to the nearest tests. The numbers for those distances are in the Evidence panel only, to keep each fact in one place.
- **The 1 g toggle** changes the look of the illustration and turns the rating red, because the structured table has no 1 g rows.
- **Simulator context in chat.** "This fabric" and bare conditions use the simulator's current material, and the answer says so.

## Known limitations

- **Layers 2 and 3 were not run against live APIs** in the build environment (no keys). The code paths are covered by unit tests with stubs. Test with real keys before the demo.
- **Without a model, answers are extractive.** They quote the best-matching sentences word for word and can read stiffly. With a key, a model writes the summary and the verifier checks it.
- **OCR pages can contain recognition errors.** The report lists which pages were read by OCR. Quotes from them are checked against the OCR text.
- **Only the reviewed fabric rows have outcomes.** The other PSI-25 rows show "Outcome not reviewed".
- **No structured Saffire IV/V rows.** Those papers are searchable as text only.
- **Web snapshot quotes** were read on the date stored with them and should be re-read before the final demo.
- **PMMA replay clips** from the brief's optional list are not included; the videos are not ingested or shipped.
- **Licensing note.** We could confirm that NASA PSI is open data with no stated restrictions on use. We could not confirm a CC0 label, so the About page does not claim one.
- See `data/processed/extraction_report.md` for skipped files, duplicates, OCR pages, repaired cells, conflicts and anomalies.
