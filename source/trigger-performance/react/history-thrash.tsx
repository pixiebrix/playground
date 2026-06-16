// React history / URL thrash. A large React tree is rendered once and then never
// changes; the app only syncs a counter into the URL on a timer (the everyday
// "store scroll position / active filter in the URL" pattern). A pure URL change
// fires no DOM mutation, so legacy never wakes — but the route-change re-sweep
// (#8202) schedules a full-document $safeFind in a bare rAF per URL change,
// bypassing the throttle. optimized is therefore WORSE than legacy here.
// Watched selector: .route-active .pii (ancestor-gated masking pattern).
import { useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { makeCtl, useDriver } from "./bridge";

declare const PBX: any;

// A static list, memoized on `nodes` so the URL-thrash driver never re-renders it —
// the DOM is genuinely frozen after mount, exactly like the vanilla page.
function StaticPanel({ nodes }: { nodes: number }) {
  const kids = useMemo(() => {
    const out = [];
    for (let i = 0; i < nodes; i++) {
      out.push(<div key={i} className={i % 4 === 0 ? "pii" : "filler"} />);
    }
    return out;
  }, [nodes]);
  return <div className="route-active panel">{kids}</div>;
}

function HistoryThrash({ params, ctl }: { params: any; ctl: any }) {
  const running = useDriver(ctl);

  useEffect(() => {
    if (!running) return;
    let counter = 0;
    const id = setInterval(() => {
      counter++;
      // Unique fragment each tick so routeChange's same-URL dedup never fires.
      // No React state changes and no DOM mutation — the route-change re-sweep is
      // the only thing that can wake the optimized watcher.
      if (params.via === "hash") {
        location.hash = "pos" + counter;
      } else {
        history.replaceState(null, "", "#pos=" + counter);
      }
    }, 1000 / params.rate);
    return () => clearInterval(id);
  }, [running, params]);

  return (
    <div>
      <div className="url-note">
        {params.nodes.toLocaleString()} static React nodes. The DOM never changes after
        mount — only the URL does.
      </div>
      <StaticPanel nodes={params.nodes} />
    </div>
  );
}

const ctl = makeCtl();
PBX.page({
  title: "React history / URL thrash",
  intro: `
    <h1>React history / URL thrash</h1>
    <p>A large React tree rendered <strong>once</strong> and then frozen — no node or attribute
    mutations. The app only syncs a counter into the URL on a timer (the
    <code>history.replaceState</code>-on-scroll / filter-sync pattern). The list is memoized so
    the URL updates never re-render it.</p>
    <p>This is the scenario where <strong>optimized is <em>worse</em> than legacy</strong>: a pure
    URL change fires no DOM mutation, so the pre-3.2.6 watcher never wakes, but the
    <strong>route-change re-sweep (PR #8202, Tier 1S)</strong> schedules a full-document
    <code>$safeFind</code> in a bare <code>requestAnimationFrame</code> per URL change, bypassing
    the throttle and the <code>requestIdleCallback</code> wrap.</p>
    <p><strong>Try it:</strong> mode <code>optimized</code>, <code>rate</code> 60,
    <code>nodes</code> 40000 — long-tasks climb with the page idle. <code>legacy</code> /
    <code>off</code> stay flat. (<code>via=replaceState</code> uses Chrome's Navigation API;
    <code>via=hash</code> fires <code>hashchange</code> everywhere.)</p>
    <p>Watched selector for a real mod: <code>.route-active .pii</code></p>`,
  selectors: [".route-active .pii"],
  tunables: [
    { key: "nodes", label: "Static DOM size (reload)", def: 40000, min: 100, max: 200000 },
    { key: "rate", label: "URL updates / sec", def: 60, min: 1, max: 240 },
    { key: "via", label: "URL update method", def: "replaceState",
      options: ["replaceState", "hash"] },
  ],
  build(root: HTMLElement, p: any) {
    createRoot(root).render(<HistoryThrash params={p} ctl={ctl} />);
  },
  start() {
    ctl.start();
  },
  stop() {
    ctl.stop();
  },
});
