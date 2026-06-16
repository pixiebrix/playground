// React infinite scroll: a growing list reconciled by React on every burst. With
// keep=0 the list grows without bound (memory pressure). Watched selector: .feed-row.
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { makeCtl, useDriver } from "./bridge";

declare const PBX: any;

function InfiniteScroll({ params, ctl }: { params: any; ctl: any }) {
  const running = useDriver(ctl);
  const [rows, setRows] = useState<number[]>([]);
  const seq = useRef(0);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setRows((prev) => {
        const add = Array.from({ length: params.burst }, () => seq.current++);
        let next = prev.concat(add);
        if (params.keep > 0 && next.length > params.keep) {
          next = next.slice(next.length - params.keep);
        }
        return next;
      });
    }, params.interval);
    return () => clearInterval(id);
  }, [running, params]);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  });

  return (
    <div className="scroll-container" ref={feedRef}>
      {rows.map((r) => (
        <div key={r} className="feed-row">
          <b>#{r}</b> Lorem ipsum dolor sit amet, consectetur.
        </div>
      ))}
    </div>
  );
}

const ctl = makeCtl();
PBX.page({
  title: "React infinite scroll",
  intro: `
    <h1>React infinite scroll</h1>
    <p>A React list that appends <code>.feed-row</code> nodes in bursts on a timer — the
    feed pattern. Set <code>keep</code> to 0 for unbounded growth (memory pressure → the
    crash class). React reconciles the whole list each burst. Exercises the
    <strong>burst-size <code>requestIdleCallback</code> flush (PR #8170)</strong>.</p>
    <p><strong>Try it:</strong> <code>burst</code> 1000, <code>interval</code> 200,
    <code>keep</code> 0, mode <code>legacy</code>, Start.</p>
    <p>Target selector for a real mod: <code>.feed-row</code></p>`,
  selectors: [".feed-row"],
  tunables: [
    { key: "burst", label: "Rows per burst", def: 400, min: 1, max: 10000 },
    { key: "interval", label: "Burst every (ms)", def: 250, min: 16, max: 5000 },
    { key: "keep", label: "Max rows (0 = unbounded)", def: 4000, min: 0, max: 200000 },
  ],
  build(root: HTMLElement, p: any) {
    createRoot(root).render(<InfiniteScroll params={p} ctl={ctl} />);
  },
  start() {
    ctl.start();
  },
  stop() {
    ctl.stop();
  },
});
