# One‑Time Setup Checklist

Do these once. After this, your only per‑video work is: drop 3 files in the Drive folder, pick a time, click one button.

Legend: 🟦 = value you'll copy into a secret later.

---

## 1. Google Cloud — one project for Drive + YouTube

1. Go to <https://console.cloud.google.com/> → create a project (e.g. `yt-automation`).
2. **APIs & Services → Library** → enable both:
   - **YouTube Data API v3**
   - **Google Drive API**

### 1a. Service account (for reading + deleting Drive files)
3. **APIs & Services → Credentials → Create credentials → Service account.** Name it `drive-bot`. Skip role grants. Create.
4. Open the service account → **Keys → Add key → Create new key → JSON**. A `.json` file downloads. This whole file is 🟦 `GOOGLE_SERVICE_ACCOUNT_JSON`.
5. Copy the service account's email (looks like `drive-bot@yt-automation.iam.gserviceaccount.com`).
6. Create your Drive drop folder. **Share it with that service‑account email as _Editor_.** (Editor is required so the bot can delete files after upload.) Open the folder and copy its ID from the URL (`drive.google.com/drive/folders/<THIS_IS_THE_ID>`) → 🟦 `drive_folder_id`.

### 1b. OAuth client (for uploading to YouTube — must be OAuth, your account owns the channel)
7. **APIs & Services → OAuth consent screen** → User type **External** → fill app name + your email → **Save**. Add the scopes `.../auth/youtube.upload` and `.../auth/youtube.force-ssl` if prompted (optional here).
8. **IMPORTANT — set Publishing status to _In production_** (not "Testing"). Testing‑mode refresh tokens expire after 7 days; production tokens don't. You'll see an "unverified app" warning later — that's expected for a personal app; you click **Advanced → Go to (app) (unsafe)** and continue.
9. **Credentials → Create credentials → OAuth client ID → Web application.** Under **Authorized redirect URIs** add: `https://developers.google.com/oauthplayground`. Create. Copy 🟦 `YOUTUBE_CLIENT_ID` and 🟦 `YOUTUBE_CLIENT_SECRET`.

### 1c. Get the YouTube refresh token
10. Open <https://developers.google.com/oauthplayground> → click the **⚙️ gear (top right) → check "Use your own OAuth credentials"** → paste your client ID + secret.
11. In the left "Input your own scopes" box, enter (space‑separated):
    ```
    https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl
    ```
12. Click **Authorize APIs** → sign in with the **Google account that owns the YouTube channel** → approve (click through the unverified‑app warning).
13. Click **Exchange authorization code for tokens.** Copy the **Refresh token** → 🟦 `YOUTUBE_REFRESH_TOKEN`.

---

## 2. Telegram bot

1. In Telegram, message **@BotFather** → `/newbot` → follow prompts. Copy the token → 🟦 `TELEGRAM_BOT_TOKEN`.
2. Send any message to your new bot (so it can reply to you).
3. Get your chat ID: open `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser, send your bot a message, refresh, and read `"chat":{"id":<NUMBER>}`. That number → 🟦 `TELEGRAM_CHAT_ID`. (Or message **@userinfobot**.)

---

## 3. Supabase (state + settings)

1. Create a project at <https://supabase.com/>. Wait for it to finish provisioning.
2. **Project Settings → API** — copy:
   - Project URL → 🟦 `SUPABASE_URL`
   - `anon` public key → 🟦 `SUPABASE_ANON_KEY` (safe to expose in the web app)
   - `service_role` key → 🟦 `SUPABASE_SERVICE_ROLE_KEY` (secret — worker only, never in the browser)
3. **SQL Editor → New query** → paste the entire contents of [`supabase/schema.sql`](supabase/schema.sql) → **Run**. This creates the tables, security rules, and the "button → GitHub" trigger, and enables the `pg_net` extension.
4. In that same SQL editor, run **one** insert with your GitHub details + a token (from step 5 below). This stays only in your database:
   ```sql
   insert into app_config (id, github_owner, github_repo, github_pat)
   values (1, 'YOUR_GH_USERNAME', 'YOUR_REPO_NAME', 'ghp_YOUR_FINE_GRAINED_TOKEN')
   on conflict (id) do update set
     github_owner = excluded.github_owner,
     github_repo  = excluded.github_repo,
     github_pat   = excluded.github_pat;
   ```
5. **Authentication → Providers → Email**: make sure Email is enabled (magic link works out of the box). After your first login, you can disable new sign‑ups (Authentication → Providers → Email → turn off "Allow new users to sign up") so only you have access.
6. **Authentication → URL Configuration**: set **Site URL** to your GitHub Pages URL (from step 4 below), and add it under **Redirect URLs**.

---

## 4. GitHub repo + Pages + secrets

1. Create a new GitHub repo (e.g. `yt-automation`). Push all the files from this folder to it.
2. **Fine‑grained token for the trigger** (this is the `ghp_...` used in step 3.4 above): GitHub → **Settings → Developer settings → Fine‑grained tokens → Generate new token.** Repository access = **Only select repositories → your repo**. Permissions → **Contents: Read and write** (required to fire `repository_dispatch`). Generate and copy it.
3. **Enable Pages:** repo **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / root → Save.** Your site appears at `https://<username>.github.io/<repo>/`. Put that URL into Supabase (step 3.6) and into `js/config.js`.
4. **Add Actions secrets:** repo **Settings → Secrets and variables → Actions → New repository secret.** Add all of these:

   | Secret name | Value |
   |---|---|
   | `SUPABASE_URL` | 🟦 |
   | `SUPABASE_SERVICE_ROLE_KEY` | 🟦 |
   | `ANTHROPIC_API_KEY` | your Claude API key from <https://console.anthropic.com/> |
   | `GOOGLE_SERVICE_ACCOUNT_JSON` | 🟦 (paste the entire JSON file contents) |
   | `YOUTUBE_CLIENT_ID` | 🟦 |
   | `YOUTUBE_CLIENT_SECRET` | 🟦 |
   | `YOUTUBE_REFRESH_TOKEN` | 🟦 |
   | `TELEGRAM_BOT_TOKEN` | 🟦 |
   | `TELEGRAM_CHAT_ID` | 🟦 |

5. Edit [`js/config.js`](js/config.js) and paste your `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Commit + push.

---

## 5. Fill in your channel settings (in the web app)

Open your Pages URL → log in with the magic link → **Settings** tab → fill:

- **Drive folder ID** (from 1.6)
- **Channel tags** (always‑included tags, comma‑separated)
- **3 sample tag sets** (style reference for Claude — paste 3 of your best past videos' tag lists)
- **Description footer** (your links / CTA — appended to every description)

Click **Save settings**. You're done. See the "How to post a video" section in [`README.md`](README.md).

---

## Quick verification

- **Trigger works?** In the web app, schedule a video (with the 3 files in Drive). Within ~1 min the GitHub Action "Process & Schedule Video" should start (repo → Actions tab) and you should get Telegram message #1.
- **Refresh token stuck?** If YouTube uploads start failing after a week, your OAuth app slipped back to "Testing" — re‑confirm step 1b.8 (In production) and redo 1c.
