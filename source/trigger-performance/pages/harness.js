/*
 * trigger-performance harness
 * ---------------------------------------------------------------------------
 * Drives the REAL, vendored PixieBrix `jQueryInitialize` selector watcher (the
 * shared MutationObserver behind both trigger and button starter bricks) against
 * a pathological DOM pattern — no browser extension required.
 *
 * Two real implementations are bundled (see ../vendor + build.sh) and exposed on
 * window.PBXVendor:
 *
 *   legacy     -> window.PBXVendor.legacy      (real, pre-3.2.6)
 *   optimized  -> window.PBXVendor.optimized   (real, 3.2.6 perf overhaul)
 *   off        -> no watcher (baseline: just the page's own workload)
 *
 * Both expose the same entry point used here:
 *   initialize(selector, (index, element) => void, { target: document })
 *
 * Because the watcher is now a black box, the readout reports the signals that
 * actually indicate a hang/crash: live FPS, long-tasks/sec and the longest task
 * (main-thread blocking), plus the callback match count and live DOM size.
 *
 * Usage from a page is unchanged:
 *
 *   PBX.page({
 *     title: "...", intro: "...html...",
 *     selectors: [".storm-item"],
 *     tunables: [{ key: "rate", label: "Mutations/sec", def: 120, min: 1, max: 4000 }],
 *     build(root, p) {  ...create initial DOM...  },
 *     start(root, p) {  PBX.frame(() => { ...mutate root... });  },
 *   });
 *
 * Every config value lives in the URL query string, so a crashing setup is a
 * shareable link, e.g. mutation-storm.html?harness=legacy&rate=800&nodes=20000
 */
