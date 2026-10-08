/** UI gate only. Future finance API endpoints must independently enforce RLS. */
export function canAccessFinance(
  profile: { role: string; isActive?: boolean; financeAccess?: boolean } | null,
) {
  return (
    profile?.isActive === true &&
    (profile.role === "admin" || profile.financeAccess === true)
  );
}
