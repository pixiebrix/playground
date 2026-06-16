// Process-wide SPA route-change emitter (Tier 1S of #8164).
//
// Subscribers proactively re-sweep when the URL changes — without it, a
// React/Vue route swap leaves ancestor-dependent selectors waiting out the
// trailing-only 100ms throttle introduced in Tier 1 (#8170) before the
// safety-net QSA fires. Particularly load-bearing for PII-masking triggers
// whose selectors gate on a route-applied ancestor class.
//
// Coverage:
//   - Navigation API (`navigatesuccess`) — modern Chrome; fires for every
//     navigation including page-side pushState/replaceState that a content
//     script cannot otherwise hook.
//   - `popstate` — back/forward.
//   - `hashchange` — hash routing.
//
// Older browsers without the Navigation API miss pushState-only routes, but
// the MutationObserver still catches the new content on the next throttle
// window — the route-change signal is a latency optimization, not a
// correctness requirement.
//
// Ported from agent-browser-shield#152 (`src/lib/route-change.ts`).

import SimpleEventTarget from "simple-event-target";

interface NavigationGlobal {
  navigation?: EventTarget;
}

let routeChange = new SimpleEventTarget();
let installController: AbortController | null = null;
let lastUrl = "";

function emit(): void {
  const url = globalThis.location.href;
  if (url === lastUrl) {
    return;
  }

  lastUrl = url;
  // SimpleEventTarget wraps a native EventTarget — per the DOM spec a
  // throwing listener is reported (routed to `reportError`) and dispatch
  // continues to the next subscriber. We rely on that isolation here so a
  // single faulty observer (e.g. a malformed selector throwing inside
  // `runSweep`) does not block the rest from sweeping.
  routeChange.emit();
}

function install(): void {
  if (installController) {
    return;
  }

  installController = new AbortController();
  const { signal } = installController;
  lastUrl = globalThis.location.href;

  const { navigation } = globalThis as NavigationGlobal;
  if (navigation) {
    navigation.addEventListener("navigatesuccess", emit, { signal });
  }

  globalThis.addEventListener("popstate", emit, { signal });
  globalThis.addEventListener("hashchange", emit, { signal });
}

/**
 * Subscribe to URL changes. The listener is called once per detected change;
 * same-URL events are deduped at the module level. Passing the same listener
 * reference twice subscribes once — `SimpleEventTarget` dedupes by reference.
 *
 * Pass `options.signal` to unsubscribe — aborting the signal removes the
 * listener. There is no separate unsubscribe handle.
 */
export function subscribeRouteChange(
  listener: () => void,
  options?: { signal?: AbortSignal },
): void {
  install();
  routeChange.subscribe(listener, options);
}

/**
 * Test-only: reset module state between tests. Aborts the install controller
 * (removing the underlying popstate/hashchange/navigatesuccess listeners) and
 * replaces the emitter so previously-subscribed listeners are dropped.
 *
 * @internal
 */
export function TEST_resetRouteChange(): void {
  installController?.abort();
  installController = null;
  routeChange = new SimpleEventTarget();
  lastUrl = "";
}
