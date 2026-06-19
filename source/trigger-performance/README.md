# trigger-performance

Stress demos that run the **real, vendored** PixieBrix `jQueryInitialize` selector
watcher (the shared MutationObserver behind both trigger and button starter bricks)
against pathological DOM patterns — the cases the 3.2.6 performance overhaul targeted,
which a customer reported made some pages crash.

Build output goes to `public/trigger-performance/` and is served at `/trigger-performance/`.

## Automated testing (driving the real extension)

The harness panel runs the vendored watcher for manual comparison, but the same pages
double as **clean DOM targets for E2E tests that drive the real extension**. Load a page
with `?harness=off&panel=0` (no competing watcher, no fixed overlay) plus:

- `autostart=1` — start the workload without clicking; `cycles=N` — stop after exactly
  N workload ticks.
- On completion the harness sets `<html data-pbx-workload="done">` (lifecycle
  `idle → running → done`) and fires a `pbx:workload-done` event — await that instead of a
  timeout.
- Generated nodes carry a stable `data-item` / `data-row` identity.
- A mod reports work — tallied on `window.PBX.observed` (`{ total, counts, keys }`) — either
  from page-world JS via `window.PBX.record(name, key)`, or by dispatching a `pbx:record` DOM
  event on the matched element (its `data-item`/`data-row` becomes the key).

`attribute-dedup.html` is a perf-free correctness scenario for the #8313 dedup invariant: a
single stable node whose attributes churn (never added/removed), so a correct button injects
exactly one button and a correct trigger fires once.

## Build

```bash
bash source/trigger-performance/build.sh   # run from the repo root
```

This runs `npm install` and bundles two browser globals into `public/.../vendor/`:

- `jqi-old.js` → `window.PBXVendor.legacy` — real **pre-3.2.6** `initialize`
- `jqi-new.js` → `window.PBXVendor.optimized` — real **3.2.6** `initialize`

The demo pages (`pages/`) are copied as-is. The harness (`pages/harness.js`) calls the
real `initialize(selector, callback, { target: document })` for the selected mode and
reports FPS, long-tasks/sec, max task time and callback matches. Mode `off` runs no
watcher. Commit both `source/` and the generated `public/` output.

## Vendored source

`vendor/{new,old}/` contains files copied verbatim from
`pixiebrix-source:libs/util-common/src/utils/`:

| version | files | source ref |
| --- | --- | --- |
| new (3.2.6) | `jQueryInitialize`, `sharedMutationObserver`, `selectorTokenIndex`, `routeChange` | `main` |
| old (pre-3.2.6) | `jQueryInitialize` | parent of the #8170 merge |

Two small shims keep the dependency tree shallow:

- `vendor/{new,old}/domUtils.ts` — minimal `$safeFind` (the real one pulls in a large
  util tree; only `$safeFind` is used by the watcher).
- `vendor/jquery-shim.ts` — supplies the `$` global via esbuild `--inject`.

When re-syncing from `pixiebrix-source`, two adjustments are applied:

1. Relative import specifiers are de-extensioned (`./foo.js` → `./foo`) so esbuild
   resolves them to the sibling `.ts` files.
2. jQuery is pinned to **3.7.1** because the watcher uses `$.find.tokenize` (Sizzle),
   which jQuery 4 removed.

> Type-only imports (`type-fest`, JQuery types) are erased by esbuild, so they need no
> install. `abort-utils` and `simple-event-target` are real runtime deps.
