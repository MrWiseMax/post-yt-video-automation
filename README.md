# YouTube Long-Form Automation

Drop 3 files in a Google Drive folder, pick a time in the web app, click one button. The system writes SEO metadata, uploads and schedules the video as private until publish time, sets the thumbnail, uploads English captions, and pings you on Telegram.

## How to post a video

1. Export from Premiere and put **exactly 3 files** in your Drive drop folder:
   - `<Exact YouTube Title>.mp4` - the filename **is** the video's title.
   - `<Exact YouTube Title>.png` - the thumbnail.
   - `Transcript.srt` - English captions + timestamps. Any `.srt` filename works.
2. In the web app: pick a **target day + time (Jakarta time, WIB)** at least about 3 hours out, click **Process & Schedule Video**.
3. Watch Telegram:
   - `⏰ Video uploaded successfully and scheduled to post: ...`
   - `✅ Video is now live: ...` once it is confirmed public, followed by the comment on its own
     so it can be copied in one go.
   - `❌ Upload failed ...` only if something went wrong.

That's it. **The Drive files are never deleted** — nothing is removed from your folder. Replace them with the next video's files before scheduling again; if you forget, the worker refuses the job instead of re-uploading the same video.

## What's Automated

- Reads the Drive folder; **title = the `.mp4` filename**.
- **Claude API** turns the `.srt` into an SEO description, video-specific tags, and chapters built from the `.srt` timestamps.
- Metadata is framed as **How-To** content.
- **Final tags** = video-specific tags Claude derived from *this* video's `.srt`, plus your channel tags, deduped and trimmed to YouTube's 500-character limit. Channel tags are capped at ~180 characters so a long channel-tag list can never crowd out the video's own topic (they used to consume the entire budget, which made every upload share one identical tag set).
- **Final description** = Claude's description + chapters + your saved footer, trimmed to 5000 characters.
- **First comment** = the question you ask the viewer at the end of the video (Claude pulls it out of the `.srt`) followed by a fixed sign-off. It is sent to you on Telegram when the video goes public; posting and pinning it is manual, because the Data API cannot pin a comment. Edit the sign-off in `COMMENT_SIGNATURE` in `worker/src/process.js`.
- **YouTube Data API v3:** uploads as *private* with `publishAt` = your chosen time, uses category **Education** (`27`), answers the Studio "AI use" disclosure with **No**, sets thumbnail (auto-shrunk to fit YouTube's 2 MB limit), and uploads the `.srt` as an English caption track.
- **Checked against YouTube whenever the page loads.** Opening the web app asks Supabase to fire
  the worker, which copies publish times down (they are changed in Studio, so YouTube is the source
  of truth), removes videos cancelled before they ever published, and marks ones deleted after they
  were live as **deleted** rather than dropping them. The run takes about a minute; the list picks
  the result up on its own and then stops. If *every* video comes back missing at once nothing is
  changed — that pattern means a credentials or API problem, not deletions.
- **Go-live detection runs on its own, every 15 minutes**, whether or not the web app is open — a
  video usually publishes while nobody is looking, and that Telegram is the reminder to go and post
  the comment. Supabase pg_cron fires it, because GitHub's own schedule is best effort and was seen
  firing once every 2-5 hours. These runs *only* watch for videos going public; publish times and
  deleted videos are still reconciled only when you open the app.
- **Supabase** records every video: queued -> processing -> scheduled -> posted / failed.

### Settings the YouTube API cannot set (do these once per video in Studio)

The YouTube Data API does not expose these Studio options, so set them manually after the upload is scheduled (Studio -> Content -> the video):

| Setting | Wanted value | Why manual |
|---|---|---|
| Ads / monetization | ON | Monetization is only available through YouTube's partner-facing Content ID API for CMS accounts, not the public Data API. |
| Allow automatic concepts | Unchecked | Studio-only experiment feature; no API field. |
| Learning content Type | How-To | The Education "Type/Problems/Level/Exam" fields are Studio-only learning metadata; no API field. |
| Academic system | None | Same Studio-only learning metadata. |

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
| `.github/workflows/check-live.yml` | Worker 2: 15-minute cron. Syncs publish times from YouTube, detects go-live, message 3. |
| `worker/` | Node.js code both workers run. |
| `SETUP.md` | The one-time setup checklist. Start here. |

## Rules Enforced

- Times are entered in Jakarta time (`Asia/Jakarta`, WIB / UTC+7) and converted to UTC before storage. Change `TIMEZONE` + `TIMEZONE_LABEL` in `js/config.js` to move to another zone; the conversion handles DST for zones that have it.
- Target time rejected if in the past or less than about 3 hours out. This is checked in the browser and again in the worker.
- Upload category is always Education.
- Captions are always English.
- Only the two allowlisted emails can use the browser app and authenticated Supabase rows.
- No playlists.
- Drive files are never deleted or modified; clearing the drop folder is manual.
- The same video title can never be uploaded twice.
- Total tags are kept at 500 characters or less.
