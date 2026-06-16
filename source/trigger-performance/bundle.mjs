// Bundles two kinds of browser IIFEs:
//   vendor/ - the two real jQueryInitialize implementations (pre-3.2.6 + 3.2.6),
//             with jQuery injected as the `$` global the source expects.
//   react/  - the React-port scenario apps (render their pathological DOM through
//             real React / react-router, watched by the vendored watcher above).
import { mkdirSync, readdirSync } from "node:fs";
import esbuild from "esbuild";

const outDir = process.argv[2] || "../../public/trigger-performance/vendor";
const reactOutDir = `${outDir}/../react`;
mkdirSync(outDir, { recursive: true });
mkdirSync(reactOutDir, { recursive: true });

// ---- vendored real jQueryInitialize bundles -------------------------------
const vendorCommon = {
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  inject: ["./vendor/jquery-shim.ts"],
  legalComments: "none",
  logLevel: "info",
};
await esbuild.build({
  ...vendorCommon,
  entryPoints: ["entry-old.ts"],
  outfile: `${outDir}/jqi-old.js`,
});
await esbuild.build({
  ...vendorCommon,
  entryPoints: ["entry-new.ts"],
  outfile: `${outDir}/jqi-new.js`,
});
console.log(`Bundled jqi-old.js + jqi-new.js into ${outDir}`);

// ---- React-port scenario apps ---------------------------------------------
const reactEntries = readdirSync("react").filter((f) => f.endsWith(".tsx"));
if (reactEntries.length) {
  await esbuild.build({
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    legalComments: "none",
    logLevel: "info",
    entryPoints: reactEntries.map((f) => `react/${f}`),
    outdir: reactOutDir,
  });
  console.log(`Bundled ${reactEntries.length} React app(s) into ${reactOutDir}`);
}
