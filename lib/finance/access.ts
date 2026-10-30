/** UI gate only. Future finance API endpoints must independently enforce RLS. */
export function canAccessFinance(
  profile: { role: string; isActive?: boolean; financeAccess?: boolean } | null,
) {
  return (
    profile?.isActive === true &&
    (profile.role === "admin" || profile.financeAccess === true)
  );
}

/** 카드지출·정기 결제 (2026-10-30): every active member enters their own card use; the rest stays with finance access. */
export const STAFF_FINANCE_MENUS = ["/finance/cards", "/finance/recurring"];
/** What the staff screens read, and the only two they may change (DB policies and os_fin_commit enforce the same). */
export const STAFF_FINANCE_READ = ["settings", "cards", "card_transactions", "card_rules", "recurring_overrides"];
export const STAFF_FINANCE_WRITE = ["card_transactions", "recurring_overrides"];
/** A staff member may only classify a card use, write its purpose or attach a receipt; amounts and dates stay as imported. */
export const STAFF_CARD_FIELDS = ["manual_category", "manual_biz", "manual_vat", "memo"];
