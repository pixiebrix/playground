// React render storm: rapid setState drives reconciliation churn that React
// flushes to the DOM as adds/removes/attribute changes — the real-app version of
// mutation-storm. Watched selector: .storm-item.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { makeCtl, useDriver, perTick } from "./bridge";

declare const PBX: any;

type Item = { id: number; hot: boolean };

function RenderStorm({ params, ctl }: { params: any; ctl: any }) {
  const running = useDriver(ctl);
  const [items, setItems] = useState<Item[]>(() =>
    Array.from({ length: params.nodes }, (_, i) => ({ id: i, hot: false })),
  );

  useEffect(() => {
    if (!running) return;
    let seq = params.nodes;
    const n = perTick(params.rate);
    const id = setInterval(() => {
      setItems((prev) => {
        const next = prev.slice();
        for (let k = 0; k < n; k++) {
          const idx = (Math.random() * next.length) | 0;
          if (params.mode === "remount") {
            // New key -> React unmounts the old node and mounts a new one.
            next[idx] = { id: seq++, hot: false };
          } else {
            // Same key -> React patches the class attribute in place.
            next[idx] = { id: next[idx].id, hot: !next[idx].hot };
          }
        }
        return next;
      });
    }, 16);
    return () => clearInterval(id);
  }, [running, params]);

  return (
    <div className="rs-grid">
      {items.map((it) => (
        <div key={it.id} className={"storm-item" + (it.hot ? " hot" : "")}>
          {it.id}
        </div>
      ))}
    </div>
  );
}

const ctl = makeCtl();
PBX.page({
  title: "React render storm",
  intro: `
    <h1>React render storm</h1>
    <p>A React component tree of <code>.storm-item</code> nodes is churned by rapid
    <code>setState</code> calls — the real-app version of <code>mutation-storm</code>.
    In <code>remount</code> mode each tick swaps item keys, so React unmounts + mounts
    real DOM nodes (add/remove mutations); in <code>attr</code> mode it patches classes
    in place. Stresses the watcher's throttle and <code>visibilitychange</code> pause
    (<strong>PR #8170</strong>) against genuine React commits.</p>
    <p><strong>Try it:</strong> mode <code>legacy</code>, <code>rate</code> 2000+,
    <code>nodes</code> 20000, Start — watch FPS / long-tasks. Compare <code>optimized</code>.</p>
    <p>Target selector for a real mod: <code>.storm-item</code></p>`,
  selectors: [".storm-item"],
  tunables: [
    { key: "rate", label: "Re-renders / sec", def: 240, min: 1, max: 8000 },
    { key: "nodes", label: "Item count", def: 3000, min: 10, max: 60000 },
    { key: "mode", label: "Churn mode", def: "remount", options: ["remount", "attr"] },
  ],
  build(root: HTMLElement, p: any) {
    createRoot(root).render(<RenderStorm params={p} ctl={ctl} />);
  },
  start() {
    ctl.start();
  },
  stop() {
    ctl.stop();
  },
});
