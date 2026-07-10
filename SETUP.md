# One-Time Setup Checklist

Do these once. After this, your only per-video work is: drop 3 files in the Drive folder, pick a time, click one button.

Legend: `VALUE_TO_COPY` means a value you will copy into a secret or setting later.

---

## 1. Google Cloud - One Project For Drive + YouTube

1. Go to <https://console.cloud.google.com/> and create a project, for example `post-yt-video-automation`.
2. **APIs & Services -> Library**: enable both:
   - **YouTube Data API v3**
   - **Google Drive API**

### 1a. Service Account For Drive

3. **APIs & Services -> Credentials -> Create credentials -> Service account**. Name it something like `drive-bot`. Skip role grants. Create.
4. Open the service account -> **Keys -> Add key -> Create new key -> JSON**. A `.json` file downloads. This whole file is `GOOGLE_SERVICE_ACCOUNT_JSON`.
5. Copy the service account email. It looks like `drive-bot@post-yt-video-automation.iam.gserviceaccount.com`.
6. Create your Drive drop folder. Share it with that service-account email as **Editor**. Editor access is required so the bot can delete files after upload. Open the folder and copy its ID from the URL:
   `drive.google.com/drive/folders/<THIS_IS_THE_ID>`

### 1b. OAuth Client For YouTube Uploads

7. **Google Auth Platform -> Branding**: set the app name to `post-yt-video-automation`, choose your support email, and save.
8. Optional but recommended on the same Branding page:
   - Application home page: `https://mrwisemax.github.io/post-yt-video-automation/`
   - Authorized domain: `github.io`
9. **Google Auth Platform -> Audience**: set Publishing status to **In production**, not Testing. Testing-mode refresh tokens can expire after 7 days.
10. **Google Auth Platform -> Clients -> Create client -> Web application**. Under **Authorized redirect URIs**, add:
    `https://developers.google.com/oauthplayground`
11. Create it, then copy:
    - `YOUTUBE_CLIENT_ID`
    - `YOUTUBE_CLIENT_SECRET`

### 1c. Get The YouTube Refresh Token

12. Open <https://developers.google.com/oauthplayground>.
13. Click the gear icon, check **Use your own OAuth credentials**, and paste your client ID + secret.
14. In the left "Input your own scopes" box, enter:
    ```text
    https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl
    ```
15. Click **Authorize APIs**, sign in with the Google account that owns the YouTube channel, and approve.
16. Click **Exchange authorization code for tokens**. Copy the refresh token as `YOUTUBE_REFRESH_TOKEN`.

---

## 2. Telegram Bot

1. In Telegram, message **@BotFather**, run `/newbot`, and follow the prompts. Copy the token as `TELEGRAM_BOT_TOKEN`.
2. Send any message to your new bot so it can reply to you.
3. Get your chat ID by opening:
   `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
   Send your bot a message, refresh, and read `"chat":{"id":<NUMBER>}`. That number is `TELEGRAM_CHAT_ID`.

---

## 3. Supabase

1. Create a Supabase project.
2. **Project Settings -> API**: copy:
   - Project URL -> `SUPABASE_URL`
   - `anon` public key -> `SUPABASE_ANON_KEY`
   - `service_role` key -> `SUPABASE_SERVICE_ROLE_KEY`
3. **SQL Editor -> New query**: paste the full contents of `supabase/schema.sql` and run it. This creates:
   - `post_yt_vido_automation_settings`
   - `post_yt_vido_automation_videos`
   - `post_yt_vido_automation_app_config`
   - row-level security rules
   - the `pg_net` dispatch trigger
4. In that same SQL editor, insert your GitHub repository details and fine-grained token:
   ```sql
   insert into post_yt_vido_automation_app_config (id, github_owner, github_repo, github_pat)
   values (1, 'MrWiseMax', 'post-yt-video-automation', 'ghp_YOUR_FINE_GRAINED_TOKEN')
   on conflict (id) do update set
     github_owner = excluded.github_owner,
     github_repo  = excluded.github_repo,
     github_pat   = excluded.github_pat;
   ```
5. **Authentication -> Providers -> Email**: make sure Email is enabled. After your first successful login, you can disable new sign-ups so only your existing user can access the app.
6. **Authentication -> URL Configuration**:
   - Site URL: `https://mrwisemax.github.io/post-yt-video-automation/`
   - Redirect URLs: add `https://mrwisemax.github.io/post-yt-video-automation/`
