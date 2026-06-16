// Minimal vendored stand-in for pixiebrix-source's `domUtils.$safeFind`, which
// pulls in a large util tree we don't need for the demo. `$safeFind` is the only
// export the watcher uses; behavior matches the real one for valid selectors.
// `$` is supplied by esbuild `--inject` (see ../jquery-shim.ts).
export function $safeFind(
  selector: string,
  parent: Document | HTMLElement | JQuery<HTMLElement | Document> = document,
): JQuery<HTMLElement> {
  return $(parent as never).find(selector);
}
