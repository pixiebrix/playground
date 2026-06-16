// Originally based on jquery.initialize by Adam Pietrasiak (MIT):
//   Copyright (c) 2015-2016 Adam Pietrasiak
//   https://github.com/pie6k/jquery.initialize/blob/master/jquery.initialize.js
// Significantly modified for use in PixieBrix:
// - exposed as a module instead of a jQuery plugin
// - uses $safeFind to surface invalid selectors (#3061)
// - Tier 1 perf overhaul (#8164): trailing-only throttle, burst-size flush,
//   IGNORE_TAGS enqueue filter, visibilitychange pause, detached-subtree
//   fast-path. Ported from agent-browser-shield#151.
// - Tier 1S (#8164): SPA route-change re-sweep. Ported from
//   agent-browser-shield#152.
// - Tier 2 (#8164): shared MutationObserver router + id/class token index +
//   narrow `attributeFilter: ['id', 'class']`. Ported from
//   agent-browser-shield#155 + #157 + #158.

import { throttle } from "lodash-es";
import type { Promisable } from "type-fest";

import { $safeFind } from "./domUtils";
import { subscribeRouteChange } from "./routeChange";
import {
  parseSelector,
  registerSelector,
  type SubscriberHandle,
  unregisterSelector,
} from "./selectorTokenIndex";
import {
  type AttributeMode,
  subscribeMutations,
} from "./sharedMutationObserver";

// --- Tier 1 configuration ---

// Toggle for `performance.mark` probe around the observer callback and the
// fallback full-doc QSA. Off by default — flip to true locally to attribute
// MutationObserver work in DevTools Performance.
const ENABLE_PERF_MARKS = false;

// Conservative tag set matching agent-browser-shield#151. Uppercase so it
// compares directly against `Node.nodeName`.
const IGNORE_TAGS = new Set(["STYLE", "BR"]);

// Drain the fallback sweep immediately if a single mutation batch added more
// than this many qualifying nodes (e.g. a React route swap dumping thousands
// of nodes in one microtask). Pattern from Ghostery's DOMMonitor.
const BURST_FLUSH_THRESHOLD = 512;

const THROTTLE_MS = 100;

// Layer C kill switch. Default on (filter active). Flipped via
// `setIgnoreTagsEnabled(false)` at content-script startup when the waffle
// flag `jquery-initialize-ignore-tags-disabled` is on for the user.
let ignoreTagsEnabled = true;

/**
 * Toggle the IGNORE_TAGS enqueue filter globally. Intended to be called once
 * at content-script bootstrap from a feature-flag read; passing `false`
 * disables the filter for every observer (matching legacy behavior).
 */
export function setIgnoreTagsEnabled(value: boolean): void {
  ignoreTagsEnabled = Boolean(value);
}

// ---

// https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Selectors#Combinators
const combinators = new Set([" ", ">", "+", "~"]);
// These combinators involve siblings.
const fraternisers = new Set(["+", "~"]);
// These selectors are based on attributes.
const complexTypes = new Set(["ATTR", "PSEUDO", "ID", "CLASS"]);

type InitializeCallback = (
  index: number,
  element: Element,
) => Promisable<void | false>;

// Matches the callback shape jQuery's `.each()` invokes with `this` bound to the matched element.
type EachCallback = (
  this: Element,
  index: number,
  element: Element,
) => false | void;

type InitializeOptions = {
  target: HTMLElement | Document;
};

// MutationSelectorObserver represents a selector and its associated initialization callback.
class MutationSelectorObserver {
  readonly selector: string;
  readonly callback: EachCallback;
  readonly options: InitializeOptions;
  isCombinatorial = false;
  isFraternal = false;
  isComplex = false;
  // Tier 2: true when the selector contains an attribute predicate other than
  // id/class (e.g. `[data-x="y"]`, `[aria-hidden]`). The shared MutationObserver must observe
  // attributes unfiltered for this selector — the narrow `id`/`class` filter
  // would silently drop the mutations this selector depends on.
  hasAttrToken = false;
  // Layer B: set in `grok()` when any TAG token in the selector names a tag in
  // IGNORE_TAGS. The enqueue filter is bypassed for this observer so a user
  // selector legitimately targeting STYLE/BR is not silently dropped.
  targetsIgnoredTag = false;

