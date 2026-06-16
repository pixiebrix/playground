// Provides the `$` / `jQuery` globals the vendored source expects. esbuild's
// `--inject` auto-imports these wherever the bundled code references `$` or
// `jQuery` as a free identifier. Pinned to jQuery 3.x because the watcher uses
// `$.find.tokenize` (Sizzle), which jQuery 4 removed.
import jQuery from "jquery";

export const $ = jQuery;
export { jQuery };
