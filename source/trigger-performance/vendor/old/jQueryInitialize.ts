/*
 * Copyright (C) 2026 PixieBrix, Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

// Originally based on jquery.initialize by Adam Pietrasiak (MIT):
//   Copyright (c) 2015-2016 Adam Pietrasiak
//   https://github.com/pie6k/jquery.initialize/blob/master/jquery.initialize.js
// Significantly modified for use in PixieBrix:
// - exposed as a module instead of a jQuery plugin
// - uses $safeFind to surface invalid selectors (#3061)

import { throttle } from "lodash-es";
import type { Promisable } from "type-fest";

import { $safeFind } from "./domUtils";

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
  observer?: MutationObserverInit;
};

// MutationSelectorObserver represents a selector and its associated initialization callback.
class MutationSelectorObserver {
  readonly selector: string;
  readonly callback: EachCallback;
  readonly options: InitializeOptions;
  isCombinatorial = false;
  isFraternal = false;
  isComplex = false;

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
    return;
  }

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
    }
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

  // Fall-back handler to check the entire page for the selector.
  // Try to choose timeouts that are long enough to avoid performance bottlenecks, but short enough
  // to provide responsiveness for triggers that depend on ancestor/sibling elements changing.
  let idleCallbackHandle: number | null = null;
  const throttledCheckTarget = throttle(
    () => {
      if (isMatchInProgress) {
        return;
      }

      // Don't accumulate idle callbacks
      if (idleCallbackHandle != null) {
        return;
      }

      // Wrap in requestIdleCallback to prevent impacting performance
      idleCallbackHandle = requestIdleCallback(
        () => {
          requestAnimationFrame(() => {
            $safeFind(selector, options.target).each(callbackOnce);
            idleCallbackHandle = null;
          });
        },
        { timeout: 150 },
      );
    },
    100,
    { leading: true, trailing: true },
  );

  // See if the selector matches any elements already on the page.
  throttledCheckTarget();

  const msobserver = new MutationSelectorObserver(
    selector,
    callbackOnce,
    options,
  );

  const observer = new MutationObserver((mutations) => {
    // Avoid loop caused by Sizzle changing attributes while querying
    // https://github.com/pie6k/jquery.initialize/issues/29
    // https://github.com/jquery/sizzle/blob/20390f05731af380833b5aa805db97de0b91268a/src/sizzle.js#L344
    if (isMatchInProgress) {
      return;
    }

    isMatchInProgress = true;

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

      // Check if the match applies now that the document has been updated. This handles cases where
      // an ancestor was added/modified causing an element on the page to now match. This strictly
      // isn't an "initialization", as the element wasn't just added. But conceptually, it corresponds
      // to the selector now matching a new argument.
      throttledCheckTarget();
    } finally {
      // Must always clear to avoid wedging the observer (and to avoid entering an infinite loop).
      isMatchInProgress = false;
    }
  });

  const defaultObserverOptions: MutationObserverInit = {
    childList: true,
    subtree: true,
    attributes: msobserver.isComplex,
  };
  observer.observe(options.target, options.observer ?? defaultObserverOptions);

  return observer;
}
