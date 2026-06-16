// React portal churn: rapidly mount/unmount a portal subtree of .portal-content
// nodes — the modal/tooltip pattern. Each tick changes the portal child key, so
// React unmounts the previous batch and mounts a fresh one (high add/remove churn).
//
// Note: unlike the vanilla `detached-subtree` page (which adds + removes within one
// task so the node is never connected), React commits the mount and unmount in
// separate commits, so portal nodes briefly connect. This stresses add/remove
// throughput and the watcher's handling rather than strictly the isConnected=false
// fast-path (PR #8170) — see the vanilla page for that exact case.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { makeCtl, useDriver, perTick } from "./bridge";

declare const PBX: any;

function PortalChurn({ params, ctl }: { params: any; ctl: any }) {
  const running = useDriver(ctl);
  const [stage, setStage] = useState<HTMLElement | null>(null);
  const [batch, setBatch] = useState(0);

  useEffect(() => {
    if (!running) return;
    const n = perTick(params.rate);
    const id = setInterval(() => setBatch((b) => b + n), 16);
    return () => clearInterval(id);
  }, [running, params]);

  return (
    <div>
      <div className="stage" ref={setStage}>
        Portal subtrees mount / unmount here.
      </div>
      {stage &&
        createPortal(
          <div key={batch}>
            {Array.from({ length: params.size }, (_, i) => (
              <span key={i} className="portal-content">
                .
              </span>
            ))}
          </div>,
          stage,
        )}
    </div>
  );
}

const ctl = makeCtl();
PBX.page({
  title: "React portal churn",
  intro: `
    <h1>React portal churn</h1>
    <p>Rapidly mounts and unmounts a React <code>createPortal</code> subtree of
    <code>.portal-content</code> nodes — the modal / tooltip pattern. Each tick swaps the
    portal child key, so React unmounts the previous batch and mounts a fresh one,
    producing heavy add/remove mutation churn for the watcher to process.</p>
    <p><em>Note:</em> React commits the mount and unmount separately, so these nodes
    briefly connect — for the strict add-then-remove-in-one-task (never-connected) case
    that the <strong>isConnected fast-path (PR #8170)</strong> targets, see the vanilla
    <code>detached-subtree</code> page.</p>
    <p>Target selector for a real mod: <code>.portal-content</code></p>`,
  selectors: [".portal-content"],
  tunables: [
    { key: "rate", label: "Mount/unmount cycles / sec", def: 200, min: 1, max: 6000 },
    { key: "size", label: "Nodes per subtree", def: 50, min: 1, max: 2000 },
  ],
  build(root: HTMLElement, p: any) {
    createRoot(root).render(<PortalChurn params={p} ctl={ctl} />);
  },
  start() {
    ctl.start();
  },
  stop() {
    ctl.stop();
  },
});
