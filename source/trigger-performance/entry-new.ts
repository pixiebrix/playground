// Exposes the real 3.2.6 jQueryInitialize as window.PBXVendor.optimized.
import initialize from "./vendor/new/jQueryInitialize";

declare global {
  interface Window {
    PBXVendor?: Record<string, unknown>;
  }
}

const g = (window.PBXVendor ||= {});
g.optimized = initialize;
g.optimizedVersion = "3.2.6";
