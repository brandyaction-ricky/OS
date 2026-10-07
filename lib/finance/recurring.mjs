/** Conservative suggestions only: never creates or cancels a provider subscription. */
export function recurringCandidates(records) {
  const groups = new Map();
  for (const record of records.filter((r) => r.krw > 0 && !r.canceled)) {
    const key = record.merchant
      .toUpperCase()
      .replace(/[.,]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const group = groups.get(key) || [];
    group.push(record);
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter((rows) => {
      const months = new Map();
      for (const r of rows)
        months.set(
          r.date.slice(0, 7),
          (months.get(r.date.slice(0, 7)) || 0) + 1,
        );
      if (months.size < 2 || [...months.values()].some((n) => n !== 1))
        return false;
      const dates = rows.map((r) => Number(r.date.slice(8)));
      const amounts = rows.map((r) => (r.cur ? r.fx : r.krw));
      return (
        rows.every((r) => r.cur === rows[0].cur) &&
        Math.max(...dates) - Math.min(...dates) <= 3 &&
        Math.max(...amounts) <= Math.min(...amounts) * 1.15
      );
    })
    .map((rows) => ({
      merchant: rows.at(-1).merchant,
      records: [...rows].sort((a, b) => a.date.localeCompare(b.date)),
    }));
}
