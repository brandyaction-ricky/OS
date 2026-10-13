/** Read-only projections consumed by hrBadges, never an editable workspace. */
export const HR_BADGE_COLUMNS = {
  profiles: "id,person_kind,is_shared_account",
  credits: "id,hr_employee_id,kind,days,entry_date,period_start,period_end,source",
  requests: "id,hr_employee_id,start_date,end_date,days,deducts,status",
  promotions: "id,hr_employee_id,period_start,step,sent_at,reply_at,reply_days",
  documents: "id,hr_employee_id,doc_kind,status",
} as const;
