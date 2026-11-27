// 성과·재무 숫자 (2026-11-25): figures run up to their value when they arrive. Plain JS so the finance controller can use it too.

// Numbers in a formatted value ("1,234", "4.7%", "1.23억 원", "₩12,300 / 8"), with their grouping and decimals.
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
export const parseNumbers = (text) => [...text.matchAll(NUMBER)].map((match) => Number(match[0].replaceAll(",", "")));

/** `text` with its numbers at `from + (to - from) * t`, written the way `text` writes them. */
export function countText(text, from, t) {
  let index = 0;
  return text.replace(NUMBER, (raw) => {
    const to = Number(raw.replaceAll(",", "")), start = from[index++] ?? 0;
    const decimals = raw.split(".")[1]?.length ?? 0, value = start + (to - start) * t;
    const fixed = (decimals ? value : Math.round(value)).toFixed(decimals);
    if (!raw.includes(",")) return fixed;
    const [whole, part] = fixed.split(".");
    return Number(whole).toLocaleString("en-US") + (part ? `.${part}` : "");
  });
}

export const ease = (t) => 1 - (1 - t) ** 3;
export const RUN_MS = 700;

/**
 * For HTML a script writes itself (the finance controller): run every figure under `root` matching `selector` up to its value.
 * `memory` keeps what each figure (by `keyOf(element)`) showed last, so a redraw only runs figures that changed, from their old value;
 * a figure seen for the first time runs from 0. Text nodes are changed in place; nothing else in the element is touched.
 */
export function runFigures(root, selector, memory, keyOf) {
  if (!root?.querySelectorAll || typeof requestAnimationFrame !== "function") return;
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const runs = [];
  root.querySelectorAll(selector).forEach((element, index) => {
    const key = keyOf(element, index), walker = element.ownerDocument.createTreeWalker(element, 4 /* text */);
    const nodes = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (/\d/.test(node.nodeValue)) nodes.push({ node, text: node.nodeValue, to: parseNumbers(node.nodeValue) });
    const now = nodes.map((item) => item.to), before = memory.get(key);
    memory.set(key, now);
    if (reduced || !nodes.length || JSON.stringify(now) === JSON.stringify(before)) return;
    nodes.forEach((item, i) => { item.from = before?.[i] ?? []; item.node.nodeValue = countText(item.text, item.from, 0); runs.push(item); });
  });
  if (!runs.length) return;
  let start = 0;
  const step = (time) => {
    start ||= time;
    const t = Math.min(1, (time - start) / RUN_MS);
    for (const item of runs) if (item.node.isConnected) item.node.nodeValue = t < 1 ? countText(item.text, item.from, ease(t)) : item.text;
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
