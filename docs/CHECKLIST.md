# Acceptance checklist

Run on 2026-11-14 in the build environment (Linux, headless Chrome, **no API keys**).
Commands: `make test` (exit 0) and `node dashboard/scripts/smoke.mjs` (exit 0).

```
backend:   41 passed            (pytest)
frontend:  2 files, 18 passed   (vitest; includes 763 rating fixtures and the no-repetition test)
typecheck: tsc --noEmit, no errors
build:     vite build, ok
smoke:     26/26 checks passed  (Playwright, system Chrome)
```

| # | Acceptance test | Result | Evidence |
|---|---|---|---|
| 1 | No mock or generated data reachable at run time | PASS | `datasets/` deleted; no `mock` string in `dashboard/src` outside tests; `test_no_mock_rows_and_no_invented_rates`; smoke "real data status indicator, no mock banner". |
| 2 | No oxygen range, airflow range, count or outcome list hardcoded | PASS | grep for the data's range and count values over `backend/app` and `dashboard/src` returned nothing; UI reads `ranges.json`; `DEMO_SCRIPT.md` and `SUBMISSION.md` are generated from the data. Example questions in the chat contain user-typed values from the brief. |
| 3 | Every number in the UI traces to a source id and page | PARTIAL | Reviewed rows (30 BASS-II fabric rows, 5 Saffire VI events) carry source id and PDF page. The 99 PSI-25 context rows carry a source id but no page, and are labelled "Outcome not reviewed". |
| 4 | Chat never emits an uncited claim; verifier catches a hallucinated number, a wrong page, an off-allowlist URL | PASS | `backend/tests/test_verifier.py` (12 tests); `test_llm_hallucination_is_removed`; `test_no_keys_means_local_engine` asserts every claim has a citation. |
| 5 | With all API keys removed the app runs on local data and shows a notice | PASS | This whole run had no keys. `/api/status` returned `gemini: false, claude: false`; smoke passed; chat shows "Running on local data only". |
| 6 | Moon question: no-partial-gravity answer, FM2 and JAXA context, RED, no invented rates | PASS | `test_moon_question_truth_rule_c`; smoke "Moon question…" and "Moon answer mixes tiers visibly". The backend could not reach nasa.gov here, so the two web quotes were shown as dated snapshots. |
| 7 | Uncovered topic returns exactly "Not found in NASA sources I can verify" | PASS | `test_uncovered_topic_is_exactly_not_found` (three off-topic questions); smoke check. |
| 8 | Anomaly-flagged values never on the map; conflict rows labelled | PASS | The five implausible final-O2 values are null in `tests.json` and the map does not encode final O2. Conflict rows get a ring on the map and a "conflict" pill in Evidence (1 row: T24 width). |
| 9 | Repetition test passes | PASS | `dashboard/src/test/repetition.test.tsx`, 3 tests. |
| 10 | Themes and personalization work, persist, charts and 3D scene follow the theme | PASS | Smoke: "theme and explain mode persist across reload", "page colours follow the theme", "3D scene background variable follows the theme". Accent, density, units and quality were exercised by hand in screenshots only, not asserted. |
| 11 | Typecheck, unit tests, Playwright smoke, production build all pass | PASS | Output above. |
| 12 | Usable and keyboard navigable on wide and narrow windows | PASS (limited) | Smoke at 1560 px and 390 px: tab bar, map, chat reachable, no horizontal overflow, focus ring, slider by keyboard. No screen-reader pass was done. |

## Not verified

- **Gemini live search and Claude fallback against the real APIs.** No keys were available. The code paths are unit-tested with stubs (model outage, invalid output, hallucinated claim). Run the three demo questions with real keys before the demo.
- **60 fps on Balanced.** Headless software rendering cannot measure this. Check on the demo laptop; switch to Low if needed.
- **"First chat tokens fast" with a model.** Local-only answers stream in well under a second; model latency was not measured.
- **Deployment.** `render.yaml`, `backend/Dockerfile` and `dashboard/vercel.json` were written but not deployed from here.

## Starting facts from the brief, re-checked against the files

| Brief said | Files say |
|---|---|
| Verified file has 30 records: 27 SIBAL, 3 Nomex | Confirmed. See `docs/DATA_AUDIT.md`. |
| PSI-25 table has 130 tests | 129 data rows (130 lines including the header). |
| Initial O2 across the PSI-25 table about 13.6 to 22.2% | Confirmed. |
| T13 final flow and width look like a conflict | Both sheets and Table 7.1 agree (final flow 2.2 cm/s, width 2.2 cm). No conflict. The one real conflict is T24's width (Table 7.1 vs the raw sample label). |
| Saffire VI source paper may be missing | `Vehicle Modeling_FINAL.pdf` is in `raw_data`. All five events were found on its Table 1 page, so they are Tier 1. Event 3 has no pressure in the table and stays unknown. |
| Saffire VI 2024 paper extracts almost no text | PyMuPDF read all 7 pages directly. No fallback was needed. |
| Saffire IV/V paper mentions PMMA at 25.4% O2 | Confirmed on PDF page 9. |
| BASS poster: 17 to 21.5% O2, dilution to 16%, ULOI 22% and 23.5% | Confirmed in NTRS 20140011099 (pages 2, 11, 24). |
| SIBAL fractions | NTRS 20130012832 page 18: 75% cotton, 25% fiberglass. The UI does not state fractions. |
| Five implausible "Calibrated final O2" values | All five flagged and nulled (P22a, P22b, T28a, T28b, B2). |
| Excel date corruption in airflow cells | 19 cells repaired and matched against the untouched CSV. The app reads airflow from the CSV and Table 7.1, never from the corrupted sheet. |
| FM2 and JAXA FLARE statements | Neither is in `raw_data`. Both were read on the live pages on 2026-11-14 and stored with that date. |
| NASA PSI data is CC0 | Not confirmed. PSI is open data with no stated use restrictions; the About page says that instead. |