  constructor(
    selector: string,
    callback: EachCallback,
    options: InitializeOptions,
  ) {
    this.selector = selector.trim();
    this.callback = callback;
    this.options = options;

    grok(this);
  }
}

// Understand what kind of selector the initializer is based upon.
function grok(msobserver: MutationSelectorObserver): void {
  if (!$.find.tokenize) {
    // This is an old version of jQuery, so cannot parse the selector.
    // Therefore we must assume the worst case scenario. That is, that
    // this is a complicated selector. This feature was available in:
    // https://github.com/jquery/sizzle/issues/242
    msobserver.isCombinatorial = true;
    msobserver.isFraternal = true;
    msobserver.isComplex = true;
    // Tier 2 fallback: without tokenize we can't tell whether the selector
    // depends on an attribute predicate, so force full attribute observation
    // rather than narrow to id/class.
    msobserver.hasAttrToken = true;
    // Layer B fallback: without tokenize we can't introspect the selector,
    // so opt out of the IGNORE_TAGS filter to avoid silently dropping a
    // selector that happens to target STYLE/BR.
    msobserver.targetsIgnoredTag = true;
    return;
  }

  try {
    const tokens = $.find.tokenize(msobserver.selector);
    for (const clause of tokens) {
      for (const part of clause) {
        if (combinators.has(part.type)) {
          // This selector uses combinators.
          msobserver.isCombinatorial = true;
        }

        if (fraternisers.has(part.type)) {
          // This selector uses sibling combinators.
          msobserver.isFraternal = true;
        }

        if (complexTypes.has(part.type)) {
          // This selector is based on attributes.
          msobserver.isComplex = true;
        }

        if (part.type === "ATTR") {
          // Tier 2: an explicit attribute predicate forces full attribute
          // observation on the shared MutationObserver. id/class CLASS/ID tokens (line
          // above) are covered by the narrow `attributeFilter: ['id','class']`.
          msobserver.hasAttrToken = true;
        }

        // Layer B: if any clause names a tag in IGNORE_TAGS, this observer
        // would silently miss matches under the default filter — bypass it
        // for this observer. Note: Sizzle does not descend into `:has(...)`,
        // `:is(...)`, `:not(...)`, or `:where(...)` arguments, so e.g.
        // `div:has(style)` and `div:is(.foo, style)` are NOT flagged here.
        // The trailing full-doc QSA covers those edge cases within one
        // throttle window.
        if (
          part.type === "TAG" &&
          typeof part.value === "string" &&
          IGNORE_TAGS.has(part.value.toUpperCase())
        ) {
          msobserver.targetsIgnoredTag = true;
        }
      }
    }
  } catch {
    // Fail open: if Sizzle changes and tokenize throws, treat as the legacy
    // unknown-shape branch above. Better to do extra QSA work than to drop a
    // mutation a user-authored selector would otherwise catch.
    msobserver.isCombinatorial = true;
    msobserver.isFraternal = true;
    msobserver.isComplex = true;
    msobserver.hasAttrToken = true;
    msobserver.targetsIgnoredTag = true;
  }
}

/**
 * Attach a MutationObserver to watch for elements matching `selector` and run `callback` against
 * each new match exactly once. Includes a throttled safety-net query for selectors whose match is
 * triggered by ancestor/sibling mutations.
 */
