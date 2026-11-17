-- 음성 시작 알림 (2026-11-17): a voice that waited for the render PC tells its owner when it starts — one more notification reason,
-- yt_voice_start, written by the server as its recipient like the other 유튜브 공정 reasons. Additive: the guard as it is deployed
-- is read and only the new reason is added next to yt_upload in both of its lists; run again it changes nothing.
begin;

do $$
declare
  def text := pg_get_functiondef('public.os_notification_guard()'::regprocedure);
begin
  if position('''yt_voice_start''' in def) > 0 then return; end if;
  if (length(def) - length(replace(def, '''yt_upload''', ''))) / length('''yt_upload''') <> 2 then
    raise exception 'os_notification_guard has no two yt_upload lists to extend; not changed';
  end if;
  execute replace(def, '''yt_upload''', '''yt_upload'',''yt_voice_start''');
end $$;

commit;
