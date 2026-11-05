/**
 * 편집 화면 이식 ② (2026-11-05): the page the editor screen's frame shows — the screen's own index.html with its scripts put inline
 * (the frame has no address of its own to load them from), and before them the OS's rules for it: it may run its scripts and the OS
 * bridge, show pictures, video and sound from OS storage, and reach nothing else. The settings it kept (zoom, hints seen) come with it.
 */
export function editorScreenDoc(files: Record<string, string>, input: { origin: string; storage: string; store: Record<string, string> }) {
  const index = files["index.html"];
  if (!index) return null;
  const inline = index.replace(/<script\s+src="([a-z][a-z0-9_-]*\.js)(?:\?[^"]*)?"\s*><\/script>/g,
    (_, name: string) => files[name] ? `<script>${files[name].replace(/<\/script/gi, "<\\/script")}</script>` : "");
  const storage = new URL(input.storage).origin;
  const rules = [`default-src 'none'`, `script-src 'unsafe-inline' ${input.origin}`, `style-src 'unsafe-inline' https://cdn.jsdelivr.net`,
    `font-src https://cdn.jsdelivr.net data:`, `img-src ${storage} blob: data:`, `media-src ${storage} blob:`, `connect-src ${storage}`].join("; ");
  const head = `<meta http-equiv="Content-Security-Policy" content="${rules}">`
    + `<script>window.__osEditorStore=${JSON.stringify(input.store).replace(/</g, "\\u003c")}</script>`
    + `<script src="${input.origin}/editor-screen-shim.js"></script>`;
  return /<head[^>]*>/i.test(inline) ? inline.replace(/<head[^>]*>/i, (tag) => tag + head) : head + inline;
}
