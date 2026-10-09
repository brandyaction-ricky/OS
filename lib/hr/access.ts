export function canAccessHr(
  profile: { role: string; isActive?: boolean; financeAccess?: boolean } | null,
) {
  return (
    profile?.isActive === true &&
    (profile.role === "admin" || profile.financeAccess === true)
  );
}
