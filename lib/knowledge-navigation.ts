export function fuzzyDocumentScore(query: string, value: string) {
  const needle = query.normalize("NFC").toLowerCase().replace(/\s/g, "").slice(0, 120);
  const haystack = value.normalize("NFC").toLowerCase();
  if (!needle) return 0;
  if (haystack === needle) return 10000;
  const exact = haystack.indexOf(needle);
  if (exact >= 0) return 5000 - exact;
  let previous = -1; let gaps = 0;
  for (const char of needle) {
    const next = haystack.indexOf(char, previous + 1);
    if (next < 0) return -1;
    gaps += next - previous - 1; previous = next;
  }
  return 1000 / (1 + gaps);
}
