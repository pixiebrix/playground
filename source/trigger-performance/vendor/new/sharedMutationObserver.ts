// Shared MutationObserver router (Tier 2 of #8164).
//
// Before this module, every `jQueryInitialize` call constructed its own MutationObserver on
// `document` and ran its own MutationObserver delivery loop per batch. With N active mods on
// a page that's N independent observers all woken on the same mutation batch.
// This module collapses those into one MutationObserver per target, with N subscribers
// fanned out from a single callback. Identical record batches reach every
// subscriber per the DOM spec (MutationObserver dispatch).
//
// Subscribers declare how much attribute observation they need. The router
// observes the union: any `"full"` subscriber forces unfiltered attribute
// observation; otherwise an `"id-class"` subscriber narrows to
// `attributeFilter: ['id', 'class']` (Tier 2 win — post-insertion
// `classList.add(...)` patterns still wake the token-indexed subscribers
// without observing every `aria-*` / `data-*` toggle); otherwise attributes
// are not observed at all.
//
// Subscribers may register a `handle` — when at least one handled subscriber
// is registered, the router walks the batch once and consults the per-target
// `selectorTokenIndex` to skip waking handled subscribers whose selectors
// can't match anything in the batch. Unhandled subscribers (legacy callers)
// wake unconditionally.
//
// Ported from agent-browser-shield#155 (`src/lib/subtree-watcher.ts`) and #158
// (per-subscriber attribute opt-in).

import { onAbort } from "abort-utils";

import {
  collectTokenTriggeredSubscribers,
  getComplexFallback,
  type SubscriberHandle,
} from "./selectorTokenIndex";

/**
 * How much attribute observation a subscriber wants from the shared MutationObserver. The
 * router observes the strictest mode across all subscribers on a given target.
 *
 * `"none"` — childList + subtree only; no attribute mutations delivered.
 *
 * `"id-class"` — narrow `attributeFilter: ['id', 'class']`. Sufficient for
 * selectors classified by the token index plus pure-class/pure-id combinator
 * selectors whose ancestor class toggles drive the safety-net sweep.
 *
 * `"full"` — `attributes: true` with no filter. Required for selectors that
 * match on attribute predicates other than id/class (e.g. `[data-x="y"]`,
 * `[aria-hidden]`, the `data-pb-extension-point-id` family) and for the
 * unknown-shape fallback in `MutationSelectorObserver.grok`'s catch branch.
 */
export type AttributeMode = "none" | "id-class" | "full";

export type SubscriberOptions = {
  target: HTMLElement | Document;
  attributeMode: AttributeMode;
  /**
   * When provided, the router walks each batch via the per-target
   * `selectorTokenIndex` and skips invoking this subscriber if the index
   * reports no triggering token from the batch. The caller is responsible
   * for registering the same handle in `selectorTokenIndex` against its
   * selector.
   *
   * Omit to opt into legacy fan-out (subscriber wakes on every batch).
   */
  handle?: SubscriberHandle;
  signal: AbortSignal;
};

export type SubscriberCallback = (records: MutationRecord[]) => void;

type SubscriberState = {
  callback: SubscriberCallback;
  attributeMode: AttributeMode;
  handle: SubscriberHandle | undefined;
};

type Router = {
  target: HTMLElement | Document;
  observer: MutationObserver;
  subscribers: Map<symbol, SubscriberState>;
  /** `null` until the first subscriber is added — distinguishes "router hasn't observed yet" from "router is currently observing with `none`-attribute config". */
  currentMode: AttributeMode | null;
  /** Number of subscribers that registered with `handle`. When >0 the dispatch path walks the batch via `selectorTokenIndex`. */
  handledCount: number;
};

const routers = new Map<EventTarget, Router>();

function computeAttributeMode(
  subscribers: Map<symbol, SubscriberState>,
): AttributeMode {
  let combined: AttributeMode = "none";

  for (const { attributeMode } of subscribers.values()) {
    if (attributeMode === "full") {
      return "full";
    }

    if (attributeMode === "id-class") {
      combined = "id-class";
    }
  }

  return combined;
}

function observerInit(mode: AttributeMode): MutationObserverInit {
  switch (mode) {
    case "full": {
      return { childList: true, subtree: true, attributes: true };
    }

    case "id-class": {
      return {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["id", "class"],
      };
    }

    case "none": {
      return { childList: true, subtree: true };
    }
  }
}

function reapplyConfig(router: Router): void {
  const mode = computeAttributeMode(router.subscribers);
  if (mode === router.currentMode) {
    return;
  }

  router.currentMode = mode;
  router.observer.observe(router.target, observerInit(mode));
}

/**
 * Walk a batch and return the union of subscriber handles the per-target
 * token index reports as triggered. Visits each added subtree root, its
 * descendants, and the target of each attribute mutation. Always includes
 * complex-fallback handles via the seed below.
 *
 * Caller guarantees at least one handled subscriber exists.
 *
 * Hot path: per-batch, per-added-subtree, per-descendant. Uses
 * `collectTokenTriggeredSubscribers` (id/class only, writes in place) instead
 * of `findTriggeredSubscribers` so the complex-fallback union happens once
 * via the seed below — not once per visited node.
 */
