import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY, OWNER_EMAIL, ALLOWED_EMAILS } from './config.js';
import { zonedInputToUtc, formatZoned, utcToZonedInputValue, validatePublish } from './time.js';

const $ = (id) => document.getElementById(id);
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabaseProjectRef = new URL(SUPABASE_URL).hostname.split('.')[0];
const SETTINGS_TABLE = 'post_yt_vido_automation_settings';
const VIDEOS_TABLE = 'post_yt_vido_automation_videos';
const ALLOWED_EMAIL_SET = new Set(ALLOWED_EMAILS.map((e) => e.trim().toLowerCase()));

let syncStarted = false;
// True for the whole check, so a second render() — supabase fires
// onAuthStateChange right after getSession() on load — cannot replace the
// placeholders with real rows while the check is still running.
let syncing = false;
let followUpTimer = null;
let settingsLoadedForUserId = null;
let settingsLoadingForUserId = null;

// ── Config sanity check ───────────────────────────────────────────────────
if (SUPABASE_URL.includes('YOUR-PROJECT') || SUPABASE_ANON_KEY.includes('YOUR-ANON')) {
  document.body.innerHTML =
    '<div class="wrap"><div class="card"><h2>Almost there</h2><p class="hint">Edit <code>js/config.js</code> and paste your Supabase URL and anon key, then reload.</p></div></div>';
  throw new Error('config.js not filled in');
}

// ── Auth ──────────────────────────────────────────────────────────────────
async function initAuth() {
  const callbackError = await handleAuthCallback();
  if (callbackError) {
    render(null);
    setMsg($('loginMsg'), callbackError, 'err');
    return;
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) setMsg($('loginMsg'), error.message, 'err');
  render(data?.session || null);
  supabase.auth.onAuthStateChange((_e, session) => render(session));
}

async function handleAuthCallback() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken) return '';

  const issuerProjectRef = getJwtIssuerProjectRef(accessToken);
  if (issuerProjectRef && issuerProjectRef !== supabaseProjectRef) {
    clearUrlHash();
    await supabase.auth.signOut();
    return `This magic link belongs to a different Supabase project (${issuerProjectRef}). This app is configured for ${supabaseProjectRef}. Send a fresh link from this app, or update js/config.js to match the Supabase project that sends the email.`;
  }

  if (!refreshToken) return '';
  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  clearUrlHash();
  return error ? error.message : '';
}

function getJwtIssuerProjectRef(token) {
  try {
    const [, payload] = token.split('.');
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')));
    return decoded?.iss ? new URL(decoded.iss).hostname.split('.')[0] : '';
  } catch {
    return '';
  }
}

function clearUrlHash() {
  history.replaceState(null, document.title, window.location.pathname + window.location.search);
}

function render(session) {
  const allowed = isAllowedEmail(session?.user?.email);
  const authed = !!session && allowed;
  const userId = session?.user?.id || null;
  $('loginView').classList.toggle('hidden', authed);
  $('appView').classList.toggle('hidden', !authed);
  $('signOutBtn').classList.toggle('hidden', !authed);
  if (authed) {
    if (settingsLoadedForUserId !== userId && settingsLoadingForUserId !== userId) loadSettings(userId);
    if (!syncStarted) {
      syncStarted = true;
      showVideoSkeleton();
      syncWithYouTube();
    } else if (!syncing) {
      loadVideos();
    }
  } else {
    settingsLoadedForUserId = null;
    settingsLoadingForUserId = null;
    syncStarted = false;
    syncing = false;
    if (followUpTimer) {
      clearInterval(followUpTimer);
      followUpTimer = null;
    }
  }
  if (session && !allowed) {
    supabase.auth.signOut();
    setMsg($('loginMsg'), 'This email is not allowed to access this app.', 'err');
  }
}

$('loginEmail').value = OWNER_EMAIL || '';

$('loginBtn').addEventListener('click', async () => {
  const email = $('loginEmail').value.trim();
  const msg = $('loginMsg');
  if (!email) return setMsg(msg, 'Enter your email.', 'err');
  if (!isAllowedEmail(email)) return setMsg(msg, 'This email is not allowed to access this app.', 'err');
  $('loginBtn').disabled = true;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.href.split('#')[0],
      shouldCreateUser: false, // both allowed accounts already exist; signups are disabled
    },
  });
  $('loginBtn').disabled = false;
  setMsg(msg, error ? error.message : 'Check your email for the magic link.', error ? 'err' : 'ok');
});

$('signOutBtn').addEventListener('click', () => supabase.auth.signOut());

