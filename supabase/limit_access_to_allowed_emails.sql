-- Limit browser/Supabase access to the two approved email accounts.
-- The worker uses the service_role key and is not blocked by these authenticated-user policies.

drop policy if exists "authenticated settings" on public.post_yt_vido_automation_settings;
create policy "authenticated settings" on public.post_yt_vido_automation_settings
  for all to authenticated
  using (
    lower(coalesce(auth.jwt() ->> 'email', '')) in (
      'mrwisemikeyt@gmail.com',
      'ahmedzuhairyoutube@gmail.com'
    )
  )
  with check (
    lower(coalesce(auth.jwt() ->> 'email', '')) in (
      'mrwisemikeyt@gmail.com',
      'ahmedzuhairyoutube@gmail.com'
    )
  );

drop policy if exists "authenticated videos" on public.post_yt_vido_automation_videos;
create policy "authenticated videos" on public.post_yt_vido_automation_videos
  for all to authenticated
  using (
    lower(coalesce(auth.jwt() ->> 'email', '')) in (
      'mrwisemikeyt@gmail.com',
      'ahmedzuhairyoutube@gmail.com'
    )
  )
  with check (
    lower(coalesce(auth.jwt() ->> 'email', '')) in (
      'mrwisemikeyt@gmail.com',
      'ahmedzuhairyoutube@gmail.com'
    )
  );
