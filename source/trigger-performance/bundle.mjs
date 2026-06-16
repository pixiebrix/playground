// Bundles the two vendored jQueryInitialize implementations (real pre-3.2.6 and
// real 3.2.6) into standalone browser IIFEs that assign window.PBXVendor.{legacy,
// optimized}. jQuery is injected as the `$` global the source expects.
import { mkdirSync } from "node:fs";
import esbuild from "esbuild";

const outDir = process.argv[2] || "../../public/trigger-performance/vendor";
mkdirSync(outDir, { recursive: true });

const common = {
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  inject: ["./vendor/jquery-shim.ts"],
  legalComments: "none",
  logLevel: "info",
};

await esbuild.build({
  ...common,
  entryPoints: ["entry-old.ts"],
  outfile: `${outDir}/jqi-old.js`,
});
await esbuild.build({
  ...common,
  entryPoints: ["entry-new.ts"],
  outfile: `${outDir}/jqi-new.js`,
});

console.log(`Bundled jqi-old.js + jqi-new.js into ${outDir}`);
