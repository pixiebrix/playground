// Per-target id/class token index (Tier 2 of #8164).
//
// For a pure `#id` or `.class` selector, the index lets `jQueryInitialize`
// decide in O(1) whether a given added node is worth jQuery-matching against
// a subscriber's full selector. Anything that isn't a single `#id` or `.class`
// token (combinators, attributes, pseudos, `:has`/`:is`/`:not`/`:where`,
// multi-clause `, `) goes into a per-target complex-fallback bucket whose
// subscribers wake on every dispatch — that preserves today's safety-net QSA
// behavior for compound selectors.
//
// Ported from agent-browser-shield#157 (`src/lib/selector-token-index.ts`).
// The strict-regex approach matches shield's design and keeps the index
// decoupled from jQuery/Sizzle.

export type ParsedSelector =
  | { kind: "id"; token: string }
  | { kind: "class"; token: string }
  | { kind: "complex" };

export type SubscriberHandle = symbol;

// CSS identifier — must start with letter, underscore, or dash, then
// letter/digit/underscore/dash. Strict on purpose: leading-digit idents are
// invalid CSS, and anything weirder (escaped characters, unicode beyond the
// basic range) goes to complex-fallback rather than risk a false match.
const ID_SELECTOR = /^#([A-Za-z_-][\w-]*)$/;
const CLASS_SELECTOR = /^\.([A-Za-z_-][\w-]*)$/;

/**
 * Classify a selector for token-index purposes. Single-clause pure `#id` or
 * `.class` selectors are indexable; everything else falls back to the
 * complex bucket.
 */
export function parseSelector(selector: string): ParsedSelector {
  const trimmed = selector.trim();

  const idMatch = ID_SELECTOR.exec(trimmed);
  if (idMatch?.[1]) {
    return { kind: "id", token: idMatch[1] };
  }

  const classMatch = CLASS_SELECTOR.exec(trimmed);
  if (classMatch?.[1]) {
    return { kind: "class", token: classMatch[1] };
  }

  return { kind: "complex" };
}

type TargetIndex = {
  idIndex: Map<string, Set<SubscriberHandle>>;
  classIndex: Map<string, Set<SubscriberHandle>>;
  complexFallback: Set<SubscriberHandle>;
};

const targetIndexes = new Map<EventTarget, TargetIndex>();

function getOrCreateIndex(target: EventTarget): TargetIndex {
  let index = targetIndexes.get(target);
  if (!index) {
    index = {
      idIndex: new Map(),
      classIndex: new Map(),
      complexFallback: new Set(),
    };
    targetIndexes.set(target, index);
  }

  return index;
}

function addToBucket(
  bucket: Map<string, Set<SubscriberHandle>>,
  token: string,
  subscriber: SubscriberHandle,
): void {
  let set = bucket.get(token);
  if (!set) {
    set = new Set();
    bucket.set(token, set);
  }

  set.add(subscriber);
}

function removeFromBucket(
  bucket: Map<string, Set<SubscriberHandle>>,
  token: string,
  subscriber: SubscriberHandle,
): void {
  const set = bucket.get(token);
  if (!set) {
    return;
  }

  set.delete(subscriber);
  if (set.size === 0) {
    bucket.delete(token);
  }
}

/**
 * Register a subscriber against a selector on the given target. Token-eligible
 * selectors land in the id/class index; everything else goes to
 * complex-fallback (woken on every dispatch).
 */
export function registerSelector(
  selector: string,
  subscriber: SubscriberHandle,
  target: EventTarget,
): void {
  const index = getOrCreateIndex(target);
  const parsed = parseSelector(selector);

  switch (parsed.kind) {
    case "id": {
      addToBucket(index.idIndex, parsed.token, subscriber);
      return;
    }

    case "class": {
      addToBucket(index.classIndex, parsed.token, subscriber);
      return;
    }

    case "complex": {
      index.complexFallback.add(subscriber);
    }
  }
}

/**
 * Unregister a subscriber previously registered with the same selector + target.
 */
