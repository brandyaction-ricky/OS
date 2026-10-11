import type { OsMember } from "./api-client";
import type { SessionProfile } from "./types";

export interface VaultMemberOption {
  value: string;
  name: string;
}

// Keep the account ID as the filter value. Names are presentation only and never
// determine document ownership, including when two people share a display name.
export function vaultMemberOptions(members: OsMember[], profile: SessionProfile | null): VaultMemberOption[] {
  if (!profile) return [];
  const ownMember = members.find((member) => member.id === profile.id);
  const ownName = ownMember?.display_name?.trim() || ownMember?.legal_name?.trim() || profile.displayName.trim();
  const others = members
    .filter((member) => member.id !== profile.id && member.is_active && !member.is_shared_account && member.account_connected !== false)
    .map((member) => ({ value: `member:${member.id}`, name: member.display_name?.trim() || member.legal_name?.trim() || "" }))
    .filter((member) => member.name);
  const unique = [...new Map(others.map((member) => [member.value, member])).values()];
  unique.sort((left, right) => left.name.localeCompare(right.name, "ko") || left.value.localeCompare(right.value));
  return [{ value: "mine", name: ownName || "내 계정" }, ...unique];
}