// ── Tabs ──────────────────────────────────────────────────────────────────
$('tabSchedule').addEventListener('click', () => switchTab('schedule'));
$('tabSettings').addEventListener('click', () => switchTab('settings'));
function switchTab(which) {
  const isSchedule = which === 'schedule';
  $('tabSchedule').classList.toggle('active', isSchedule);
  $('tabSettings').classList.toggle('active', !isSchedule);
  $('scheduleView').classList.toggle('hidden', !isSchedule);
  $('settingsView').classList.toggle('hidden', isSchedule);
}

// ── Settings ──────────────────────────────────────────────────────────────
async function loadSettings(userId) {
  settingsLoadingForUserId = userId;
  const { data, error } = await supabase.from(SETTINGS_TABLE).select('*').eq('id', 1).single();
  if (error || !data) {
    settingsLoadingForUserId = null;
    return;
  }
  $('driveFolder').value = data.drive_folder_id || '';
  $('channelTags').value = data.channel_tags || '';
  const samples = Array.isArray(data.sample_tagsets) ? data.sample_tagsets : [];
  $('sample1').value = samples[0] || '';
  $('sample2').value = samples[1] || '';
  $('sample3').value = samples[2] || '';
  $('footer').value = data.description_footer || '';
  settingsLoadedForUserId = userId;
  settingsLoadingForUserId = null;
}

