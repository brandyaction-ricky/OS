-- 쇼츠 컨펌 (owner request 2026-10-25): the 대표 confirms the shorts scripts of a longform before they are made and uploaded.
-- The confirmation history keeps that gate like the other three. Additive: the check only widens; existing rows are unchanged.
alter table public.os_youtube_confirmations drop constraint if exists os_youtube_confirmations_gate_check;
alter table public.os_youtube_confirmations add constraint os_youtube_confirmations_gate_check check (gate in ('topic', 'draft', 'review', 'shorts'));
