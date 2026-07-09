# YouTube Long‑Form Automation

Drop 3 files in a Google Drive folder, pick a time in the web app, click one button — the system writes the SEO metadata, uploads + schedules the video (private until publish time), sets the thumbnail, uploads captions, cleans up Drive, and pings you on Telegram at each stage.

## How to post a video

1. Export from Premiere and put **exactly 3 files** in your Drive drop folder:
   - `<Exact YouTube Title>.mp4` — the filename **is** the video's title.
   - `<Exact YouTube Title>.png` — the thumbnail.
   - `Transcript.srt` — captions + timestamps (any `.srt` name works).
2. In the web app: pick a **target day + time (Eastern Time)** at least ~3 hours out, click **Process & Schedule Video**.
3. Watch Telegram:
   - `Video is processing to upload with title of …`
   - `Video is uploaded successfully and waiting for the target time to post with title of …`
   - `Video is posted successfully with title of …` (at publish time, once it's confirmed live)

That's it. The Drive files are deleted **only after** a confirmed successful upload, leaving the folder empty for your next video.

## What's automated

- Reads the Drive folder; **title = the `.mp4` filename**.
- **Claude API** turns the `.srt` into an SEO description, video‑specific tags, and chapters (built from the `.srt` timestamps).
- **Final tags** = your saved channel tags + Claude's tags (guided by your 3 sample tag sets), deduped, channel‑prioritized, trimmed to YouTube's 500‑char limit.
- **Final description** = Claude's description + chapters + your saved footer, trimmed to 5000 chars.
- **YouTube Data API v3:** upload as *private* with `publishAt` = your chosen time (auto‑publishes then), set thumbnail, upload the `.srt` as a caption track.
- **Supabase** records every video (queued → processing → scheduled → posted / failed).

## Architecture

```
Browser (GitHub Pages, static)                 GitHub Actions (free)
  ├─ magic-link login (Supabase Auth)          ├─ process-video.yml  (button-triggered)
  ├─ Settings  ──────────► Supabase  ◄──────────┤    reads Drive → Claude → YouTube → Telegram (msg 1 & 2)
  └─ "Process & Schedule" ─► INSERT videos      └─ check-live.yml     (cron */15)
                              │                       detects go-live → Telegram (msg 3)
                              ▼ (DB trigger, pg_net)
                    GitHub repository_dispatch ─► process-video.yml
```

- Secrets live in **GitHub Actions secrets** (workers) and one locked **`app_config`** row in Supabase (the trigger's GitHub token). The public web page holds only the Supabase URL + anon key.

## Files

| Path | What |
|---|---|
| `index.html`, `styles.css`, `js/` | The static web app (GitHub Pages). |
| `supabase/schema.sql` | Tables, row‑level security, and the button→GitHub trigger. |
| `.github/workflows/process-video.yml` | Worker 1: upload + schedule (messages 1 & 2). |
| `.github/workflows/check-live.yml` | Worker 2: 15‑min cron, detects go‑live (message 3). |
| `worker/` | Node.js code both workers run. |
| `SETUP.md` | The one‑time setup checklist. **Start here.** |

## Rules enforced

- Eastern Time with DST handled (`America/New_York`).
- Target time rejected if in the past or < ~3 hours out (YouTube needs processing time) — enforced in the browser **and** re‑checked in the worker.
- No playlists.
- Drive files are never deleted unless the upload is confirmed.
- Total tags ≤ 500 characters.
