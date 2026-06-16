/*
 * trigger-performance harness
 * ---------------------------------------------------------------------------
 * A self-contained stand-in for PixieBrix's `jQueryInitialize` selector watcher
 * (the shared MutationObserver that backs BOTH trigger and button starter
 * bricks). It lets each page reproduce a pathological DOM pattern and watch what
 * the watcher does, with NO browser extension required.
 *
 * Two modes mirror pre/post 3.2.6 behavior:
 *
 *   legacy     - one MutationObserver per selector, full attribute observation,
 *                a leading+trailing throttled full-document querySelectorAll AND
 *                a per-added-node match, no IGNORE_TAGS filter, no visibility
 *                pause, no detached-subtree skip. This is the slow path that
 *                locks up / crashes on the pathological pages.
 *
 *   optimized  - one shared MutationObserver, attributeFilter: ['id','class'],
 *                an id/class token index for O(1) dispatch, trailing-only
 *                throttle, requestIdleCallback burst flush for huge batches,
 *                IGNORE_TAGS filter, visibilitychange pause, isConnected skip.
 *
 *   off        - no watcher at all (baseline: just the page's own workload).
 *
 * Usage from a page:
 *
 *   PBX.page({
 *     title: "...", intro: "...html...",
 *     selectors: [".storm-item"],                 // what a real mod would target
 *     tunables: [{ key: "rate", label: "Mutations/sec", def: 120, min: 1, max: 4000 }],
 *     build(root, p) {  ...create initial DOM...  },
 *     start(root, p) {  PBX.every(1000 / p.rate, () => { ...mutate root... });  },
 *   });
 *
 * Every config value lives in the URL query string, so a crashing setup is a
 * shareable link, e.g. mutation-storm.html?harness=legacy&rate=800&nodes=20000
 */
