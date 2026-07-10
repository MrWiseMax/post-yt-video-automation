# YouTube Long-Form Automation

Drop 3 files in a Google Drive folder, pick a time in the web app, click one button. The system writes SEO metadata, uploads and schedules the video as private until publish time, sets the thumbnail, uploads English captions, cleans up Drive, and pings you on Telegram at each stage.

## How to post a video

1. Export from Premiere and put **exactly 3 files** in your Drive drop folder:
   - `<Exact YouTube Title>.mp4` - the filename **is** the video's title.
   - `<Exact YouTube Title>.png` - the thumbnail.
   - `Transcript.srt` - English captions + timestamps. Any `.srt` filename works.
2. In the web app: pick a **target day + time (Eastern Time)** at least about 3 hours out, click **Process & Schedule Video**.
3. Watch Telegram:
   - `⏰ Video uploaded successfully and scheduled to post: ...`
   - `✅ Video is now live: ...` once it is confirmed public.
   - `❌ Upload failed ...` only if something went wrong.

That's it. The Drive files are deleted **only after** a confirmed successful upload, leaving the folder empty for your next video.

## What's Automated

- Reads the Drive folder; **title = the `.mp4` filename**.
- **Claude API** turns the `.srt` into an SEO description, video-specific tags, and chapters built from the `.srt` timestamps.
- Metadata is framed as **How-To** content.
- **Final tags** = your saved channel tags + Education/How-To helper tags + Claude's tags, deduped and trimmed to YouTube's 500-character limit.
- **Final description** = Claude's description + chapters + your saved footer, trimmed to 5000 characters.
- **YouTube Data API v3:** uploads as *private* with `publishAt` = your chosen time, uses category **Education** (`27`), answers the Studio "AI use" disclosure with **No**, sets thumbnail (auto-shrunk to fit YouTube's 2 MB limit), and uploads the `.srt` as an English caption track.

### Settings the YouTube API cannot set (do these once per video in Studio)

The YouTube Data API does not expose these Studio options, so set them manually after the upload is scheduled (Studio -> Content -> the video):

| Setting | Wanted value | Why manual |
|---|---|---|
| Ads / monetization | ON | Monetization is only available through YouTube's partner-facing Content ID API for CMS accounts, not the public Data API. |
| Allow automatic concepts | Unchecked | Studio-only experiment feature; no API field. |
| Learning content Type | How-To | The Education "Type/Problems/Level/Exam" fields are Studio-only learning metadata; no API field. |
| Academic system | None | Same Studio-only learning metadata. |
- **Supabase** records every video: queued -> processing -> scheduled -> posted / failed.

## Architecture

```text
Browser (GitHub Pages, static)                 GitHub Actions
  - magic-link login (Supabase Auth)            - process-video.yml (button-triggered)
  - Settings -------------------------------> Supabase <-------------- reads Drive -> Claude -> YouTube -> Telegram
  - Process & Schedule -> INSERT post_yt_vido_automation_videos
                                      |
                                      v
                         DB trigger (pg_net)
                                      |
                                      v
                         GitHub repository_dispatch -> process-video.yml

check-live.yml runs every 15 minutes and sends the final Telegram message after YouTube confirms the video is public.
```

Secrets live in **GitHub Actions secrets** for the workers and in one locked **`post_yt_vido_automation_app_config`** row in Supabase for the database trigger's GitHub token. The public web page holds only the Supabase URL and anon key.

Browser access is limited to these emails (both accounts share the exact same app data — one settings row, one video list):
- `mrwisemikeyt@gmail.com`
- `ahmedzuhairyoutube@gmail.com`

**YouTube account isolation:** only `ahmedzuhairyoutube@gmail.com`'s OAuth refresh token (a GitHub Actions secret) ever touches the YouTube API. The web app itself never talks to YouTube, and `mrwisemikeyt@gmail.com` only signs in to Supabase — it must never be used to mint YouTube credentials.

## Files

| Path | What |
|---|---|
| `index.html`, `styles.css`, `js/` | The static web app for GitHub Pages. |
| `supabase/schema.sql` | Tables, row-level security, and the button-to-GitHub trigger. |
| `supabase/rename_tables_to_prefixed_names.sql` | One-time migration used to rename old Supabase tables to the prefixed names. |
| `.github/workflows/process-video.yml` | Worker 1: upload + schedule, messages 1 and 2. |
| `.github/workflows/check-live.yml` | Worker 2: 15-minute cron, detects go-live, message 3. |
| `worker/` | Node.js code both workers run. |
| `SETUP.md` | The one-time setup checklist. Start here. |

## Rules Enforced

- Eastern Time with DST handled (`America/New_York`).
- Target time rejected if in the past or less than about 3 hours out. This is checked in the browser and again in the worker.
- Upload category is always Education.
- Captions are always English.
- Only the two allowlisted emails can use the browser app and authenticated Supabase rows.
- No playlists.
- Drive files are never deleted unless the upload is confirmed.
- Total tags are kept at 500 characters or less.