function collectTriggered(
  router: Router,
  records: MutationRecord[],
): Set<SubscriberHandle> {
  // Seed with the per-target complex-fallback set so handled complex-fallback
  // subscribers wake on every batch — including removal-only or text-only
  // batches where the token walk below never runs (it keys off `node.id` /
  // `node.classList`). Without this seed, batches that carry no Element
  // addedNodes and no attribute mutations would skip every handled subscriber
  // even though complex-fallback selectors don't depend on tokens.
  const triggered = new Set<SubscriberHandle>(
    getComplexFallback(router.target),
  );

  for (const record of records) {
    if (record.type === "childList") {
      for (const addedNode of record.addedNodes) {
        if (!(addedNode instanceof Element)) {
          continue;
        }

        collectTokenTriggeredSubscribers(addedNode, router.target, triggered);

        // Descendants — the existing per-subscriber loop runs `$safeFind`
        // against `addedNode`, which scans the whole subtree. Walk it once
        // here so every handled subscriber benefits from the same pass.
        for (const descendant of addedNode.querySelectorAll("*")) {
          collectTokenTriggeredSubscribers(
            descendant,
            router.target,
            triggered,
          );
        }
      }
    } else if (record.type === "attributes") {
      const { target } = record;
      if (target instanceof Element) {
        collectTokenTriggeredSubscribers(target, router.target, triggered);
      }
    }
  }

  return triggered;
}

function dispatch(router: Router, records: MutationRecord[]): void {
  // Snapshot — a subscriber callback may synchronously abort its own signal,
  // which mutates `router.subscribers`. Iterating the live map would skip
  // the next subscriber.
  const snapshot = [...router.subscribers.values()];

  const triggered =
    router.handledCount > 0 ? collectTriggered(router, records) : null;

  for (const subscriber of snapshot) {
    if (
      triggered != null &&
      subscriber.handle != null &&
      !triggered.has(subscriber.handle)
    ) {
      continue;
    }

    // Match the listener-isolation guarantee documented in routeChange.ts:57-62
    // — a throwing subscriber must not block later ones. SimpleEventTarget gets
    // this from the underlying native EventTarget; here we wrap by hand
    // because subscribers carry structured state (attribute requirements,
    // optional handles) that an emit-and-forget event target can't model.
    try {
      subscriber.callback(records);
    } catch (error: unknown) {
      reportError(error);
    }
  }
}

function createRouter(target: HTMLElement | Document): Router {
  // `observer` populated immediately below; declared first so the callback
  // can close over the Router value (computeUnion + dispatch need it).
  const router: Router = {
    target,
    observer: undefined as unknown as MutationObserver,
    subscribers: new Map(),
    currentMode: null,
    handledCount: 0,
  };

  router.observer = new MutationObserver((records) => {
    dispatch(router, records);
  });

  return router;
}

function getOrCreateRouter(target: HTMLElement | Document): Router {
  let router = routers.get(target);
  if (!router) {
    router = createRouter(target);
    routers.set(target, router);
  }

  return router;
}

/**
 * Subscribe to mutations on `options.target`. The router consolidates all
 * subscribers on a given target onto one `MutationObserver`; the underlying
 * observer's config is the union of every subscriber's `attributeMode`.
 *
 * The subscriber callback receives the batch records — per-subscriber
 * filtering (e.g. selector matching, IGNORE_TAGS, isConnected) is the
 * subscriber's responsibility. When the subscriber registers a `handle`, the
 * router consults `selectorTokenIndex` to skip the callback for batches whose
 * tokens can't match the subscriber's selector. A throwing subscriber is
 * reported via `reportError` and does not block later ones.
 *
 * Pass `options.signal` to unsubscribe. There is no separate unsubscribe
 * handle. When the last subscriber on a target unsubscribes the underlying
 * observer is disconnected and the router entry is dropped.
 */
export function subscribeMutations(
  callback: SubscriberCallback,
  options: SubscriberOptions,
): void {
  if (options.signal.aborted) {
    return;
  }

  const router = getOrCreateRouter(options.target);
  const subscriberKey = Symbol("sharedMutationObserver subscriber");
  router.subscribers.set(subscriberKey, {
    callback,
    attributeMode: options.attributeMode,
    handle: options.handle,
  });
  if (options.handle !== undefined) {
    router.handledCount++;
  }

  reapplyConfig(router);

  onAbort(options.signal, () => {
    // The router may have been replaced (`TEST_resetSharedMutationObserver`)
    // since registration; resolve fresh from the map rather than from the
    // closure-captured reference.
    const current = routers.get(options.target);
    if (!current) {
      return;
    }

    const removed = current.subscribers.get(subscriberKey);
    current.subscribers.delete(subscriberKey);
    if (removed?.handle !== undefined) {
      current.handledCount--;
    }

    if (current.subscribers.size === 0) {
      current.observer.disconnect();
      routers.delete(options.target);
      return;
    }

    reapplyConfig(current);
  });
}

/**
 * Test-only: disconnect every active router and drop their state. Matches
 * the `TEST_resetRouteChange` precedent — prevents cross-test bleed of
 * module-level singleton state.
 *
 * @internal
 */
export function TEST_resetSharedMutationObserver(): void {
  for (const router of routers.values()) {
    router.observer.disconnect();
  }

  routers.clear();
}
