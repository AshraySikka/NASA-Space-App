# Reuse plan (what happened to each part of the original repo)

| Item | Action | Reason |
|---|---|---|
| `dashboard/src/viz/Scene3D.tsx` | keep and modify | The 3D scene is the visual centrepiece. Regime, confidence and spread-rate overlays were removed (they showed interpolated numbers); it now takes quality, pause and background props. |
| `dashboard/src/viz/Flame.tsx` | keep and modify | Kept the shaders and motion. The front no longer moves at an "interpolated spread rate"; it follows an illustrative speed and stops where the recorded outcome says the flame died. |
| `dashboard/src/viz/shaders.ts`, `textures.ts`, `heat-haze.ts` | keep as is | Pure rendering code with no data in it. |
| `dashboard/src/viz/types.ts` | replace | The old types carried spread rate, regime and confidence, none of which exist in the real data. |
| `dashboard/src/viz/engine.ts`, `engine.test.ts` | replace | Architecture kept (pure function: controls and data in, state out) as `src/engine/rating.ts` and `src/engine/flame.ts`. The old engine interpolated spread rates over the mock corpus. |
| `dashboard/src/viz/corpus.ts`, `state.ts`, `scales.ts` | delete | They imported the mock corpus and a hardcoded material list. Replaced by `src/lib/data.ts`, `src/store.ts`. |
| `dashboard/src/components/RegimeMap.tsx`, `HeroCurve.tsx` | replace | One Flammability Map replaces both. HeroCurve drew interpolated spread-rate curves. |
| `dashboard/src/components/VerdictBars.tsx`, `GravityBounds.tsx` | delete | Duplicate encodings; "PASS/FAIL" verdicts and a 0 g to 1 g bounds chart conflict with the truth rules. Their useful content moved into the Result banner. |
| `dashboard/src/components/ControlBar.tsx`, `SidePanel.tsx` | replace | Rebuilt as `Controls.tsx` (ranges read from data, no hardcoded presets) and `EvidencePanel.tsx`. |
| `dashboard/src/sidechat.tsx` | replace | Canned fake chat importing a package that was not installed. Replaced by `ChatDock.tsx` on the real API. |
| `dashboard/src/App.tsx` | replace | New three-zone layout; the "SYNTHETIC CORPUS" banner is gone and a real data status indicator took its place. |
| `dashboard/src/styles.css`, `index.html`, `main.tsx` | replace | Theme system through CSS variables. |
| `dashboard/package.json` | keep and modify | Every pinned version resolved and installed without change. Added `lucide-react`, `@fontsource-variable/inter`, `@testing-library/react`, `jsdom`. |
| `dashboard/vite.config.ts`, `vitest.config.ts`, `tsconfig.json` | keep and modify | Removed the `../datasets` file-system allowance; added the React plugin for component tests. |
| `dashboard/scripts/smoke.mjs` | replace | Now a full flow: ask, cite, apply, export, Moon, not-found, themes, keyboard, narrow layout. |
| `datasets/mock/tests.json` | delete | Generated mock rows. Nothing mock is reachable at run time. |
| root `package-lock.json` | delete | Empty lockfile with no matching `package.json`. |
| `raw_data/` | keep, git-ignore | Source of truth for ingestion. Byte-identical duplicates are dropped by hash at ingestion and listed in the extraction report. |
| `.gitignore` | keep and modify | Added `raw_data/`, env files, build output. |

## Applying this to your existing clone

Unzip over the repo, then remove the files this version no longer uses:

```bash
git rm -r --ignore-unmatch datasets package-lock.json \
  dashboard/src/sidechat.tsx dashboard/src/components/{ControlBar,GravityBounds,HeroCurve,RegimeMap,SidePanel,VerdictBars}.tsx \
  dashboard/src/viz/{corpus,engine,scales,state}.ts dashboard/src/viz/engine.test.ts
make install && make test
```
