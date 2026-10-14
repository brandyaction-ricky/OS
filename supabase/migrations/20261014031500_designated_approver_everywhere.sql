-- The explicitly assigned approver (설정 › 회사 › 승인자) manages company canonical documents alone.
-- 20261013060000 let them decide proposals on their own documents and own-AI drafts, but the other
-- approval checks (naming them as approver when proposing, review -> reviewed, candidate decisions)
-- still excluded the author and document owner, so the sole approver could not propose to themselves.
-- One shared rule now: os_can_approve is true for the designated approver; everyone else, admins
-- acting as fallback approvers and delegates included, keeps the author/owner exclusion.
-- Not changed: submitting a new canonical candidate to oneself (table check requested_approver_id <>
-- submitted_by) and the separate-publisher rule. The function below is the 2026-10-14 Production
-- definition (identical on DEV) with only that condition added. Privileges are kept.

CREATE OR REPLACE FUNCTION public.os_can_approve(p_actor uuid, p_author uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.os_is_designated_approver(p_actor) or coalesce(
    p_actor is not null
    and p_actor is distinct from p_author
    and exists (
      select 1 from public.os_profiles actor
      where actor.id = p_actor and actor.is_active
    )
    and (
      exists (
        select 1 from public.os_approval_assignments approval
        where approval.user_id = p_actor and approval.kind = 'approver'
          and approval.revoked_at is null
          and (approval.starts_on is null or approval.starts_on <= current_date)
          and (approval.ends_on is null or approval.ends_on >= current_date)
      )
      or (
        not exists (
          select 1 from public.os_approval_assignments approval
          join public.os_profiles approver_profile on approver_profile.id = approval.user_id and approver_profile.is_active
          where approval.kind = 'approver' and approval.revoked_at is null
            and (approval.starts_on is null or approval.starts_on <= current_date)
            and (approval.ends_on is null or approval.ends_on >= current_date)
        )
        and exists (
          select 1 from public.os_profiles actor
          where actor.id = p_actor and actor.role = 'admin' and actor.is_active
        )
      )
      or exists (
        select 1 from public.os_approval_assignments delegation
        join public.os_profiles delegator on delegator.id = delegation.delegated_by
        where delegation.kind = 'delegate' and delegation.user_id = p_actor
          and delegation.revoked_at is null and current_date between delegation.starts_on and delegation.ends_on
          and delegator.is_active
          and (
            exists (
              select 1 from public.os_approval_assignments approval
              where approval.kind = 'approver' and approval.user_id = delegation.delegated_by
                and approval.revoked_at is null
                and (approval.starts_on is null or approval.starts_on <= current_date)
                and (approval.ends_on is null or approval.ends_on >= current_date)
            )
            or (
              delegator.role = 'admin'
              and not exists (
                select 1 from public.os_approval_assignments approval
                join public.os_profiles approver_profile on approver_profile.id = approval.user_id and approver_profile.is_active
                where approval.kind = 'approver' and approval.revoked_at is null
                  and (approval.starts_on is null or approval.starts_on <= current_date)
                  and (approval.ends_on is null or approval.ends_on >= current_date)
              )
            )
          )
      )
    ), false
  );
$function$;
