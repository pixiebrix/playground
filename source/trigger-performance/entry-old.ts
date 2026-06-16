// Exposes the real pre-3.2.6 jQueryInitialize as window.PBXVendor.legacy.
import initialize from "./vendor/old/jQueryInitialize";

declare global {
  interface Window {
    PBXVendor?: Record<string, unknown>;
  }
}

const g = (window.PBXVendor ||= {});
g.legacy = initialize;
g.legacyVersion = "pre-3.2.6";