export function unregisterSelector(
  selector: string,
  subscriber: SubscriberHandle,
  target: EventTarget,
): void {
  const index = targetIndexes.get(target);
  if (!index) {
    return;
  }

  const parsed = parseSelector(selector);

  switch (parsed.kind) {
    case "id": {
      removeFromBucket(index.idIndex, parsed.token, subscriber);
      break;
    }

    case "class": {
      removeFromBucket(index.classIndex, parsed.token, subscriber);
      break;
    }

    case "complex": {
      index.complexFallback.delete(subscriber);
    }
  }

  if (
    index.idIndex.size === 0 &&
    index.classIndex.size === 0 &&
    index.complexFallback.size === 0
  ) {
    targetIndexes.delete(target);
  }
}

/**
 * Return the set of subscribers that should consider `node` worth matching
 * against their selector. Always includes every complex-fallback subscriber;
 * unions in the id/class token-index buckets that match the node's own
 * `id` and `classList` tokens.
 *
 * Callers must still check descendants and ancestors themselves — the index
 * only reports based on the node's own identifying tokens. The safety-net QSA
 * scheduled by the throttled `runSweep` covers ancestor-dependent matches.
 *
 * For per-batch hot paths that already seed a triggered set with
 * `getComplexFallback`, prefer `collectTokenTriggeredSubscribers` to avoid
 * the per-call `Set` allocation + redundant complex-fallback union.
 */
export function findTriggeredSubscribers(
  node: Element,
  target: EventTarget,
): Set<SubscriberHandle> {
  const index = targetIndexes.get(target);
  if (!index) {
    return new Set();
  }

  const matches = new Set<SubscriberHandle>(index.complexFallback);

  if (node.id) {
    const idSubscribers = index.idIndex.get(node.id);
    if (idSubscribers) {
      for (const subscriber of idSubscribers) {
        matches.add(subscriber);
      }
    }
  }

  // Element.classList iterates lazily; cheap when the list is empty.
  for (const token of node.classList) {
    const classSubscribers = index.classIndex.get(token);
    if (classSubscribers) {
      for (const subscriber of classSubscribers) {
        matches.add(subscriber);
      }
    }
  }

  return matches;
}

/**
 * Hot-path variant of `findTriggeredSubscribers` for callers that have
 * already seeded `out` with `getComplexFallback(target)` — visits the id /
 * class buckets only and writes any matches into `out` in place.
 *
 * Avoids the per-call `Set` allocation + complex-fallback union that
 * `findTriggeredSubscribers` does. Used by the shared MutationObserver
 * router's per-batch token walk, where the same call fires once per added
 * subtree root *and* once per descendant.
 */
export function collectTokenTriggeredSubscribers(
  node: Element,
  target: EventTarget,
  out: Set<SubscriberHandle>,
): void {
  const index = targetIndexes.get(target);
  if (!index) {
    return;
  }

  if (node.id) {
    const idSubscribers = index.idIndex.get(node.id);
    if (idSubscribers) {
      for (const subscriber of idSubscribers) {
        out.add(subscriber);
      }
    }
  }

  // Element.classList iterates lazily; cheap when the list is empty.
  for (const token of node.classList) {
    const classSubscribers = index.classIndex.get(token);
    if (classSubscribers) {
      for (const subscriber of classSubscribers) {
        out.add(subscriber);
      }
    }
  }
}

const EMPTY_FALLBACK: ReadonlySet<SubscriberHandle> = new Set();

/**
 * Return the complex-fallback set for the target — subscribers whose
 * selectors didn't classify as a pure `#id` or `.class` token. The shared MutationObserver
 * router seeds its per-batch triggered set with these so they wake on every
 * batch regardless of which records the batch carries (including removal-only
 * or text-only batches that `findTriggeredSubscribers` can't see, since it
 * keys off `node.id` / `node.classList`).
 */
export function getComplexFallback(
  target: EventTarget,
): ReadonlySet<SubscriberHandle> {
  return targetIndexes.get(target)?.complexFallback ?? EMPTY_FALLBACK;
}

/**
 * Test-only: drop all indexes between tests so subscriptions from one test
 * don't leak into the next. Matches the `TEST_resetRouteChange` precedent.
 *
 * @internal
 */
export function TEST_resetSelectorTokenIndex(): void {
  targetIndexes.clear();
}