7. Browser/database access is allowlisted to:
   - `mrwisemikeyt@gmail.com`
   - `ahmedzuhairyoutube@gmail.com`

   The allowlist lives in two places that must stay in sync: `js/config.js` (`ALLOWED_EMAILS`) and the RLS policies in `supabase/schema.sql`. Both accounts share the same app data (settings, queue, history). New sign-ups are disabled in Supabase Auth (Authentication -> Sign In / Up) — re-enable temporarily if you ever add a third account.

8. **YouTube account isolation**: all YouTube credentials (`YOUTUBE_CLIENT_ID` / `SECRET` / `REFRESH_TOKEN`) must be created while signed in as `ahmedzuhairyoutube@gmail.com` (the channel owner). Never sign in to Google Cloud OAuth or the OAuth Playground as `mrwisemikeyt@gmail.com` for any YouTube step — that account is for the web app and Supabase only.

---

## 4. GitHub Repo + Pages + Secrets

1. Repository: `MrWiseMax/post-yt-video-automation`.
2. Fine-grained token for the Supabase trigger:
   - GitHub -> Settings -> Developer settings -> Fine-grained tokens -> Generate new token
   - Repository access: only `post-yt-video-automation`
   - Permissions: **Contents: Read and write**
   - Copy it into `post_yt_vido_automation_app_config.github_pat` in Supabase.
3. Enable Pages:
   - Repo Settings -> Pages
   - Source: Deploy from a branch
   - Branch: `main`
   - Folder: `/root`
   - Site URL should be `https://mrwisemax.github.io/post-yt-video-automation/`
4. Add these GitHub Actions secrets:

   | Secret name | Value |
   |---|---|
   | `SUPABASE_URL` | Supabase project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
   | `ANTHROPIC_API_KEY` | Claude API key |
   | `GOOGLE_SERVICE_ACCOUNT_JSON` | Full service account JSON |
   | `YOUTUBE_CLIENT_ID` | Google OAuth client ID |
   | `YOUTUBE_CLIENT_SECRET` | Google OAuth client secret |
   | `YOUTUBE_REFRESH_TOKEN` | YouTube OAuth refresh token |
   | `TELEGRAM_BOT_TOKEN` | Telegram bot token |
   | `TELEGRAM_CHAT_ID` | Telegram chat ID |

5. Confirm `js/config.js` contains the correct `SUPABASE_URL` and `SUPABASE_ANON_KEY`, then commit and push.

---

## 5. Fill In Channel Settings

Open the Pages URL, log in with the magic link, then go to **Settings** and fill:

- **Google Drive folder ID**
- **Channel tags**
- **3 sample tag sets**
- **Description footer**

Click **Save settings**.

Uploads are fixed to:
- YouTube category: **Education** (`27`)
- Metadata type: **How-To**
- Caption language: **English** (`en`)

---

## Quick Verification

- Put the 3 files in Drive and schedule one test video.
- Within about 1 minute, GitHub Actions should start **Process & Schedule Video**.
- You should get Telegram message 1 when processing starts.
- After upload succeeds, you should get Telegram message 2.
- After YouTube makes the scheduled video public, `check-live.yml` should eventually send Telegram message 3.

If uploads start failing after a week, your Google OAuth app may still be in Testing mode. Set it to In production and generate a fresh refresh token.
