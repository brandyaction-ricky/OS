-- Manual undo of 20261113100000_finance_purchase_invoices.sql. Saved 매입 계산서 rows go with the table (they can be
-- uploaded again from the 홈택스 files); nothing else references it. Afterwards the API answers "not ready" again and
-- 부가세 참고 자료 shows the sales side only.
begin;

drop table if exists public.os_fin_purchase_invoices;

commit;
