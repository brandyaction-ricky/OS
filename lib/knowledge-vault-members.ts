import type { OsMember } from "./api-client";
import type { SessionProfile } from "./types";
import { COMPANY_ROSTER, memberMatchesRoster } from "./company-roster.ts";

export interface VaultMemberOption {
  value: string;
  name: string;
}

function rosterName(member: { display_name?: string | null; legal_name?: string | null; email?: string | null }) {
  const match = COMPANY_ROSTER.find((person) => memberMatchesRoster(member, person.name) || member.legal_name?.trim() === person.name);
  if (match) return match.name;
  // The founder's login uses the Latin spelling of the name shown in the team directory.
  const accountName = `${member.display_name ?? ""} ${member.email?.split("@")[0] ?? ""}`.toLowerCase();
  return /(^|[^a-z])ricky/.test(accountName) ? "리키" : "";
}

// Keep the account ID as the filter value. Names are presentation only and never
// determine document ownership, including when two people share a display name.
export function vaultMemberOptions(members: OsMember[], profile: SessionProfile | null, includeDemoMembers = false): VaultMemberOption[] {
  if (!profile) return [];
  const ownMember = members.find((member) => member.id === profile.id);
  const ownName = (ownMember && rosterName(ownMember)) || rosterName({ display_name: profile.displayName, email: profile.email }) || "내 계정";
  const others = members
    .filter((member) => member.id !== profile.id && member.is_active && !member.is_shared_account && member.account_connected !== false)
    .map((member) => ({ value: `member:${member.id}`, name: rosterName(member) || (includeDemoMembers ? member.display_name?.trim() : "") }))
    .filter((member) => member.name);
  const unique = [...new Map(others.map((member) => [member.value, member])).values()];
  unique.sort((left, right) => left.name.localeCompare(right.name, "ko") || left.value.localeCompare(right.value));
  return [{ value: "mine", name: ownName || "내 계정" }, ...unique];
}