(function () {
  "use strict";

  // Tags jQueryInitialize's optimized path drops before the matcher sees them.
  const IGNORE_TAGS = new Set(["STYLE", "SCRIPT", "LINK", "META", "BR"]);
  // Direct addedNodes in one batch above this go through requestIdleCallback.
  const BURST_THRESHOLD = 512;
  // Trailing/leading throttle window, matching the ~100ms used in the watcher.
  const THROTTLE_MS = 100;

  const ric =
    window.requestIdleCallback ||
    ((cb) => setTimeout(() => cb({ timeRemaining: () => 0 }), 1));
  const cancelRic = window.cancelIdleCallback || clearTimeout;

  // ---- shared mutable state -------------------------------------------------
  const stats = {
    mutations: 0, // MutationRecords processed
    scans: 0, // querySelectorAll calls issued
    lastScanMs: 0, // duration of the most recent scan pass
    matches: 0, // selector callbacks fired (new element matches)
    queue: 0, // pending records at last callback
    frames: 0, // rAF ticks in the current second (for FPS)
    fps: 0,
    startedAt: 0,
    running: false,
  };

  let MODE = "optimized"; // off | legacy | optimized
  const timers = new Set(); // intervals registered via PBX.every
  const rafs = new Set(); // rAF ids registered via PBX.raf
  let watcher = null; // active watcher instance

  // ---- tiny URL-param layer -------------------------------------------------
  const search = new URLSearchParams(location.search);
  function rawParam(key) {
    return search.get(key);
  }
  function numParam(key, def) {
    const v = Number(rawParam(key));
    return Number.isFinite(v) && rawParam(key) !== null ? v : def;
  }

  // =========================================================================
  // Watcher implementations
  // =========================================================================

  // A registered selector + its dispatch classification.
  function classify(selector) {
    const s = selector.trim();
    if (/^#[\w-]+$/.test(s)) return { kind: "id", token: s.slice(1), selector: s };
    if (/^\.[\w-]+$/.test(s)) return { kind: "class", token: s.slice(1), selector: s };
    if (/^[a-zA-Z][\w-]*$/.test(s))
      return { kind: "tag", token: s.toUpperCase(), selector: s };
    return { kind: "complex", token: null, selector: s }; // attribute / combinator / pseudo
  }

  // We mark matched elements so the same element isn't re-counted, mirroring the
  // watcher's per-element WeakSet de-duplication.
  const SEEN = "__pbxSeen";
  function dispatch(el, entry) {
    if (el[SEEN] && el[SEEN].has(entry.selector)) return;
    (el[SEEN] || (el[SEEN] = new Set())).add(entry.selector);
    stats.matches++;
    entry.onMatch && entry.onMatch(el);
  }

  // ---------- OPTIMIZED watcher (post-3.2.6) --------------------------------
  function createOptimizedWatcher(entries) {
    const idIndex = new Map(); // id token -> [entry]
    const classIndex = new Map(); // class token -> [entry]
    const complex = []; // entries needing full evaluation
    let needsFullAttrs = false;

    for (const e of entries) {
      if (e.kind === "id") push(idIndex, e.token, e);
      else if (e.kind === "class") push(classIndex, e.token, e);
      else {
        complex.push(e);
        // Complex selectors may key off arbitrary attributes -> widen the filter.
        if (/\[/.test(e.selector)) needsFullAttrs = true;
      }
    }

    let pendingThrottle = null;
    let pendingRic = null;

    function indexedMatch(node) {
      if (node.nodeType !== 1) return;
      if (IGNORE_TAGS.has(node.tagName)) return; // IGNORE_TAGS filter
      if (!node.isConnected) return; // detached-subtree skip
      // O(1) token dispatch for the node and its subtree's id/class hits.
      if (node.id) (idIndex.get(node.id) || []).forEach((e) => dispatch(node, e));
      node.classList &&
        node.classList.forEach((c) =>
          (classIndex.get(c) || []).forEach((e) => dispatch(node, e))
        );
      const tagEntries = tagIndexLookup(node.tagName);
      tagEntries.forEach((e) => dispatch(node, e));
    }

    function tagIndexLookup(tag) {
      // Tag selectors are rare; linear scan is fine.
      return entries.filter((e) => e.kind === "tag" && e.token === tag);
    }

    // Trailing-only safety-net: one full querySelectorAll per complex selector.
    function fullSweep() {
      if (!complex.length) return;
      const t0 = performance.now();
      for (const e of complex) {
        stats.scans++;
        document.querySelectorAll(e.selector).forEach((el) => dispatch(el, e));
      }
      stats.lastScanMs = performance.now() - t0;
    }

    function scheduleTrailing() {
      if (pendingThrottle) return;
      pendingThrottle = setTimeout(() => {
        pendingThrottle = null;
        fullSweep();
      }, THROTTLE_MS);
    }

    function process(records) {
      stats.mutations += records.length;
      let directAdds = 0;
      for (const r of records) {
        if (r.type === "attributes") {
          indexedMatch(r.target);
          continue;
        }
        directAdds += r.addedNodes.length;
        for (const n of r.addedNodes) {
          if (n.nodeType !== 1) continue;
          indexedMatch(n);
          // also index descendants synchronously (cheap: id/class only)
          if (n.children && n.children.length)
            for (const c of n.querySelectorAll("[id],[class]")) indexedMatch(c);
        }
      }
      stats.queue = 0;
      // Burst-size flush: huge batches defer the complex sweep to idle time.
      if (directAdds > BURST_THRESHOLD) {
        if (pendingThrottle) {
          clearTimeout(pendingThrottle);
          pendingThrottle = null;
        }
        if (!pendingRic)
          pendingRic = ric(() => {
            pendingRic = null;
            fullSweep();
          }, { timeout: 150 });
      } else {
        scheduleTrailing();
      }
    }

    const observer = new MutationObserver((records) => process(records));
    const observeOpts = {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: needsFullAttrs ? undefined : ["id", "class"],
    };

    function connect() {
      observer.observe(document.documentElement, observeOpts);
    }
    function disconnect() {
      process(observer.takeRecords());
      observer.disconnect();
      if (pendingThrottle) clearTimeout(pendingThrottle), (pendingThrottle = null);
      if (pendingRic) cancelRic(pendingRic), (pendingRic = null);
    }

    // visibilitychange pause: stop scanning hidden tabs, sync-sweep on resume.
    function onVisibility() {
      if (document.hidden) disconnect();
      else {
        connect();
        fullSweep();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);

    connect();
    fullSweep(); // initial attach sweep
    return {
      stop() {
        disconnect();
        document.removeEventListener("visibilitychange", onVisibility);
      },
    };
  }

  // ---------- LEGACY watcher (pre-3.2.6) ------------------------------------
  function createLegacyWatcher(entries) {
    const observers = [];

    for (const e of entries) {
      let leadingDone = false;
      let trailing = null;

      // Leading+trailing throttled full-document scan (the double-fire).
      function throttledSweep() {
        if (!leadingDone) {
          leadingDone = true;
          fullScan(e); // leading edge
          setTimeout(() => (leadingDone = false), THROTTLE_MS);
        }
        if (trailing) return;
        trailing = setTimeout(() => {
          trailing = null;
          fullScan(e); // trailing edge
        }, THROTTLE_MS);
      }

      // One observer PER selector, observing ALL attributes (no filter).
      const observer = new MutationObserver((records) => {
        stats.mutations += records.length;
        stats.queue = records.length;
        for (const r of records) {
          if (r.type === "attributes") {
            legacyNodeMatch(r.target, e);
            continue;
          }
          // Per-added-node match: matches() + a subtree querySelectorAll. No
          // IGNORE_TAGS, no isConnected skip -> scans detached + junk nodes too.
          for (const n of r.addedNodes) {
            if (n.nodeType !== 1) continue;
            legacyNodeMatch(n, e);
            stats.scans++;
            n.querySelectorAll &&
              n.querySelectorAll(e.selector).forEach((el) => dispatch(el, e));
          }
        }
        throttledSweep();
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true, // every attribute, on every node
      });
      observers.push(observer);
    }

    function legacyNodeMatch(node, e) {
      try {
        if (node.matches && node.matches(e.selector)) dispatch(node, e);
      } catch (_) {
        /* invalid selector for this node */
      }
    }
    function fullScan(e) {
      const t0 = performance.now();
      stats.scans++;
      document.querySelectorAll(e.selector).forEach((el) => dispatch(el, e));
      stats.lastScanMs = performance.now() - t0;
    }

    // initial attach scan
    entries.forEach(fullScan);
    return {
      stop() {
        observers.forEach((o) => o.disconnect());
      },
    };
  }

  function push(map, key, val) {
    (map.get(key) || map.set(key, []).get(key)).push(val);
  }

  // =========================================================================
  // Readout widget + control panel
  // =========================================================================
  let els = {};
  function buildChrome(page) {
    const panel = document.createElement("div");
    panel.id = "pbx-panel";
    panel.innerHTML = `
      <style>
        #pbx-intro,#pbx-root{margin-right:312px}
        @media(max-width:780px){#pbx-intro,#pbx-root{margin-right:0}}
        #pbx-intro{padding:16px 20px;font:14px/1.5 system-ui,sans-serif;color:#1e293b;
          max-width:760px}
        #pbx-intro h1{font-size:20px;margin:0 0 6px}
        #pbx-intro code{background:#f1f5f9;padding:1px 4px;border-radius:3px;
          font:12px ui-monospace,monospace;color:#7c3aed}
        #pbx-panel{position:fixed;top:0;right:0;z-index:2147483647;width:300px;
          font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#0f172a;
          background:#f8fafc;border-left:1px solid #cbd5e1;border-bottom:1px solid #cbd5e1;
          box-shadow:0 4px 16px rgba(0,0,0,.12);max-height:100vh;overflow:auto}
        #pbx-panel h2{font-size:12px;margin:0;padding:8px 10px;background:#0f172a;color:#fff;
          font-weight:600;letter-spacing:.02em}
        #pbx-panel .pbx-sec{padding:8px 10px;border-bottom:1px solid #e2e8f0}
        #pbx-panel label{display:block;margin:6px 0 2px;color:#475569}
        #pbx-panel input,#pbx-panel select{width:100%;box-sizing:border-box;padding:3px 5px;
          border:1px solid #cbd5e1;border-radius:4px;font:inherit;background:#fff}
        #pbx-panel .pbx-row{display:flex;gap:6px;margin-top:8px}
        #pbx-panel button{flex:1;padding:6px;border:0;border-radius:4px;color:#fff;
          font:inherit;font-weight:600;cursor:pointer}
        #pbx-start{background:#16a34a}#pbx-stop{background:#dc2626}#pbx-apply{background:#2563eb}
        #pbx-panel button:disabled{opacity:.45;cursor:default}
        #pbx-stats{display:grid;grid-template-columns:1fr auto;gap:1px 8px}
        #pbx-stats b{font-weight:600;text-align:right;font-variant-numeric:tabular-nums}
        #pbx-panel .pbx-fps-bad{color:#dc2626}#pbx-panel .pbx-fps-ok{color:#16a34a}
        #pbx-panel .pbx-sel{word-break:break-all;color:#7c3aed}
        #pbx-panel a{color:#2563eb}
        #pbx-min{position:fixed;top:0;right:0;z-index:2147483647;background:#0f172a;color:#fff;
          border:0;padding:6px 9px;font:12px ui-monospace,monospace;cursor:pointer;display:none}
      </style>
      <h2>⚡ jQueryInitialize harness <span id="pbx-hide" style="float:right;cursor:pointer">▾</span></h2>
      <div class="pbx-sec" id="pbx-stats-wrap">
        <div id="pbx-stats">
          <span>FPS</span><b id="s-fps">–</b>
          <span>Mutations/sec</span><b id="s-mut">0</b>
          <span>Scans/sec</span><b id="s-scan">0</b>
          <span>Last scan (ms)</span><b id="s-ms">0</b>
          <span>Matches</span><b id="s-match">0</b>
          <span>Elapsed (s)</span><b id="s-elapsed">0</b>
        </div>
      </div>
      <div class="pbx-sec">
        <label>Watcher mode</label>
        <select id="pbx-mode">
          <option value="off">off (no watcher)</option>
          <option value="legacy">legacy (pre-3.2.6)</option>
          <option value="optimized">optimized (3.2.6)</option>
        </select>
        <div id="pbx-tunables"></div>
        <div class="pbx-row">
          <button id="pbx-start">▶ Start</button>
          <button id="pbx-stop" disabled>■ Stop</button>
        </div>
        <div class="pbx-row"><button id="pbx-apply">Apply &amp; reload</button></div>
      </div>
      <div class="pbx-sec">
        <label>Watched selector(s) — target these with a real mod:</label>
        <div class="pbx-sel">${page.selectors.map((s) => escapeHtml(s)).join("<br>")}</div>
        <p style="margin:8px 0 0"><a href="./index.html">← all scenarios</a></p>
      </div>`;
    document.body.appendChild(panel);

    const min = document.createElement("button");
    min.id = "pbx-min";
    min.textContent = "⚡ harness ▸";
    document.body.appendChild(min);
    panel.querySelector("#pbx-hide").onclick = () => {
      panel.style.display = "none";
      min.style.display = "block";
    };
    min.onclick = () => {
      panel.style.display = "block";
      min.style.display = "none";
    };

    // tunable inputs
    const tWrap = panel.querySelector("#pbx-tunables");
    for (const t of page.tunables) {
      const id = "pbx-t-" + t.key;
      const cur = page.params[t.key];
      if (t.options) {
        tWrap.insertAdjacentHTML(
          "beforeend",
          `<label>${t.label}</label><select id="${id}">${t.options
            .map(
              (o) =>
                `<option value="${o}"${o == cur ? " selected" : ""}>${o}</option>`
            )
            .join("")}</select>`
        );
      } else {
        tWrap.insertAdjacentHTML(
          "beforeend",
          `<label>${t.label}</label><input id="${id}" type="number" value="${cur}"${
            t.min != null ? ` min="${t.min}"` : ""
          }${t.max != null ? ` max="${t.max}"` : ""}>`
        );
      }
    }

    const modeSel = panel.querySelector("#pbx-mode");
    modeSel.value = MODE;
    modeSel.onchange = () => {
      MODE = modeSel.value;
      rebuildWatcher(page);
    };

    els = {
      fps: panel.querySelector("#s-fps"),
      mut: panel.querySelector("#s-mut"),
      scan: panel.querySelector("#s-scan"),
      ms: panel.querySelector("#s-ms"),
      match: panel.querySelector("#s-match"),
      elapsed: panel.querySelector("#s-elapsed"),
      start: panel.querySelector("#pbx-start"),
      stop: panel.querySelector("#pbx-stop"),
    };
    els.start.onclick = () => startWorkload(page);
    els.stop.onclick = () => stopWorkload();
    panel.querySelector("#pbx-apply").onclick = () => applyAndReload(page);
  }

  function applyAndReload(page) {
    const next = new URLSearchParams(location.search);
    next.set("harness", document.querySelector("#pbx-mode").value);
    for (const t of page.tunables) {
      const inp = document.querySelector("#pbx-t-" + t.key);
      if (inp) next.set(t.key, inp.value);
    }
    next.set("autostart", "1");
    location.search = next.toString();
  }

  // =========================================================================
  // Workload + watcher lifecycle
  // =========================================================================
  let currentPage = null;

  function rebuildWatcher(page) {
    if (watcher) {
      watcher.stop();
      watcher = null;
    }
    if (MODE === "off") return;
    const entries = page.selectors.map((s) => {
      const c = classify(s);
      c.onMatch = null;
      return c;
    });
    watcher = MODE === "legacy" ? createLegacyWatcher(entries) : createOptimizedWatcher(entries);
  }

  function startWorkload(page) {
    if (stats.running) return;
    stats.running = true;
    stats.startedAt = performance.now();
    els.start.disabled = true;
    els.stop.disabled = false;
    rebuildWatcher(page);
    page.start && page.start(page.root, page.params);
  }

  function stopWorkload() {
    stats.running = false;
    timers.forEach(clearInterval);
    timers.clear();
    rafs.forEach((id) => cancelAnimationFrame(id));
    rafs.clear();
    els.start.disabled = false;
    els.stop.disabled = true;
  }

  // FPS + stats refresh loop (independent of the workload; freezes visibly when
  // the main thread is locked by the legacy watcher).
  let lastSecond = performance.now();
  let lastMut = 0,
    lastScan = 0;
  function statsLoop() {
    stats.frames++;
    const now = performance.now();
    if (now - lastSecond >= 1000) {
      stats.fps = stats.frames;
      stats.frames = 0;
      lastSecond = now;
      const mps = stats.mutations - lastMut;
      const sps = stats.scans - lastScan;
      lastMut = stats.mutations;
      lastScan = stats.scans;
      if (els.fps) {
        els.fps.textContent = stats.fps;
        els.fps.className = stats.fps < 30 ? "pbx-fps-bad" : "pbx-fps-ok";
        els.mut.textContent = mps;
        els.scan.textContent = sps;
        els.ms.textContent = stats.lastScanMs.toFixed(1);
        els.match.textContent = stats.matches.toLocaleString();
        els.elapsed.textContent = stats.running
          ? ((now - stats.startedAt) / 1000).toFixed(0)
          : "0";
      }
    }
    requestAnimationFrame(statsLoop);
  }

  // =========================================================================
  // Public API
  // =========================================================================
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  const PBX = {
    /** Register an interval that Stop() will clear. */
    every(ms, fn) {
      const id = setInterval(fn, ms);
      timers.add(id);
      return id;
    },
    /** ~60Hz batched workload tick (setInterval-backed, Stop() clears it).
     *  Preferred over raf() for stress workloads: deterministic and unaffected
     *  by frame-production throttling. */
    frame(fn) {
      const id = setInterval(fn, 16);
      timers.add(id);
      return id;
    },
    /** Register a self-rescheduling rAF loop that Stop() will cancel. */
    raf(fn) {
      const tick = () => {
        if (!stats.running) return;
        fn();
        const id = requestAnimationFrame(tick);
        rafs.add(id);
      };
      const id = requestAnimationFrame(tick);
      rafs.add(id);
    },
    /** Schedule a microtask-batched add-then-remove (detached-subtree page). */
    microtask(fn) {
      Promise.resolve().then(fn);
    },
    stats,

    /** Entry point each page calls exactly once. */
    page(def) {
      MODE = rawParam("harness") || "optimized";
      const params = {};
      for (const t of def.tunables || []) {
        params[t.key] = t.options ? rawParam(t.key) || t.def : numParam(t.key, t.def);
      }
      def.params = params;

      const boot = () => {
        // page content root the workload mutates
        const root = document.createElement("div");
        root.id = "pbx-root";
        document.body.appendChild(root);
        def.root = root;
        currentPage = def;

        if (def.intro) {
          const intro = document.createElement("div");
          intro.id = "pbx-intro";
          intro.innerHTML = def.intro;
          document.body.insertBefore(intro, root);
        }
        buildChrome(def);
        def.build && def.build(root, params);
        requestAnimationFrame(statsLoop);
        if (rawParam("autostart") === "1") startWorkload(def);
      };
      if (document.readyState === "loading")
        document.addEventListener("DOMContentLoaded", boot);
      else boot();
    },
  };

  window.PBX = PBX;
})();
