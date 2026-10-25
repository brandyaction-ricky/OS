// Sales rounds (판매 회차), found from payments alone so nobody has to register cohorts.
// Payments are grouped by product (the Toss order name). A product's payments form one round
// until sales pause for RUN_GAP_DAYS; a round longer than RUN_MAX_DAYS (an always-on product)
// is cut by calendar month instead. People may add split days for a product, name a round,
// set targets and course dates; those settings anchor to the round containing their start day.
export const RUN_GAP_DAYS = 14;
export const RUN_MAX_DAYS = 60;

export type RunPayment = { product: string; day: string; amount: number; canceled: number };
export type SalesRun = { key: string; product: string; from: string; to: string; net: number; paid: number; canceled: number; count: number; canceledCount: number };

const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / 86_400_000;

function summarize(product: string, rows: RunPayment[]): SalesRun {
  const paid = rows.reduce((sum, row) => sum + row.amount, 0), canceled = rows.reduce((sum, row) => sum + row.canceled, 0);
  return { key: `${product}::${rows[0].day}`, product, from: rows[0].day, to: rows.at(-1)!.day, net: paid - canceled, paid, canceled,
    count: rows.length, canceledCount: rows.filter(row => row.canceled > 0).length };
}

export function salesRuns(payments: RunPayment[], splits: Record<string, string[]> = {}) {
  const byProduct = new Map<string, RunPayment[]>();
  for (const payment of payments) {
    const product = payment.product.trim() || "(상품명 없음)";
    byProduct.set(product, [...(byProduct.get(product) ?? []), { ...payment, product }]);
  }
  const runs: SalesRun[] = [];
  for (const [product, rows] of byProduct) {
    rows.sort((a, b) => a.day.localeCompare(b.day));
    const cuts = new Set(splits[product] ?? []);
    let current: RunPayment[] = [];
    const flush = () => {
      if (!current.length) return;
      // An always-on product: one round per calendar month instead of one endless round.
      if (dayNumber(current.at(-1)!.day) - dayNumber(current[0].day) > RUN_MAX_DAYS) {
        const months = new Map<string, RunPayment[]>();
        for (const row of current) months.set(row.day.slice(0, 7), [...(months.get(row.day.slice(0, 7)) ?? []), row]);
        for (const monthRows of months.values()) runs.push(summarize(product, monthRows));
      } else runs.push(summarize(product, current));
      current = [];
    };
    for (const row of rows) {
      const last = current.at(-1);
      if (last && (dayNumber(row.day) - dayNumber(last.day) >= RUN_GAP_DAYS || [...cuts].some(cut => last.day < cut && cut <= row.day))) flush();
      current.push(row);
    }
    flush();
  }
  return runs.sort((a, b) => b.from.localeCompare(a.from) || a.product.localeCompare(b.product));
}

// The rounds a meeting looks at: still selling (sold within the gap), or whose course has not
// ended; otherwise the latest round.
export function activeRuns<T extends { to: string; from: string; courseTo?: string | null }>(runs: T[], today: string) {
  const live = runs.filter(run => (run.courseTo && run.courseTo >= today) || dayNumber(today) - dayNumber(run.to) < RUN_GAP_DAYS);
  return live.length ? live : [...runs].sort((a, b) => b.from.localeCompare(a.from)).slice(0, 1);
}
