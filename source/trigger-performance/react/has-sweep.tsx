// React :has() sweep amplifier. A large React-rendered grid of .card nodes whose
// .active state is toggled by setState at a light rate — genuine React commits, but
// the page's own work is small. The damage is the watched selector: with sel=has the
// trigger watches `.card:has(.badge.active)`, a complex selector the token index
// (#8207) can't fast-path, so every trailing sweep runs a full-document Sizzle :has.
// Watched selector: see ?sel= (has | compound | single).
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { makeCtl, useDriver, perTick } from "./bridge";

declare const PBX: any;

const SEL_MODE = new URLSearchParams(location.search).get("sel") || "has";
const SELECTORS: Record<string, string> = {
  has: ".card:has(.badge.active)",
  compound: ".card.active",
  single: ".active",
};
const SELECTOR = SELECTORS[SEL_MODE] || SELECTORS.has;

function HasSweep({ params, ctl }: { params: any; ctl: any }) {
  const running = useDriver(ctl);
  // One boolean per card; both the card and its badge get `.active` so the
  // workload is identical across all three sel= shapes — only the watched
  // selector (and thus the sweep cost) differs between runs.
  const [active, setActive] = useState<boolean[]>(() =>
    new Array(params.cards).fill(false),
  );

  useEffect(() => {
    if (!running) return;
    const n = perTick(params.rate);
    const id = setInterval(() => {
      setActive((prev) => {
        const next = prev.slice();
        for (let k = 0; k < n; k++) {
          const i = (Math.random() * next.length) | 0;
          next[i] = !next[i];
        }
        return next;
      });
    }, 1000 / Math.min(params.rate, 60));
    return () => clearInterval(id);
  }, [running, params]);

  return (
    <div className="grid">
      {active.map((on, i) => (
        <div key={i} className={on ? "card active" : "card"}>
          <img />
          <span className={on ? "badge active" : "badge"} />
        </div>
      ))}
    </div>
  );
}

const ctl = makeCtl();
PBX.page({
  title: "React :has() sweep amplifier",
  intro: `
    <h1>React :has() sweep amplifier</h1>
    <p>A large React grid of <code>.card</code> nodes (each with an <code>img</code> +
    <code>.badge</code>). React reconciles the list on each light <code>setState</code> toggle —
    real commits — but the page's own work stays small. The cost lives in the
    <em>watched selector</em>: with <code>sel=has</code> the trigger watches
    <code>.card:has(.badge.active)</code>, which the <strong>token index (PR #8207)</strong>
    can't fast-path (it's complex), so every ~100ms trailing sweep runs a full-document
    Sizzle <code>:has</code> scan. <strong>optimized stays slow</strong> — the scan itself is
    the cost.</p>
    <p><strong>Try it:</strong> with <code>sel=has</code>, raise <code>cards</code> and watch
    long-tasks in both legacy and optimized; flip <code>sel</code> to <code>compound</code> /
    <code>single</code> (same workload) to watch the watcher cost collapse. Compare with the
    vanilla <code>has-sweep</code> page for the non-React baseline.</p>
    <p>Watched selector (<code>sel=${SEL_MODE}</code>): <code>${SELECTOR}</code></p>`,
  selectors: [SELECTOR],
  tunables: [
    { key: "sel", label: "Watched selector shape (reload)", def: "has",
      options: ["has", "compound", "single"] },
    { key: "cards", label: "Card count (reload)", def: 5000, min: 100, max: 40000 },
    { key: "rate", label: "Class toggles / sec", def: 10, min: 1, max: 2000 },
  ],
  build(root: HTMLElement, p: any) {
    createRoot(root).render(<HasSweep params={p} ctl={ctl} />);
  },
  start() {
    ctl.start();
  },
  stop() {
    ctl.stop();
  },
});