(function () {
  "use strict";

  // ---- shared mutable state -------------------------------------------------
  const stats = {
    matches: 0, // watcher callback invocations
    frames: 0, // rAF ticks in the current second (for FPS)
    fps: 0,
    longTasks: 0, // longtasks in the current second
    maxTaskMs: 0, // longest task in the current second
    domNodes: 0,
    startedAt: 0,
    running: false,
  };

  let MODE = "optimized"; // off | legacy | optimized
  const timers = new Set(); // intervals registered via PBX.every / PBX.frame
  const rafs = new Set(); // rAF ids registered via PBX.raf
  let watcherObservers = []; // MutationObservers returned by initialize()
  let activePage = null; // the page def passed to PBX.page()

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
  // Real watcher lifecycle
  // =========================================================================
  function vendorFor(mode) {
    return window.PBXVendor && window.PBXVendor[mode];
  }
  function vendorVersion(mode) {
    const v = window.PBXVendor;
    if (!v) return "?";
    return mode === "legacy" ? v.legacyVersion : mode === "optimized" ? v.optimizedVersion : "—";
  }

  function attachWatcher(page) {
    teardownWatcher();
    if (MODE === "off") return;
    const initialize = vendorFor(MODE);
    if (typeof initialize !== "function") {
      console.warn(`[harness] window.PBXVendor.${MODE} is not available`);
      return;
    }
    watcherObservers = page.selectors
      .map((selector) => {
        try {
          return initialize(
            selector,
            () => {
              stats.matches++;
            },
            { target: document }
          );
        } catch (error) {
          console.error(`[harness] initialize() failed for "${selector}"`, error);
          return null;
        }
      })
      .filter(Boolean);
  }

  function teardownWatcher() {
    for (const o of watcherObservers) {
      try {
        o.disconnect();
      } catch (_) {
        /* shared observer may already be gone */
      }
    }
    watcherObservers = [];
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
        #pbx-panel .bad{color:#dc2626}#pbx-panel .ok{color:#16a34a}
        #pbx-panel .pbx-sel{word-break:break-all;color:#7c3aed}
        #pbx-engine{font-size:11px;color:#475569;margin-top:4px}
        #pbx-engine b{color:#0f172a}
        #pbx-warn{color:#b45309;margin-top:6px;display:none}
        #pbx-panel a{color:#2563eb}
        #pbx-min{position:fixed;top:0;right:0;z-index:2147483647;background:#0f172a;color:#fff;
          border:0;padding:6px 9px;font:12px ui-monospace,monospace;cursor:pointer;display:none}
      </style>
      <h2>⚡ real jQueryInitialize <span id="pbx-hide" style="float:right;cursor:pointer">▾</span></h2>
      <div class="pbx-sec">
        <div id="pbx-stats">
          <span>FPS</span><b id="s-fps">–</b>
          <span>Long tasks / sec</span><b id="s-lt">0</b>
          <span>Max task (ms)</span><b id="s-mt">0</b>
          <span>Matches</span><b id="s-match">0</b>
          <span>DOM nodes</span><b id="s-dom">0</b>
          <span>Elapsed (s)</span><b id="s-elapsed">0</b>
        </div>
      </div>
      <div class="pbx-sec">
        <label>Watcher (real vendored code)</label>
        <select id="pbx-mode">
          <option value="off">off (no watcher)</option>
          <option value="legacy">legacy — real pre-3.2.6</option>
          <option value="optimized">optimized — real 3.2.6</option>
        </select>
        <div id="pbx-engine"></div>
        <div id="pbx-warn">⚠ vendored bundle not found — run build.sh and serve from <code>public/</code></div>
        <div id="pbx-tunables"></div>
        <div class="pbx-row">
          <button id="pbx-start">▶ Start</button>
          <button id="pbx-stop" disabled>■ Stop</button>
        </div>
        <div class="pbx-row"><button id="pbx-apply">Apply &amp; reload</button></div>
      </div>
      <div class="pbx-sec">
        <label>Watched selector(s) — target these with a real mod:</label>
        <div class="pbx-sel">${page.selectors.slice(0, 12).map((s) => escapeHtml(s)).join("<br>")}${
      page.selectors.length > 12 ? "<br>… +" + (page.selectors.length - 12) + " more" : ""
    }</div>
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
            .map((o) => `<option value="${o}"${o == cur ? " selected" : ""}>${o}</option>`)
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
    modeSel.onchange = () => setModeAndReload(modeSel.value);

    // engine / missing-bundle indicator
    const engine = panel.querySelector("#pbx-engine");
    if (MODE === "off") {
      engine.innerHTML = "watcher disabled";
    } else if (typeof vendorFor(MODE) === "function") {
      engine.innerHTML = `running <b>${MODE}</b> — jQueryInitialize <b>${escapeHtml(
        String(vendorVersion(MODE))
      )}</b>`;
    } else {
      engine.innerHTML = `<b>${MODE}</b> selected`;
      panel.querySelector("#pbx-warn").style.display = "block";
    }

    els = {
      fps: panel.querySelector("#s-fps"),
      lt: panel.querySelector("#s-lt"),
      mt: panel.querySelector("#s-mt"),
      match: panel.querySelector("#s-match"),
      dom: panel.querySelector("#s-dom"),
      elapsed: panel.querySelector("#s-elapsed"),
      start: panel.querySelector("#pbx-start"),
      stop: panel.querySelector("#pbx-stop"),
      root: page.root,
    };
    els.start.onclick = () => startWorkload(page);
    els.stop.onclick = () => stopWorkload();
    panel.querySelector("#pbx-apply").onclick = () => applyAndReload(page);
  }

  function setModeAndReload(mode) {
    const next = new URLSearchParams(location.search);
    next.set("harness", mode);
    location.search = next.toString();
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
  // Workload lifecycle
  // =========================================================================
  function startWorkload(page) {
    if (stats.running) return;
    stats.running = true;
    stats.startedAt = performance.now();
    els.start.disabled = true;
    els.stop.disabled = false;
    page.start && page.start(page.root, page.params);
  }

  function stopWorkload() {
    stats.running = false;
    // Let the page tear down its own loop (e.g. a React render driver) first.
    if (activePage && activePage.stop) activePage.stop(activePage.root, activePage.params);
    timers.forEach(clearInterval);
    timers.clear();
    rafs.forEach((id) => cancelAnimationFrame(id));
    rafs.clear();
    els.start.disabled = false;
    els.stop.disabled = true;
  }

  // ---- long-task observer (main-thread blocking) ----------------------------
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        stats.longTasks++;
        if (e.duration > stats.maxTaskMs) stats.maxTaskMs = e.duration;
      }
    });
    po.observe({ entryTypes: ["longtask"] });
  } catch (_) {
    /* longtask not supported (e.g. Firefox) — FPS still reflects jank */
  }

  // ---- FPS + stats refresh loop (freezes visibly when the thread is locked) --
  let lastSecond = performance.now();
  function statsLoop() {
    stats.frames++;
    const now = performance.now();
    if (now - lastSecond >= 1000) {
      stats.fps = stats.frames;
      stats.frames = 0;
      lastSecond = now;
      if (els.fps) {
        els.fps.textContent = stats.fps;
        els.fps.className = stats.fps < 30 ? "bad" : "ok";
        els.lt.textContent = stats.longTasks;
        els.lt.className = stats.longTasks > 0 ? "bad" : "ok";
        els.mt.textContent = stats.maxTaskMs.toFixed(0);
        els.match.textContent = stats.matches.toLocaleString();
        stats.domNodes = els.root ? els.root.getElementsByTagName("*").length : 0;
        els.dom.textContent = stats.domNodes.toLocaleString();
        els.elapsed.textContent = stats.running ? ((now - stats.startedAt) / 1000).toFixed(0) : "0";
      }
      stats.longTasks = 0;
      stats.maxTaskMs = 0;
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
        activePage = def;
        const root = document.createElement("div");
        root.id = "pbx-root";
        document.body.appendChild(root);
        def.root = root;

        if (def.intro) {
          const intro = document.createElement("div");
          intro.id = "pbx-intro";
          intro.innerHTML = def.intro;
          document.body.insertBefore(intro, root);
        }
        buildChrome(def);
        def.build && def.build(root, params);
        // Attach the real watcher against the initial DOM (measures attach cost).
        attachWatcher(def);
        requestAnimationFrame(statsLoop);
        if (rawParam("autostart") === "1") startWorkload(def);
      };
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
      else boot();
    },
  };

  window.PBX = PBX;
})();