$('saveSettingsBtn').addEventListener('click', async () => {
  const msg = $('settingsMsg');
  $('saveSettingsBtn').disabled = true;
  const payload = {
    id: 1,
    drive_folder_id: $('driveFolder').value.trim(),
    channel_tags: $('channelTags').value.trim(),
    sample_tagsets: [$('sample1').value.trim(), $('sample2').value.trim(), $('sample3').value.trim()],
    description_footer: $('footer').value,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from(SETTINGS_TABLE).upsert(payload, { onConflict: 'id' });
  $('saveSettingsBtn').disabled = false;
  setMsg(msg, error ? error.message : 'Settings saved.', error ? 'err' : 'ok');
});

// ── Schedule ──────────────────────────────────────────────────────────────
$('publishAt').step = 900;
$('publishAt').addEventListener('focus', updateMinimumPublishTime);
$('publishAt').addEventListener('input', updatePreview);
updateMinimumPublishTime();
updatePreview();
function updateMinimumPublishTime() {
  const minMs = Date.now() + 3 * 3600 * 1000;
  const stepMs = 15 * 60 * 1000;
  $('publishAt').min = utcToZonedInputValue(new Date(Math.ceil(minMs / stepMs) * stepMs));
}
function updatePreview() {
  const utc = zonedInputToUtc($('publishAt').value);
  const el = $('publishPreview');
  el.classList.remove('ok', 'warn');
  if (!utc) {
    el.textContent = 'Select a publish date and time.';
    return;
  }
  const err = validatePublish(utc);
  el.textContent = err ? err : `Will publish at ${formatZoned(utc)} (${utc.toUTCString()})`;
  el.classList.add(err ? 'warn' : 'ok');
}

$('scheduleBtn').addEventListener('click', async () => {
  const msg = $('scheduleMsg');
  const utc = zonedInputToUtc($('publishAt').value);
  const err = validatePublish(utc);
  if (err) return setMsg(msg, err, 'err');

  // Guard: Drive folder must be configured.
  const { data: settings } = await supabase.from(SETTINGS_TABLE).select('drive_folder_id').eq('id', 1).single();
  if (!settings?.drive_folder_id) {
    switchTab('settings');
    return setMsg($('settingsMsg'), 'Set your Drive folder ID first, then schedule.', 'err');
  }

  $('scheduleBtn').disabled = true;
  setMsg(msg, 'Queuing…', 'info');
  const { error } = await supabase.from(VIDEOS_TABLE).insert({
    status: 'queued',
    publish_at: utc.toISOString(),
  });
  $('scheduleBtn').disabled = false;

  if (error) return setMsg(msg, error.message, 'err');
  setMsg(msg, 'Queued. The worker is starting — watch Telegram + the list below.', 'ok');
  $('publishAt').value = '';
  updatePreview();
  loadVideos();
});

// ── Recent videos ─────────────────────────────────────────────────────────
async function loadVideos({ fade = false } = {}) {
  const { data, error } = await supabase
    .from(VIDEOS_TABLE)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(12);

  let html;
  if (error) html = `<div class="msg err">${escapeHtml(error.message)}</div>`;
  else if (!data || data.length === 0) html = '<div class="small">No videos yet.</div>';
  else html = data.map(videoItemHtml).join('');

  if (fade) fadeInto(html);
  else $('videoList').innerHTML = html;
}

// Placeholder rows shaped like real ones, shown while YouTube is being checked.
// aria-hidden so a screen reader announces the status message instead of
// reading out four empty rows.
function showVideoSkeleton(count = 4) {
  $('videoList').innerHTML = Array.from(
    { length: count },
    () => `<div class="item skeleton" aria-hidden="true">
        <div class="item-main">
          <div class="sk sk-title"></div>
          <div class="sk sk-sub"></div>
        </div>
        <div class="actions"><div class="sk sk-badge"></div></div>
      </div>`
  ).join('');
}

// Fade out, swap, fade back in. The rAF matters: without it the browser can
// paint the new markup before the class is removed, and the fade never shows.
function fadeInto(html) {
  const list = $('videoList');
  list.classList.add('fading');
  setTimeout(() => {
    list.innerHTML = html;
    requestAnimationFrame(() => list.classList.remove('fading'));
  }, 180);
}

function videoItemHtml(v) {
  // publish_at mirrors whatever YouTube actually has: publish times are changed
  // in YouTube Studio, and the 15-minute check copies each one back down here.
  const when = v.publish_at ? formatZoned(new Date(v.publish_at)) : '';
  const sub =
    v.status === 'failed' && v.error
      ? `Error: ${escapeHtml(v.error)}`
      : `Target: ${when}`;
  const link = v.youtube_video_id
    ? ` · <a href="https://youtu.be/${v.youtube_video_id}" target="_blank" rel="noopener">open</a>`
    : '';


  return `<div class="item">
      <div class="item-main">
        <div class="title">${escapeHtml(v.title || '(reading title from Drive…)')}</div>
        <div class="sub">${sub}${link}</div>
      </div>
      <div class="actions">
        <span class="badge ${v.status}">${v.status}</span>
        <button class="del" data-id="${escapeHtml(v.id)}" title="Remove from this list" aria-label="Remove from this list">&times;</button>
      </div>
    </div>`;
}

// Remove a row from the list — e.g. a failed attempt you've already re-run
// successfully. Registered once, outside loadVideos(), so the auto-refresh
// doesn't stack a new listener on every redraw.
$('videoList').addEventListener('click', async (e) => {
  const btn = e.target.closest('.del');
  if (!btn) return;

  const title = btn.closest('.item')?.querySelector('.title')?.textContent || 'this entry';
  const ok = confirm(
    `Remove "${title}" from this list?\n\n` +
      'This deletes the record here only. An already-uploaded YouTube video and your Drive files are not touched.'
  );
  if (!ok) return;

  btn.disabled = true;
  const { error } = await supabase.from(VIDEOS_TABLE).delete().eq('id', btn.dataset.id);
  if (error) {
    btn.disabled = false;
    return setMsg($('scheduleMsg'), `Could not remove it: ${error.message}`, 'err');
  }
  loadVideos();
});

// ── Sync with YouTube on load ─────────────────────────────────────────────
// The page has no YouTube credentials, so it asks Supabase to fire the worker.
// That run copies publish times down, removes videos cancelled before they ever
// published, and flags ones deleted after they were live. It takes about a
// minute, so the list is re-read for a couple of minutes and then left alone —
// nothing polls after that.
async function readLastChecked() {
  const { data } = await supabase
    .from(SETTINGS_TABLE)
    .select('last_checked_at')
    .eq('id', 1)
    .single();
  return data?.last_checked_at || null;
}

async function syncWithYouTube() {
  syncing = true;
  const msg = $('refreshMsg');
  // Remember the stamp before asking, so the wait ends on the value changing
  // rather than on a timer. Comparing values rather than clocks keeps the
  // browser's idea of the time out of it.
  const before = await readLastChecked();

  const { error } = await supabase.rpc('dispatch_refresh_videos');
  if (error) {
    syncing = false;
    setMsg(msg, `Could not check YouTube: ${error.message}`, 'err');
    return loadVideos({ fade: true });
  }

  setMsg(msg, 'Checking YouTube…', 'info');
  let tries = 0;
  followUpTimer = setInterval(async () => {
    tries += 1;
    const stamp = await readLastChecked();

    if (stamp && stamp !== before) {
      clearInterval(followUpTimer);
      followUpTimer = null;
      syncing = false;
      await loadVideos({ fade: true });
      setMsg(msg, 'Up to date with YouTube.', 'ok');
      return;
    }

    // A minute is far longer than a run takes; something is wrong rather than slow.
    if (tries >= 30) {
      clearInterval(followUpTimer);
      followUpTimer = null;
      syncing = false;
      await loadVideos({ fade: true });
      setMsg(msg, 'YouTube did not answer in time — reload to try again.', 'warn');
    }
  }, 2000);
}
// ── helpers ────────────────────────────────────────────────────────────────
function setMsg(el, text, kind) {
  el.textContent = text;
  el.className = 'msg ' + (kind || '');
}
function isAllowedEmail(email) {
  return ALLOWED_EMAIL_SET.has(String(email || '').trim().toLowerCase());
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

initAuth();
