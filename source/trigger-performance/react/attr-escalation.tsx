// React attribute-mode escalation. A pool of React-rendered .benign-item nodes is
// animated by writing inline style imperatively via a ref each frame — the idiomatic
// performance pattern for high-frequency animation in React (no per-frame setState).
// The DOM tree is stable; only the style attribute churns. A benign pure-class trigger
// asks for attributeMode "none", so the shared observer ignores it entirely. Add ONE
// [data-state] mod (poison=1) and the shared observer (#8207) escalates to unfiltered
// attributes:true for the whole document, flooding every subscriber.
import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { makeCtl, useDriver, perTick } from "./bridge";

declare const PBX: any;

const POISON = (new URLSearchParams(location.search).get("poison") || "1") === "1";
const SELECTORS = POISON ? [".benign-item", '[data-state="open"]'] : [".benign-item"];

function AttrEscalation({ params, ctl }: { params: any; ctl: any }) {
  const running = useDriver(ctl);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!running || !gridRef.current) return;
    const items = gridRef.current.children;
    let n = 0;
    const perFrame = perTick(params.rate);
    const id = setInterval(() => {
      for (let i = 0; i < perFrame; i++) {
        const el = items[(Math.random() * items.length) | 0] as HTMLElement;
        if (!el) continue;
        const mode =
          params.attr === "mixed" ? ["style", "aria", "data"][n % 3] : params.attr;
        // Imperative ref writes — React stays out of the per-frame path, so this
        // isolates the watcher cost (real apps animate this way for perf).
        if (mode === "style") {
          el.style.transform = "translateX(" + (n % 7) + "px)";
        } else if (mode === "aria") {
          el.setAttribute("aria-valuenow", String(n % 100));
        } else {
          el.setAttribute("data-tick", String(n));
        }
        n++;
      }
    }, 16);
    return () => clearInterval(id);
  }, [running, params]);

  // Rendered once; the per-frame churn never touches React state.
  const items = [];
  for (let i = 0; i < params.nodes; i++) {
    items.push(<div key={i} className="benign-item" />);
  }
  return (
    <div className="grid" ref={gridRef}>
      {items}
    </div>
  );
}

const ctl = makeCtl();
PBX.page({
  title: "React attribute-mode escalation",
  intro: `
    <h1>React attribute-mode escalation (one selector poisons the document)</h1>
    <p>A pool of React-rendered <code>.benign-item</code> nodes whose inline
    <code>style.transform</code> is rewritten every frame via a <strong>ref</strong> — the
    idiomatic way to do high-frequency animation in React (no per-frame <code>setState</code>).
    The tree is stable; only the <code>style</code> attribute churns. A trigger watching the
    pure class <code>.benign-item</code> asks for <code>attributeMode: "none"</code>, so the
    shared observer never sees the animation.</p>
    <p>Add <strong>one</strong> unrelated <code>[data-state="open"]</code> mod
    (<code>poison=1</code>, default): it forces <code>attributeMode: "full"</code>, and because
    the document's observer is <strong>shared</strong> (PR #8207) that escalates it to unfiltered
    <code>attributes: true</code> for everyone. Every per-frame <code>style</code> write now wakes
    the observer even though the selector is about <code>data-state</code>.</p>
    <p><strong>Try it:</strong> <code>poison=1</code>, mode <code>optimized</code>,
    <code>rate</code> 1800 — long-tasks appear; flip <code>poison=0</code> (remove the one
    attribute selector) and the same workload drops to ~idle.</p>
    <p>Watched selector(s): <code>${SELECTORS.join("</code>, <code>").replace(/"/g, "&quot;")}</code></p>`,
  selectors: SELECTORS,
  tunables: [
    { key: "poison", label: "Include [data-state] mod (reload)", def: "1", options: ["1", "0"] },
    { key: "attr", label: "Churned attribute", def: "style",
      options: ["style", "aria", "data", "mixed"] },
    { key: "nodes", label: "Animated node pool", def: 6000, min: 10, max: 60000 },
    { key: "rate", label: "Attribute writes / sec", def: 1800, min: 1, max: 12000 },
  ],
  build(root: HTMLElement, p: any) {
    createRoot(root).render(<AttrEscalation params={p} ctl={ctl} />);
  },
  start() {
    ctl.start();
  },
  stop() {
    ctl.stop();
  },
});
