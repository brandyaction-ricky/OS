// Numbers in a formatted value ("1,234", "4.7%", "₩12,300 / 8"), with their grouping and decimals.
const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
export const parseNumbers = (text: string) => [...text.matchAll(NUMBER)].map((match) => Number(match[0].replaceAll(",", "")));

/** `text` with its numbers at `from + (to - from) * t`, written the way `text` writes them. */
export function countText(text: string, from: number[], t: number) {
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
