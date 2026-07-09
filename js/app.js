import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY, OWNER_EMAIL } from './config.js';
import { etInputToUtc, formatEt, validatePublish } from './time.js';

const $ = (id) => document.getElementById(id);
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabaseProjectRef = new URL(SUPABASE_URL).hostname.split('.')[0];

let refreshTimer = null;

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
  const authed = !!session;
  $('loginView').classList.toggle('hidden', authed);
  $('appView').classList.toggle('hidden', !authed);
  $('signOutBtn').classList.toggle('hidden', !authed);
  if (authed) {
    loadSettings();
    loadVideos();
    if (!refreshTimer) refreshTimer = setInterval(loadVideos, 20000);
  } else if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

$('loginEmail').value = OWNER_EMAIL || '';

$('loginBtn').addEventListener('click', async () => {
  const email = $('loginEmail').value.trim();
  const msg = $('loginMsg');
  if (!email) return setMsg(msg, 'Enter your email.', 'err');
  $('loginBtn').disabled = true;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href.split('#')[0] },
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
async function loadSettings() {
  const { data, error } = await supabase.from('settings').select('*').eq('id', 1).single();
  if (error || !data) return;
  $('driveFolder').value = data.drive_folder_id || '';
  $('channelTags').value = data.channel_tags || '';
  const samples = Array.isArray(data.sample_tagsets) ? data.sample_tagsets : [];
  $('sample1').value = samples[0] || '';
  $('sample2').value = samples[1] || '';
  $('sample3').value = samples[2] || '';
  $('footer').value = data.description_footer || '';
  $('categoryId').value = data.youtube_category_id || '22';
  $('captionLang').value = data.caption_language || 'en';
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
    youtube_category_id: $('categoryId').value.trim() || '22',
    caption_language: $('captionLang').value.trim() || 'en',
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('settings').upsert(payload, { onConflict: 'id' });
  $('saveSettingsBtn').disabled = false;
  setMsg(msg, error ? error.message : 'Settings saved.', error ? 'err' : 'ok');
});

// ── Schedule ──────────────────────────────────────────────────────────────
$('publishAt').addEventListener('input', updatePreview);
function updatePreview() {
  const utc = etInputToUtc($('publishAt').value);
  const el = $('publishPreview');
  if (!utc) { el.textContent = ''; return; }
  const err = validatePublish(utc);
  el.textContent = err ? '⚠ ' + err : `Will publish at ${formatEt(utc)}  (${utc.toUTCString()})`;
  el.style.color = err ? 'var(--warn)' : 'var(--muted)';
}

$('scheduleBtn').addEventListener('click', async () => {
  const msg = $('scheduleMsg');
  const utc = etInputToUtc($('publishAt').value);
  const err = validatePublish(utc);
  if (err) return setMsg(msg, err, 'err');

  // Guard: Drive folder must be configured.
  const { data: settings } = await supabase.from('settings').select('drive_folder_id').eq('id', 1).single();
  if (!settings?.drive_folder_id) {
    switchTab('settings');
    return setMsg($('settingsMsg'), 'Set your Drive folder ID first, then schedule.', 'err');
  }

  $('scheduleBtn').disabled = true;
  setMsg(msg, 'Queuing…', 'info');
  const { error } = await supabase.from('videos').insert({
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
async function loadVideos() {
  const { data, error } = await supabase
    .from('videos')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(12);
  const list = $('videoList');
  if (error) { list.innerHTML = `<div class="msg err">${error.message}</div>`; return; }
  if (!data || data.length === 0) { list.innerHTML = '<div class="small">No videos yet.</div>'; return; }

  list.innerHTML = data
    .map((v) => {
      const when = v.publish_at ? formatEt(new Date(v.publish_at)) : '';
      const sub =
        v.status === 'failed' && v.error
          ? `Error: ${escapeHtml(v.error)}`
          : `Target: ${when}`;
      const link = v.youtube_video_id
        ? ` · <a href="https://youtu.be/${v.youtube_video_id}" target="_blank" rel="noopener">open</a>`
        : '';
      return `<div class="item">
          <div>
            <div class="title">${escapeHtml(v.title || '(reading title from Drive…)')}</div>
            <div class="sub">${sub}${link}</div>
          </div>
          <span class="badge ${v.status}">${v.status}</span>
        </div>`;
    })
    .join('');
}

// ── helpers ────────────────────────────────────────────────────────────────
function setMsg(el, text, kind) {
  el.textContent = text;
  el.className = 'msg ' + (kind || '');
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

initAuth();
