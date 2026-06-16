// Shared glue between the React scenario apps and the harness (window.PBX).
//
// The harness may call start() before React has mounted (e.g. ?autostart=1 runs
// synchronously right after build()), so the controller records the *desired*
// running state and the mounted component applies it once its effect runs.
import { useEffect, useState } from "react";

export type Ctl = {
  _want: boolean;
  _apply: null | (() => void);
  start(): void;
  stop(): void;
};

export function makeCtl(): Ctl {
  const c = { _want: false, _apply: null } as Ctl;
  c.start = () => {
    c._want = true;
    c._apply && c._apply();
  };
  c.stop = () => {
    c._want = false;
    c._apply && c._apply();
  };
  return c;
}

/** Returns the harness-driven running flag, honoring a start() that fired before mount. */
export function useDriver(ctl: Ctl): boolean {
  const [running, setRunning] = useState(false);
  useEffect(() => {
    ctl._apply = () => setRunning(ctl._want);
    ctl._apply();
    return () => {
      ctl._apply = null;
    };
  }, [ctl]);
  return running;
}

/** ~60Hz batch size for a given per-second rate. */
export function perTick(rate: number): number {
  return Math.max(1, Math.round(rate / 60));
}