export default function initialize(
  selector: string,
  callback: InitializeCallback,
  options: InitializeOptions,
): MutationObserver {
  let isMatchInProgress = false;

  // Wrap the callback so that it is only called once per element.
  const seen = new WeakSet<Element>();
  function callbackOnce(this: Element): void {
    if (seen.has(this)) {
      return;
    }

    seen.add(this);
    $(this).each((index, element) => {
      // Don't block the page transition/animation frame
      setTimeout(() => {
        void callback(index, element);
      }, 0);
    });
  }

  // Safety-net full-document sweep. Catches selectors that newly match
  // because an ancestor changed (where the synchronous added-node match in
  // the MutationObserver callback wouldn't fire). Skipped while the document is hidden —
  // the visibility-resume handler runs `runSweep()` synchronously on the
  // foreground transition.
  let idleCallbackHandle: number | null = null;
  const runSweep = (): void => {
    if (document.hidden) {
      return;
    }

    if (ENABLE_PERF_MARKS) {
      performance.mark("pb:jq-init:sweep");
    }

    $safeFind(selector, options.target).each(callbackOnce);
  };

  const doDirectSweep = (): void => {
    if (isMatchInProgress) {
      return;
    }

    // Don't accumulate idle callbacks
    if (idleCallbackHandle != null) {
      return;
    }

    // Wrap in requestIdleCallback so the safety-net QSA doesn't block
    // animation frames. The visibility-resume path bypasses this wrap
    // and calls runSweep() directly — see onVisibilityChange below.
    idleCallbackHandle = requestIdleCallback(
      () => {
        requestAnimationFrame(() => {
          runSweep();
          idleCallbackHandle = null;
        });
      },
      { timeout: 150 },
    );
  };

  // Trailing-only throttle — coalesces multiple mutation batches into one
  // safety-net QSA per 100ms window. The synchronous added-node match in the
  // MutationObserver callback below is unchanged, so first-match latency is unaffected
  // unless an ancestor change is the only signal.
  const throttledCheckTarget = throttle(doDirectSweep, THROTTLE_MS, {
    leading: false,
    trailing: true,
  });

  // Initial check at registration. doDirectSweep itself schedules via
  // requestIdleCallback + rAF (it isn't synchronous), but firing it now —
  // rather than only on a future mutation — means a selector that already
  // matches an element on the page dispatches without waiting for an MutationObserver
  // event or the trailing throttle window.
  doDirectSweep();

  const msobserver = new MutationSelectorObserver(
    selector,
    callbackOnce,
    options,
  );

  // Mutation-record dispatch loop. Extracted so the visibility-pause and
  // shared-MutationObserver subscriber paths can wrap it (early-return while hidden; the
  // shared MutationObserver can't be disconnected for a single subscriber).
  const processMutations = (mutations: MutationRecord[]): void => {
    // Avoid loop caused by Sizzle changing attributes while querying
    // https://github.com/pie6k/jquery.initialize/issues/29
    // https://github.com/jquery/sizzle/blob/20390f05731af380833b5aa805db97de0b91268a/src/sizzle.js#L344
    if (isMatchInProgress) {
      return;
    }

    isMatchInProgress = true;

    if (ENABLE_PERF_MARKS) {
      performance.mark("pb:jq-init:cb");
    }

    // Use try/finally so the flag always clears: pre-fix, a throw from jQuery / `$safeFind`
    // (e.g. an invalid selector) left `isMatchInProgress = true` and the early-return guard above
    // skipped every subsequent mutation — observer wedged for the lifetime of the page.
    //
    // The throw still propagates out of the MutationObserver callback. Real browsers route it to
    // `window.onerror` and continue invoking the callback on future mutations; in tests it
    // surfaces as an uncaught error. TODO: design intentional error handling here
    // (catch + telemetry, dedup, optional disconnect) and add focused tests in a follow-up PR.
    try {
      const matches: Element[] = [];
      // Track qualifying added-node count for burst-flush detection. Counts
      // only nodes that survived the isConnected + IGNORE_TAGS filters.
      let addedCount = 0;

      for (const mutation of mutations) {
        // If this is an attributes mutation, the target is the node upon which the mutation occurred.
        if (mutation.type === "attributes") {
          const target = mutation.target as Element;

          // Check if the mutated node matches.
          if ($(target).is(msobserver.selector)) {
            matches.push(target);
          }

          // If the selector is fraternal, query siblings of the mutated node for matches;
          // otherwise query descendants.
          const scope = msobserver.isFraternal ? target.parentElement : target;
          if (scope != null) {
            matches.push(
              ...$safeFind<HTMLElement>(
                msobserver.selector,
                // The cast satisfies $safeFind's narrower type; jQuery accepts any Element at runtime.
                scope as HTMLElement,
              ).toArray(),
            );
          }
        }

        // If this is a childList mutation, inspect added nodes.
        if (mutation.type === "childList") {
          for (const addedNode of mutation.addedNodes) {
            if (!(addedNode instanceof Element)) {
              continue;
            }

            // Detached-subtree fast-path: React's add-then-remove-in-one-
            // microtask pattern shows up here as an Element whose isConnected
            // is already false by the time the MutationObserver callback runs. The page
            // never saw it either; skip. If the same subtree is reattached
            // later via an ancestor mutation, the trailing safety-net QSA
            // picks it up.
            if (!addedNode.isConnected) {
              continue;
            }

            // IGNORE_TAGS enqueue filter (Layer B + Layer C). Bypass when the
            // observer's own selector targets one of the ignored tags
            // (per-observer Layer B) or when the global kill switch is off
            // (Layer C).
            if (
              ignoreTagsEnabled &&
              !msobserver.targetsIgnoredTag &&
              IGNORE_TAGS.has(addedNode.nodeName)
            ) {
              continue;
            }

            addedCount++;

            // Check if the added node matches the selector
            if ($(addedNode).is(msobserver.selector)) {
              matches.push(addedNode);
            }

            // If the selector is fraternal, query siblings for matches; otherwise query descendants.
            const scope = msobserver.isFraternal
              ? addedNode.parentElement
              : addedNode;
            if (scope != null) {
              matches.push(
                ...$safeFind<HTMLElement>(
                  msobserver.selector,
                  scope as HTMLElement,
                ).toArray(),
              );
            }
          }
        }
      }

      // For each match, call the callback using jQuery.each() to initialize the element (once only).
      for (const match of matches) {
        $(match).each(msobserver.callback);
      }

      if (ENABLE_PERF_MARKS) {
        performance.mark("pb:jq-init:cb:end");
      }

      // Clear the flag BEFORE scheduling the safety-net QSA. The burst path
      // below calls `doDirectSweep()` synchronously, and that helper
      // early-returns when `isMatchInProgress` is true. (The trailing throttle
      // path is unaffected since lodash defers the call.) The finally below is
      // a safety net for throws in the loop above.
      isMatchInProgress = false;

      // Schedule the safety-net QSA. Burst-flush: if this batch alone added
      // more qualifying nodes than the threshold, run the sweep immediately
      // rather than coalescing into the trailing window.
      if (addedCount > BURST_FLUSH_THRESHOLD) {
        throttledCheckTarget.cancel();
        doDirectSweep();
      } else {
        throttledCheckTarget();
      }
    } finally {
      // Must always clear to avoid wedging the observer (and to avoid entering an infinite loop).
      isMatchInProgress = false;
    }
  };

  // Attribute observation mode (Tier 2):
  // - "full" when the selector references attributes other than id/class
  //   (e.g. `[data-x]`, the unknown-shape fallback). The narrow filter would
  //   silently drop the mutations these selectors depend on.
  // - "id-class" for selectors with id/class/pseudo predicates, including
  //   combinatorial id/class selectors like `.foo .bar` — ancestor class
  //   toggles still wake the trailing safety-net sweep under the narrow
  //   filter.
  // - "none" for plain tag / combinator-of-tags selectors with no
  //   attribute-driven matching path.
  const attributeMode: AttributeMode = msobserver.hasAttrToken
    ? "full"
    : msobserver.isComplex
      ? "id-class"
      : "none";

  // Token-index handle. The shared MutationObserver router consults
  // `selectorTokenIndex` to decide whether this subscriber should wake on a
  // given batch — pure `#id` / `.class` selectors short-circuit when the
  // batch contains no matching tokens.
  //
  // Only token-indexable selectors register a handle. Complex selectors
  // (combinators, attribute predicates, pseudos, multi-clause) would land in
  // the complex-fallback bucket where the index can't skip them anyway — so
  // we omit the handle and let the router fan out to this subscriber
  // unconditionally. That also keeps the router's per-batch token walk
  // strictly opt-in: pages where every active selector is complex no longer
  // pay for `collectTriggered` at all.
  const subscriberHandle: SubscriberHandle | undefined =
    parseSelector(selector).kind === "complex"
      ? undefined
      : Symbol(`jQueryInitialize "${selector}"`);
  if (subscriberHandle !== undefined) {
    registerSelector(selector, subscriberHandle, options.target);
  }

  // Single AbortController drives all teardown — visibility listener, shared
  // MutationObserver subscription, route-change subscription. `disconnect()` aborts it.
  const cleanupController = new AbortController();

  // Wrap processMutations with a document-hidden short-circuit. The shared
  // MutationObserver can't be disconnected for one subscriber (other subscribers may need
  // it), so a hidden tab still delivers records — we just no-op on them.
  // The visibility-resume handler calls `runSweep()` synchronously to catch
  // up against the foreground DOM.
  const onMutations = (records: MutationRecord[]): void => {
    if (document.hidden) {
      return;
    }

    processMutations(records);
  };

  subscribeMutations(onMutations, {
    target: options.target,
    attributeMode,
    handle: subscriberHandle,
    signal: cleanupController.signal,
  });

  // Visibilitychange pause: stop scheduling QSAs while the tab is hidden.
  // The shared MutationObserver continues to fire (other subscribers may not be
  // visibility-paused); `onMutations` above no-ops on records while hidden.
  const onVisibilityChange = (): void => {
    if (document.hidden) {
      throttledCheckTarget.cancel();
      if (idleCallbackHandle != null) {
        cancelIdleCallback(idleCallbackHandle);
        idleCallbackHandle = null;
      }
    } else {
      // Run the catch-up QSA synchronously — skip the requestIdleCallback
      // + rAF wrap that doDirectSweep would have applied. The tab just
      // became foreground; the ~150ms rIC timeout is the difference
      // between a PII-masking trigger firing on the next setTimeout(0)
      // versus the user staring at unmasked content while idle work
      // waits. Cancel any pending idle sweep first — runSweep covers
      // everything it would have caught.
      if (idleCallbackHandle != null) {
        cancelIdleCallback(idleCallbackHandle);
        idleCallbackHandle = null;
      }

      runSweep();
    }
  };

  document.addEventListener("visibilitychange", onVisibilityChange, {
    signal: cleanupController.signal,
  });

  // SPA route-change re-sweep (Tier 1S, #8164). The trailing-only throttle
  // means ancestor-dependent selectors (e.g. `body.route-loaded .ssn`) wait
  // up to ~100ms after a framework commits a new route before the safety-net
  // QSA fires. Schedule the catch-up sweep one rAF after the URL changes —
  // by then the framework has typically committed the new DOM.
  //
  // Note: unlike Tier 1S, we do NOT drain the underlying MutationObserver's buffer via
  // `takeRecords()` — the buffer is co-owned by other subscribers on the
  // shared router. Redundant `processMutations` dispatches between this
  // handler and the rAF sweep are absorbed by the `seen` WeakSet.
  let routeSweepHandle: number | null = null;
  const cancelRouteSweep = (): void => {
    if (routeSweepHandle == null) {
      return;
    }

    cancelAnimationFrame(routeSweepHandle);
    routeSweepHandle = null;
  };

  const onRouteChange = (): void => {
    throttledCheckTarget.cancel();
    if (idleCallbackHandle != null) {
      cancelIdleCallback(idleCallbackHandle);
      idleCallbackHandle = null;
    }

    cancelRouteSweep();

    if (document.hidden) {
      // The visibility-resume sweep will catch up when the tab becomes
      // foreground. Skip the rAF schedule — it would never fire anyway and
      // a stale handle here would leak across the hidden interval until
      // disconnect.
      return;
    }

    routeSweepHandle = requestAnimationFrame(() => {
      routeSweepHandle = null;
      runSweep();
    });
  };

  subscribeRouteChange(onRouteChange, { signal: cleanupController.signal });

  // Return a `MutationObserver`-shaped wrapper. Callers (`waitForInitialize`,
  // both starter bricks) only invoke `.disconnect()`; the legacy code path
  // also returned a wrapped MutationObserver whose only meaningful method was `.disconnect`.
  return {
    disconnect(): void {
      cleanupController.abort();
      cancelRouteSweep();
      throttledCheckTarget.cancel();
      if (idleCallbackHandle != null) {
        cancelIdleCallback(idleCallbackHandle);
        idleCallbackHandle = null;
      }

      if (subscriberHandle !== undefined) {
        unregisterSelector(selector, subscriberHandle, options.target);
      }
    },
  } as unknown as MutationObserver;
}
