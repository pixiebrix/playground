// React Router route swap: navigating mounts a fresh large subtree and unmounts
// the previous one in one commit — the canonical "5k-node React route swap". Uses
// HashRouter so navigation fires hashchange (which routeChange.ts listens for) with
// no server rewrite. Watched selector: .route-active .pii (ancestor-gated).
import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  HashRouter,
  Routes,
  Route,
  useNavigate,
  useParams,
} from "react-router-dom";
import { makeCtl, useDriver } from "./bridge";

declare const PBX: any;

function RouteView({ siblings }: { siblings: number }) {
  const { n = "0" } = useParams();
  const kids = [];
  for (let i = 0; i < siblings; i++) {
    kids.push(<div key={i} className={i % 4 === 0 ? "pii" : "filler"} />);
  }
  // key={n} forces the whole subtree to remount on each navigation -> bulk swap.
  return (
    <div className="route-active" key={n}>
      <div className="route-status">
        route {n} — {siblings} nodes ({Math.ceil(siblings / 4)} .pii)
      </div>
      {kids}
    </div>
  );
}

function Driver({ params, ctl }: { params: any; ctl: any }) {
  const nav = useNavigate();
  const counter = useRef(0);
  const running = useDriver(ctl);
  const swap = () => {
    counter.current++;
    nav("/route/" + counter.current);
  };
  useEffect(() => {
    if (!running || params.interval <= 0) return;
    const id = setInterval(swap, params.interval);
    return () => clearInterval(id);
  }, [running, params]);

  return (
    <>
      <button className="rs-btn" onClick={swap}>
        ▸ Swap route now
      </button>
      <Routes>
        <Route path="/" element={<RouteView siblings={params.siblings} />} />
        <Route path="/route/:n" element={<RouteView siblings={params.siblings} />} />
      </Routes>
    </>
  );
}

const ctl = makeCtl();
PBX.page({
  title: "React Router route swap",
  intro: `
    <h1>React Router route swap</h1>
    <p>A real <code>react-router-dom</code> (HashRouter) app. Each navigation unmounts
    the current route's subtree and mounts a new one of <code>siblings</code> nodes in a
    single commit — many of them <code>.pii</code> gated on an ancestor class
    (<code>.route-active .pii</code>), the masking pattern triggers use. Navigation fires
    <code>hashchange</code>, which the watcher's route-change re-sweep listens for.
    Exercises the <strong>burst-size flush (PR #8170)</strong> and
    <strong>route re-sweep (PR #8202)</strong> against real router commits.</p>
    <p><strong>Try it:</strong> keep <code>siblings</code> &gt; 512, set
    <code>interval</code> to auto-navigate, compare <code>legacy</code> vs
    <code>optimized</code>.</p>
    <p>Target selector for a real mod: <code>.route-active .pii</code></p>`,
  selectors: [".route-active .pii"],
  tunables: [
    { key: "siblings", label: "Siblings per route", def: 800, min: 10, max: 20000 },
    { key: "interval", label: "Auto-swap every (ms, 0=off)", def: 0, min: 0, max: 10000 },
  ],
  build(root: HTMLElement, p: any) {
    createRoot(root).render(
      <HashRouter>
        <Driver params={p} ctl={ctl} />
      </HashRouter>,
    );
  },
  start() {
    ctl.start();
  },
  stop() {
    ctl.stop();
  },
});
