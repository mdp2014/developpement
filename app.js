import 'https://cdn.jsdelivr.net/npm/emoji-picker-element@^1/index.js';

const supabaseUrl = 'https://toglujtvmslqutjeqmrh.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvZ2x1anR2bXNscXV0amVxbXJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1ODg0OTUsImV4cCI6MjA4OTE2NDQ5NX0.uezhrVRl2FTtVRfgXBMAnxcwROUNc91ruVegsyMD38U';

const chatMessages       = document.getElementById('chat-messages');
const messageInput       = document.getElementById('message-input');
const sendButton         = document.getElementById('send-button');
const emojiButton        = document.getElementById('emoji-button');
const emojiPickerWrapper = document.getElementById('emoji-picker-wrapper');
const userSelect         = document.getElementById('user-select');
const loginUsername      = document.getElementById('login-username');
const loginPassword      = document.getElementById('login-password');
const loginButton        = document.getElementById('login-button');
const loginContainer     = document.getElementById('login-container');
const connectedUser      = document.getElementById('connected-user');
const connectedUsername  = document.getElementById('connected-username');
const logoutButton       = document.getElementById('logout-button');
const typingIndicator    = document.getElementById('typing-indicator');
const quickReplies       = document.getElementById('quick-replies');
const networkIndicator   = document.getElementById('network-indicator');

let users            = {};
let currentUserId    = null;
let refreshInterval  = null;
let typingTimeout    = null;
let isTyping         = false;
let currentMessages  = [];
let lastMessageCount = 0;
let emojiPickerOverlay  = null;
let sessionValidationInterval = null;

// Présence
let onlineUsers     = new Set();
let usersWithUnread = new Map();
let heartbeatInterval = null;
let presenceInterval  = null;

// ============================================================
// OPTIMISATION : Cache géolocalisation
// ============================================================
let _geoCache = null;
let _geoPending = null;

async function getGeolocationCached() {
    if (_geoCache) return _geoCache;
    if (_geoPending) return _geoPending;
    _geoPending = new Promise((resolve, reject) => {
        if (!navigator.geolocation) { reject(new Error('Non supporté')); return; }
        navigator.geolocation.getCurrentPosition(
            p => {
                _geoCache = { latitude: p.coords.latitude, longitude: p.coords.longitude };
                _geoPending = null;
                resolve(_geoCache);
            },
            err => { _geoPending = null; reject(err); },
            { timeout: 3000, maximumAge: 300000 } // cache 5 min côté navigateur
        );
    });
    return _geoPending;
}

async function getCityFromCoordinates(lat, lon) {
    try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`);
        const d = await r.json();
        return d.address?.city || d.address?.town || d.address?.village || null;
    } catch { return null; }
}

const SESSION_STORAGE_KEY       = 'persistent_session_v1';
const SESSION_DURATION_MS       = 1000 * 60 * 60 * 24 * 30;
const SESSION_CHECK_INTERVAL_MS = 1000 * 60 * 5;
const ONLINE_THRESHOLD_SECONDS  = 30;
const HEARTBEAT_INTERVAL_MS     = 15000;

// ============================================================
// MESSAGES VOCAUX — État
// ============================================================
let mediaRecorder      = null;
let audioChunks        = [];
let recordingStream    = null;
let voiceAudioContext  = null;
let voiceAnalyserNode  = null;
let voiceGainNode      = null;
let voiceFilterNode    = null;
let recordingStartTime = null;
let recordingTimer     = null;
let isRecording        = false;
let isPaused           = false;
let isVoiceLocked      = false;
let voiceEffect        = 'normal';
let voiceAmbiance      = null;
let waveformAnimId     = null;
let pressBtnTimer      = null;
let slideStartX        = null;
let slideStartY        = null;
let pausedDuration     = 0;
let pauseStartTime     = null;
let ambianceNodes      = [];

const PRESS_DURATION_MS  = 400;
const SLIDE_CANCEL_PX    = -60;
const SLIDE_LOCK_PY      = -50;
const MAX_VOICE_DURATION = 120;

const VOICE_EFFECTS = {
    normal:   { pitch: 1.0,  robot: false, label: 'Normal' },
    deep:     { pitch: 0.75, robot: false, label: 'Grave' },
    high:     { pitch: 1.35, robot: false, label: 'Aigu' },
    chipmunk: { pitch: 1.7,  robot: false, label: 'Écureuil' },
    robot:    { pitch: 1.0,  robot: true,  label: 'Robot' },
};

// ============================================================
// FONT PICKER — Unicode
// ============================================================
const FONT_STYLES = [
    { id: 'normal',     label: 'Normal',       preview: 'Abc', description: 'Texte standard',     convert: t => t },
    { id: 'bold',       label: '𝐆𝐫𝐚𝐬',        preview: '𝐀𝐁𝐂', description: 'Bold',              convert: t => convertUnicode(t, MAPS.bold) },
    { id: 'italic',     label: '𝘐𝘵𝘢𝘭𝘪𝘲𝘶𝘦',    preview: '𝘈𝘉𝘊', description: 'Italique',          convert: t => convertUnicode(t, MAPS.italic) },
    { id: 'bold_italic',label: '𝑩𝑰',           preview: '𝑨𝑩𝑪', description: 'Gras italique',     convert: t => convertUnicode(t, MAPS.bold_italic) },
    { id: 'script',     label: '𝓢𝓬𝓻𝓲𝓹𝓽',      preview: '𝓐𝓑𝓒', description: 'Script',           convert: t => convertUnicode(t, MAPS.script) },
    { id: 'double',     label: '𝔻𝕠𝕦𝕓𝕝𝕖',      preview: '𝔸𝔹ℂ', description: 'Double trait',     convert: t => convertUnicode(t, MAPS.double) },
    { id: 'fraktur',    label: '𝔉𝔯𝔞𝔨𝔱𝔲𝔯',     preview: '𝔄𝔅ℭ', description: 'Fraktur',          convert: t => convertUnicode(t, MAPS.fraktur) },
    { id: 'mono',       label: '𝙼𝚘𝚗𝚘',         preview: '𝙰𝙱𝙲', description: 'Monospace',        convert: t => convertUnicode(t, MAPS.mono) },
    { id: 'bubble',     label: 'Ⓑⓤⓑⓑⓛⓔ',    preview: 'ⒶⒷⒸ', description: 'Cerclé',            convert: t => convertUnicode(t, MAPS.bubble) },
    { id: 'small_caps', label: 'Sᴍᴀʟʟ Cᴀᴘꜱ',  preview: 'Aʙᴄ', description: 'Petites capitales', convert: t => convertUnicode(t, MAPS.small_caps) },
    { id: 'wide',       label: 'Ｗｉｄｅ',       preview: 'ＡＢＣ', description: 'Pleine largeur',   convert: t => convertUnicode(t, MAPS.wide) },
];

const MAPS = {
    bold:        { upper: 0x1D400, lower: 0x1D41A, digits: 0x1D7CE },
    italic:      { upper: 0x1D434, lower: 0x1D44E, special: { 'h': '\u210E' } },
    bold_italic: { upper: 0x1D468, lower: 0x1D482 },
    script:      { upper: 0x1D4D0, lower: 0x1D4EA, special: { 'B':'\u212C','E':'\u2130','F':'\u2131','H':'\u210B','I':'\u2110','L':'\u2112','M':'\u2133','R':'\u211B','e':'\u212F','g':'\u210A','o':'\u2134' } },
    double:      { upper: 0x1D538, lower: 0x1D552, digits: 0x1D7D8, special: { 'C':'\u2102','H':'\u210D','N':'\u2115','P':'\u2119','Q':'\u211A','R':'\u211D','Z':'\u2124' } },
    fraktur:     { upper: 0x1D504, lower: 0x1D51E, special: { 'C':'\u212D','H':'\u210C','I':'\u2111','R':'\u211C','Z':'\u2128' } },
    mono:        { upper: 0x1D670, lower: 0x1D68A, digits: 0x1D7F6 },
    bubble:      { upper: 0x24B6,  lower: 0x24D0,  digits: { '0':'⓪','1':'①','2':'②','3':'③','4':'④','5':'⑤','6':'⑥','7':'⑦','8':'⑧','9':'⑨' } },
    wide:        { upper: 0xFF21,  lower: 0xFF41,  digits: 0xFF10 },
    small_caps:  { map: { 'a':'ᴀ','b':'ʙ','c':'ᴄ','d':'ᴅ','e':'ᴇ','f':'ꜰ','g':'ɢ','h':'ʜ','i':'ɪ','j':'ᴊ','k':'ᴋ','l':'ʟ','m':'ᴍ','n':'ɴ','o':'ᴏ','p':'ᴘ','q':'ǫ','r':'ʀ','s':'s','t':'ᴛ','u':'ᴜ','v':'ᴠ','w':'ᴡ','x':'x','y':'ʏ','z':'ᴢ' } },
};

function convertUnicode(text, map) {
    if (!text) return text;
    if (map.map) return [...text].map(ch => map.map[ch.toLowerCase()] || ch).join('');
    return [...text].map(ch => {
        const code = ch.codePointAt(0);
        if (code >= 65 && code <= 90) {
            if (map.special?.[ch]) return map.special[ch];
            if (map.upper) return String.fromCodePoint(map.upper + (code - 65));
        }
        if (code >= 97 && code <= 122) {
            if (map.special?.[ch]) return map.special[ch];
            if (map.lower) return String.fromCodePoint(map.lower + (code - 97));
        }
        if (code >= 48 && code <= 57) {
            if (map.digits && typeof map.digits === 'object' && !Number.isInteger(map.digits)) return map.digits[ch] || ch;
            if (map.digits && Number.isInteger(map.digits)) return String.fromCodePoint(map.digits + (code - 48));
        }
        return ch;
    }).join('');
}

let activeFontId       = 'normal';
let rawInputText       = '';
let prevConvertedValue = '';
let fontPickerOpen     = false;
let fontPickerEl       = null;
let fontPickerOverlay  = null;

function getActiveStyle() { return FONT_STYLES.find(s => s.id === activeFontId) || FONT_STYLES[0]; }

function applyFontToInput() {
    const converted = getActiveStyle().convert(rawInputText);
    if (messageInput.value !== converted) {
        const s = messageInput.selectionStart, e = messageInput.selectionEnd;
        messageInput.value = converted;
        try { messageInput.setSelectionRange(s, e); } catch {}
    }
}

function handleFontInput(ev) {
    if (activeFontId === 'normal') { rawInputText = messageInput.value; prevConvertedValue = messageInput.value; return; }
    const currentValue = messageInput.value;
    const style = getActiveStyle();
    if (currentValue.length === 0) { rawInputText = ''; prevConvertedValue = ''; return; }
    const prevCPs = [...prevConvertedValue], currCPs = [...currentValue], rawCPs = [...rawInputText];
    if (currCPs.length > prevCPs.length) {
        let pos = 0;
        while (pos < prevCPs.length && prevCPs[pos] === currCPs[pos]) pos++;
        const inserted = currCPs.slice(pos, pos + (currCPs.length - prevCPs.length));
        rawCPs.splice(pos, 0, ...inserted.map(ch => decodeUnicodeChar(ch, style)));
    } else if (currCPs.length < prevCPs.length) {
        let pos = 0;
        while (pos < currCPs.length && prevCPs[pos] === currCPs[pos]) pos++;
        rawCPs.splice(pos, prevCPs.length - currCPs.length);
    } else {
        rawInputText = [...currentValue].map(ch => decodeUnicodeChar(ch, style)).join('');
        prevConvertedValue = currentValue;
        applyFontToInput();
        prevConvertedValue = messageInput.value;
        return;
    }
    rawInputText = rawCPs.join('');
    const newConverted = style.convert(rawInputText);
    if (messageInput.value !== newConverted) {
        const pos = messageInput.selectionStart;
        messageInput.value = newConverted;
        try { messageInput.setSelectionRange(pos, pos); } catch {}
    }
    prevConvertedValue = messageInput.value;
}

function decodeUnicodeChar(ch, style) {
    if (!ch) return ch;
    const cp  = ch.codePointAt(0);
    const map = style.id === 'small_caps' ? null : MAPS[style.id];
    if (!map) {
        const entry = Object.entries(MAPS.small_caps.map).find(([, v]) => v === ch);
        return entry ? entry[0] : ch;
    }
    if (map.map) return ch;
    if (map.upper && cp >= map.upper && cp < map.upper + 26) return String.fromCodePoint(65 + cp - map.upper);
    if (map.lower && cp >= map.lower && cp < map.lower + 26) return String.fromCodePoint(97 + cp - map.lower);
    if (map.digits && Number.isInteger(map.digits) && cp >= map.digits && cp < map.digits + 10) return String.fromCodePoint(48 + cp - map.digits);
    if (map.special) { const e = Object.entries(map.special).find(([, v]) => v === ch); if (e) return e[0]; }
    return ch;
}

function openFontPicker() {
    if (fontPickerOpen) { closeFontPicker(); return; }
    fontPickerOpen = true;
    fontPickerOverlay = document.createElement('div');
    fontPickerOverlay.className = 'font-picker-overlay';
    fontPickerOverlay.addEventListener('click', closeFontPicker);
    document.body.appendChild(fontPickerOverlay);
    fontPickerEl = document.createElement('div');
    fontPickerEl.className = 'font-picker-panel';
    fontPickerEl.innerHTML = `
        <div class="font-picker-header">
            <span class="font-picker-title">Style de texte</span>
            <span class="font-picker-hint">Visible pour tout le monde</span>
        </div>
        <div class="font-picker-grid">
            ${FONT_STYLES.map(s => `
                <button class="font-style-btn ${s.id === activeFontId ? 'active' : ''}" data-font-id="${s.id}" title="${s.description}">
                    <span class="font-style-preview">${s.preview}</span>
                    <span class="font-style-label">${s.description}</span>
                </button>`).join('')}
        </div>`;
    fontPickerEl.querySelectorAll('.font-style-btn').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); selectFont(btn.dataset.fontId); });
    });
    document.body.appendChild(fontPickerEl);
    requestAnimationFrame(() => {
        const fontBtn = document.getElementById('font-button');
        if (!fontBtn || !fontPickerEl) return;
        const bR = fontBtn.getBoundingClientRect(), pR = fontPickerEl.getBoundingClientRect();
        let left = bR.right - pR.width, top = bR.top - pR.height - 8;
        if (left < 8) left = 8;
        if (top < 8) top = bR.bottom + 8;
        fontPickerEl.style.left = `${left}px`;
        fontPickerEl.style.top  = `${top}px`;
    });
    document.getElementById('font-button').classList.add('active');
}

function closeFontPicker() {
    if (!fontPickerOpen) return;
    fontPickerOpen = false;
    if (fontPickerEl) { fontPickerEl.classList.add('hiding'); setTimeout(() => { fontPickerEl?.remove(); fontPickerEl = null; }, 180); }
    if (fontPickerOverlay) { fontPickerOverlay.remove(); fontPickerOverlay = null; }
    document.getElementById('font-button')?.classList.remove('active');
}

function selectFont(fontId) {
    activeFontId = fontId;
    updateFontButtonState();
    applyFontToInput();
    prevConvertedValue = messageInput.value;
    fontPickerEl?.querySelectorAll('.font-style-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.fontId === fontId));
    messageInput.focus();
}

function updateFontButtonState() {
    const btn = document.getElementById('font-button');
    if (!btn) return;
    const style = getActiveStyle();
    if (activeFontId === 'normal') { btn.textContent = '🔤'; btn.classList.remove('font-active'); btn.title = 'Style de texte'; }
    else { btn.textContent = style.preview.charAt(0) || '🔤'; btn.classList.add('font-active'); btn.title = `Style : ${style.description}`; }
}

function resetFont() { activeFontId = 'normal'; rawInputText = ''; prevConvertedValue = ''; updateFontButtonState(); }

// ============================================================
// RÉSEAU
// ============================================================
function updateNetworkIndicator() {
    if (!navigator.onLine) { networkIndicator.textContent = '🔴'; networkIndicator.title = 'Hors ligne'; return; }
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn) {
        const t = conn.effectiveType;
        if (t === '4g')      { networkIndicator.textContent = '🟢'; networkIndicator.title = 'Réseau excellent'; }
        else if (t === '3g') { networkIndicator.textContent = '🟡'; networkIndicator.title = 'Réseau moyen'; }
        else                 { networkIndicator.textContent = '🔴'; networkIndicator.title = 'Réseau faible'; }
    } else { networkIndicator.textContent = '🟢'; networkIndicator.title = 'En ligne'; }
}
window.addEventListener('online',  updateNetworkIndicator);
window.addEventListener('offline', updateNetworkIndicator);
updateNetworkIndicator();

// ============================================================
// SESSION
// ============================================================
function generateRefreshToken() {
    const b = new Uint8Array(32); window.crypto.getRandomValues(b);
    return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}
function loadSession()  { try { return JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY)); } catch { return null; } }
function saveSession(s) { localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(s)); }
function clearSession() { localStorage.removeItem(SESSION_STORAGE_KEY); }
function stopSessionValidation() { if (sessionValidationInterval) { clearInterval(sessionValidationInterval); sessionValidationInterval = null; } }

async function validateSession(session) {
    if (!session?.userId || !session?.expiresAt) return false;
    if (Date.now() > session.expiresAt) return false;
    try {
        const r = await fetch(`${supabaseUrl}/rest/v1/users?select=id,username,password&id=eq.${session.userId}`,
            { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
        const data = await r.json();
        if (!r.ok || !data.length) return false;
        if (data[0].password !== session.plainPassword) return false;
        session.username = data[0].username; session.lastValidatedAt = Date.now(); saveSession(session);
        return true;
    } catch { return true; }
}

function startSessionValidation() {
    stopSessionValidation();
    sessionValidationInterval = setInterval(async () => {
        if (!await validateSession(loadSession())) logout({ silent: false, reason: 'Session expirée, veuillez vous reconnecter.' });
    }, SESSION_CHECK_INTERVAL_MS);
}

async function restoreSession() {
    const session = loadSession();
    if (!session) return false;
    if (!await validateSession(session)) { clearSession(); return false; }
    currentUserId = session.userId;
    users[session.userId] = { id: session.userId, username: session.username };
    loginContainer.style.display  = 'none';
    connectedUser.style.display   = 'flex';
    connectedUsername.textContent  = session.username;
    await requestNotificationPermission();
    getMessages(); refreshMessages(); startSessionValidation(); startPresence();
    // Préchauffage géoloc en arrière-plan
    getGeolocationCached().catch(() => {});
    return true;
}

// ============================================================
// PRÉSENCE
// ============================================================
async function sendHeartbeat() {
    if (!currentUserId) return;
    const now = new Date().toISOString();
    try {
        const check = await fetch(`${supabaseUrl}/rest/v1/user_presence?user_id=eq.${currentUserId}&select=user_id`,
            { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
        const rows = await check.json();
        const method = rows.length > 0 ? 'PATCH' : 'POST';
        const url    = rows.length > 0 ? `${supabaseUrl}/rest/v1/user_presence?user_id=eq.${currentUserId}` : `${supabaseUrl}/rest/v1/user_presence`;
        const body   = rows.length > 0 ? { last_seen: now } : { user_id: currentUserId, last_seen: now };
        await fetch(url, { method, headers: { 'Content-Type': 'application/json', apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, Prefer: 'return=minimal' }, body: JSON.stringify(body) });
    } catch {}
}

async function fetchOnlineUsers() {
    try {
        const since = new Date(Date.now() - ONLINE_THRESHOLD_SECONDS * 1000).toISOString();
        const r = await fetch(`${supabaseUrl}/rest/v1/user_presence?select=user_id&last_seen=gte.${since}`,
            { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
        const data = await r.json();
        if (r.ok) onlineUsers = new Set(data.map(row => row.user_id));
    } catch {}
}

async function fetchUnreadByUser() {
    if (!currentUserId) return;
    try {
        const r = await fetch(`${supabaseUrl}/rest/v1/messages?select=id_sent&id_received=eq.${currentUserId}&read_at=is.null`,
            { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
        const data = await r.json();
        if (!r.ok) return;
        const map = new Map();
        data.forEach(msg => { if (msg.id_sent !== userSelect.value) map.set(msg.id_sent, (map.get(msg.id_sent) || 0) + 1); });
        usersWithUnread = map;
    } catch {}
}

function updatePresenceUI_display() {
    Array.from(userSelect.options).forEach(opt => {
        const uid = opt.value, user = users[uid]; if (!user) return;
        if      (usersWithUnread.has(uid)) opt.textContent = `🔴 ${user.username}`;
        else if (onlineUsers.has(uid))     opt.textContent = `🟢 ${user.username}`;
        else                               opt.textContent = user.username;
    });
    const wrapper = document.querySelector('.user-selection');
    if (wrapper) {
        wrapper.querySelectorAll('.status-pill').forEach(el => el.remove());
        const selId = userSelect.value;
        if (selId) {
            const pill = document.createElement('span');
            pill.className = 'status-pill';
            if (usersWithUnread.has(selId)) { pill.textContent = usersWithUnread.get(selId); pill.dataset.status = 'unread'; pill.title = `${usersWithUnread.get(selId)} message(s) non lu(s)`; wrapper.appendChild(pill); }
            else if (onlineUsers.has(selId)) { pill.dataset.status = 'online'; pill.title = 'En ligne'; wrapper.appendChild(pill); }
        }
    }
    document.querySelectorAll('.unread-total-badge').forEach(el => el.remove());
    const total = [...usersWithUnread.values()].reduce((a, b) => a + b, 0);
    if (total > 0) {
        const badge = document.createElement('span');
        badge.className = 'unread-total-badge'; badge.textContent = total > 99 ? '99+' : total;
        badge.title = `${total} message(s) non lu(s)`;
        userSelect.insertAdjacentElement('beforebegin', badge);
    }
}

async function refreshPresence() { await Promise.all([fetchOnlineUsers(), fetchUnreadByUser()]); updatePresenceUI_display(); }
function startPresence() { stopPresence(); sendHeartbeat(); heartbeatInterval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS); refreshPresence(); presenceInterval = setInterval(refreshPresence, 5000); }
function stopPresence()  { if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; } if (presenceInterval) { clearInterval(presenceInterval); presenceInterval = null; } }
function clearPresenceUI() {
    Array.from(userSelect.options).forEach(opt => { if (opt.value && users[opt.value]) opt.textContent = users[opt.value].username; });
    document.querySelectorAll('.status-pill, .unread-total-badge').forEach(el => el.remove());
    onlineUsers = new Set(); usersWithUnread = new Map();
}

// ============================================================
// EMOJI PICKER
// ============================================================
function initEmojiPicker() {
    const picker = document.querySelector('emoji-picker');
    if (!picker) return;
    picker.addEventListener('emoji-click', e => {
        const pos    = messageInput.selectionStart ?? messageInput.value.length;
        const rawPos = Math.min(pos, rawInputText.length);
        rawInputText = rawInputText.slice(0, rawPos) + e.detail.unicode + rawInputText.slice(rawPos);
        applyFontToInput(); prevConvertedValue = messageInput.value;
        const newPos = pos + e.detail.unicode.length;
        try { messageInput.setSelectionRange(newPos, newPos); } catch {}
        messageInput.focus();
    });
}
function openEmojiPicker() {
    if (!emojiPickerOverlay) {
        emojiPickerOverlay = document.createElement('div');
        emojiPickerOverlay.className = 'emoji-picker-overlay';
        emojiPickerOverlay.addEventListener('click', closeEmojiPicker);
        document.body.appendChild(emojiPickerOverlay);
    }
    emojiPickerWrapper.style.display = 'block';
    emojiPickerWrapper.classList.remove('hiding');
    emojiButton.classList.add('active');
}
function closeEmojiPicker() {
    emojiPickerWrapper.classList.add('hiding');
    emojiButton.classList.remove('active');
    setTimeout(() => { emojiPickerWrapper.style.display = 'none'; emojiPickerWrapper.classList.remove('hiding'); }, 200);
    if (emojiPickerOverlay?.parentNode) { emojiPickerOverlay.parentNode.removeChild(emojiPickerOverlay); emojiPickerOverlay = null; }
}
function toggleEmojiPicker() { emojiPickerWrapper.style.display !== 'none' ? closeEmojiPicker() : openEmojiPicker(); }

document.addEventListener('DOMContentLoaded', initEmojiPicker);
emojiButton.addEventListener('click', e => { e.stopPropagation(); toggleEmojiPicker(); });
document.addEventListener('click', e => {
    if (!emojiPickerWrapper.contains(e.target) && e.target !== emojiButton)
        if (emojiPickerWrapper.style.display !== 'none') closeEmojiPicker();
});

// ============================================================
// NOTIFICATIONS PUSH
// ============================================================
async function requestNotificationPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission !== 'denied') return (await Notification.requestPermission()) === 'granted';
    return false;
}
function showNotification(title, body) {
    if (Notification.permission === 'granted' && document.hidden) {
        const n = new Notification(title, { body, tag: 'msg', requireInteraction: false, silent: false });
        n.onclick = () => { window.focus(); n.close(); };
        setTimeout(() => n.close(), 5000);
    }
}

// ============================================================
// UTILISATEURS
// ============================================================
async function getUsers() {
    const r = await fetch(`${supabaseUrl}/rest/v1/users?select=id,username`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
    const data = await r.json();
    if (!r.ok) { console.error('getUsers:', data); return; }
    userSelect.innerHTML = '';
    data.forEach(user => {
        users[user.id] = user;
        const opt = document.createElement('option');
        opt.value = user.id; opt.textContent = user.username;
        userSelect.appendChild(opt);
    });
    if (currentUserId) refreshPresence();
}

// ============================================================
// TYPING INDICATOR
// ============================================================
async function updateTypingStatus(isTypingNow) {
    if (!currentUserId || !userSelect.value) return;
    try {
        const check = await fetch(`${supabaseUrl}/rest/v1/typing_status?user_id=eq.${currentUserId}&recipient_id=eq.${userSelect.value}`,
            { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
        const existing = await check.json();
        const body = JSON.stringify({ is_typing: isTypingNow, updated_at: new Date().toISOString() });
        if (existing.length > 0) {
            await fetch(`${supabaseUrl}/rest/v1/typing_status?user_id=eq.${currentUserId}&recipient_id=eq.${userSelect.value}`,
                { method: 'PATCH', headers: { 'Content-Type': 'application/json', apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` }, body });
        } else {
            await fetch(`${supabaseUrl}/rest/v1/typing_status`,
                { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, Prefer: 'return=minimal' },
                  body: JSON.stringify({ user_id: currentUserId, recipient_id: userSelect.value, is_typing: isTypingNow, updated_at: new Date().toISOString() }) });
        }
    } catch (e) { console.error('updateTypingStatus:', e); }
}

async function checkTypingStatus() {
    if (!currentUserId || !userSelect.value) { typingIndicator.style.display = 'none'; return; }
    try {
        const r = await fetch(`${supabaseUrl}/rest/v1/typing_status?user_id=eq.${userSelect.value}&recipient_id=eq.${currentUserId}&select=*`,
            { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
        const data = await r.json();
        if (data.length > 0 && data[0].is_typing && (Date.now() - new Date(data[0].updated_at)) / 1000 < 3) {
            const name = users[userSelect.value]?.username || 'L\'utilisateur';
            typingIndicator.innerHTML = `<span>${name} est en train d'écrire</span><span class="typing-dots"><span></span><span></span><span></span></span>`;
            typingIndicator.style.display = 'flex';
        } else {
            typingIndicator.style.display = 'none';
        }
    } catch (e) { console.error('checkTypingStatus:', e); }
}

messageInput.addEventListener('input', e => {
    handleFontInput(e);
    if (!isTyping) { isTyping = true; updateTypingStatus(true); }
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => { isTyping = false; updateTypingStatus(false); }, 2000);
});

// ============================================================
// RÉPONSES RAPIDES
// ============================================================
function generateQuickReplies(lastMessage) {
    if (!lastMessage || lastMessage.id_sent === currentUserId) { quickReplies.style.display = 'none'; return; }
    const content = lastMessage.content.toLowerCase().trim();
    if (content.startsWith('{"type":"__voice__"')) { quickReplies.style.display = 'none'; return; }
    if (content.length < 3) { quickReplies.style.display = 'none'; return; }
    const patterns = {
        greeting:     { kw: ['bonjour','salut','hello','coucou','bonsoir'],       r: ['👋 Bonjour !','Salut !','Hello !','Ça va ?'] },
        thanks:       { kw: ['merci','thanks','thx'],                             r: ['De rien !','Avec plaisir !','😊','Pas de souci !'] },
        howareyou:    { kw: ['comment vas','ça va','tu vas'],                     r: ['Très bien merci !','Ça va et toi ?','Super !'] },
        agreement:    { kw: ['ok','oui','yes',"d'accord"],                        r: ['Parfait !','👍','Super !','Génial !'] },
        disagreement: { kw: ['non','no',"pas d'accord"],                          r: ["D'accord",'Pas de souci','Compris'] },
        apology:      { kw: ['désolé','sorry','pardon'],                          r: ['Pas grave !',"T'inquiète pas",'Aucun souci'] },
        laugh:        { kw: ['haha','lol','mdr'],                                 r: ['😂','Haha oui','Trop marrant'] },
        planning:     { kw: ['demain','ce soir','weekend','plan','rendez-vous'],  r: ['Avec plaisir','Super idée','Je suis partant'] },
        tired:        { kw: ['occupé','fatigue','dormir','pas le temps'],         r: ['Pas grave','À plus tard','Dors bien !'] },
        help:         { kw: ['aide','help','besoin'],                             r: ['Bien sûr !','Avec plaisir','Je suis là'] },
        default:      { kw: [],                                                   r: ['👍','❤️','😊','🔥','Cool','Oui'] },
    };
    const kwMap = {};
    Object.entries(patterns).forEach(([cat, p]) => p.kw.forEach(k => { kwMap[k] = cat; }));
    const matched = new Set();
    content.split(/\s+/).forEach(w => { if (kwMap[w]) matched.add(kwMap[w]); });
    if (!matched.size) matched.add('default');
    const selected = [];
    for (const cat of matched) {
        for (const reply of patterns[cat].r) {
            if (selected.length >= 4) break;
            if (!selected.includes(reply)) selected.push(reply);
        }
        if (selected.length >= 4) break;
    }
    if (!selected.length) { quickReplies.style.display = 'none'; return; }
    quickReplies.innerHTML = '';
    selected.forEach(reply => {
        const btn = document.createElement('button');
        btn.className = 'quick-reply-btn'; btn.textContent = reply;
        btn.addEventListener('click', () => { messageInput.value = reply; rawInputText = reply; prevConvertedValue = reply; handleSend(); quickReplies.style.display = 'none'; });
        quickReplies.appendChild(btn);
    });
    quickReplies.style.display = 'flex';
}

// ============================================================
// ACCUSÉS DE RÉCEPTION
// ============================================================
async function markMessagesAsRead() {
    if (!currentUserId || !userSelect.value) return;
    try {
        await fetch(`${supabaseUrl}/rest/v1/messages?id_sent=eq.${userSelect.value}&id_received=eq.${currentUserId}&read_at=is.null`,
            { method: 'PATCH', headers: { 'Content-Type': 'application/json', apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, Prefer: 'return=minimal' },
              body: JSON.stringify({ read_at: new Date().toISOString() }) });
        await fetchUnreadByUser(); updatePresenceUI_display();
    } catch (e) { console.error('markMessagesAsRead:', e); }
}

// ============================================================
// MESSAGES VOCAUX — Parsing
// ============================================================
function parseVoiceMessage(content) {
    if (!content || !content.startsWith('{')) return null;
    try { const obj = JSON.parse(content); if (obj.type === '__voice__') return obj; } catch {}
    return null;
}

function formatVoiceDuration(seconds) {
    const s = Math.round(Math.max(0, seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function generateStaticWaveform(duration, width) {
    const bars = Math.max(30, Math.min(60, Math.floor((width || 200) / 4)));
    const seed  = Math.floor(duration * 100);
    let rng = seed;
    function pseudoRand() { rng = (rng * 1664525 + 1013904223) & 0xFFFFFFFF; return (rng >>> 0) / 0xFFFFFFFF; }
    return Array.from({ length: bars }, (_, i) => pseudoRand() * (Math.sin((i / bars) * Math.PI) * 0.7 + 0.3));
}

function drawStaticWaveform(canvas, data, progress, isSent) {
    canvas.width  = canvas.offsetWidth  || 160;
    canvas.height = canvas.offsetHeight || 32;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height, bars = data.length, barW = W / bars;
    ctx.clearRect(0, 0, W, H);
    data.forEach((val, i) => {
        const barH  = Math.max(3, val * H * 0.85);
        const y     = (H - barH) / 2;
        const played = i / bars < progress;
        ctx.fillStyle = played
            ? (isSent ? 'rgba(0,0,0,0.55)' : '#6ee7b7')
            : (isSent ? 'rgba(0,0,0,0.22)' : 'rgba(110,231,183,0.32)');
        ctx.beginPath();
        ctx.roundRect(i * barW + barW * 0.15, y, barW * 0.7, barH, 2);
        ctx.fill();
    });
}

function createVoiceMessagePlayer(voiceData, isSent) {
    const wrap = document.createElement('div');
    wrap.className = 'voice-message-player';

    const playBtn = document.createElement('button');
    playBtn.className = 'vmp-play-btn';
    playBtn.textContent = '▶';

    const waveWrap = document.createElement('div');
    waveWrap.className = 'vmp-waveform-container';
    const canvas = document.createElement('canvas');
    waveWrap.appendChild(canvas);

    const info = document.createElement('div');
    info.className = 'vmp-info';

    const durSpan = document.createElement('span');
    durSpan.className = 'vmp-duration';
    durSpan.textContent = formatVoiceDuration(voiceData.duration || 0);

    const speedBtn = document.createElement('button');
    speedBtn.className = 'vmp-speed-btn';
    speedBtn.textContent = '1x';

    if (voiceData.effect && voiceData.effect !== 'normal') {
        const effectBadge = document.createElement('span');
        effectBadge.className = 'vmp-effect-badge';
        effectBadge.textContent = VOICE_EFFECTS[voiceData.effect]?.label || voiceData.effect;
        info.appendChild(effectBadge);
    }
    info.appendChild(durSpan);
    info.appendChild(speedBtn);
    wrap.appendChild(playBtn);
    wrap.appendChild(waveWrap);
    wrap.appendChild(info);

    const audio = new Audio(voiceData.data || voiceData.url);
    let playbackRate = 1, isPlaying = false, animId = null;

    const waveData = generateStaticWaveform(voiceData.duration || 10, 160);
    setTimeout(() => drawStaticWaveform(canvas, waveData, 0, isSent), 60);

    speedBtn.addEventListener('click', () => {
        const speeds = [1, 1.5, 2];
        playbackRate = speeds[(speeds.indexOf(playbackRate) + 1) % speeds.length];
        audio.playbackRate = playbackRate;
        speedBtn.textContent = `${playbackRate}x`;
    });

    playBtn.addEventListener('click', async () => {
        if (isPlaying) {
            audio.pause(); isPlaying = false; playBtn.textContent = '▶';
            cancelAnimationFrame(animId);
            drawStaticWaveform(canvas, waveData, audio.currentTime / (voiceData.duration || 1), isSent);
        } else {
            audio.playbackRate = playbackRate;
            await audio.play().catch(e => console.warn('[Voice] play:', e));
            isPlaying = true; playBtn.textContent = '⏸';
            animatePlay();
        }
    });

    audio.addEventListener('ended', () => {
        isPlaying = false; playBtn.textContent = '▶';
        cancelAnimationFrame(animId);
        drawStaticWaveform(canvas, waveData, 0, isSent);
        durSpan.textContent = formatVoiceDuration(voiceData.duration || 0);
    });

    waveWrap.addEventListener('click', e => {
        const pct = (e.clientX - waveWrap.getBoundingClientRect().left) / waveWrap.offsetWidth;
        audio.currentTime = pct * (voiceData.duration || audio.duration || 0);
        drawStaticWaveform(canvas, waveData, pct, isSent);
    });

    function animatePlay() {
        animId = requestAnimationFrame(animatePlay);
        const dur = voiceData.duration || audio.duration || 1;
        drawStaticWaveform(canvas, waveData, audio.currentTime / dur, isSent);
        durSpan.textContent = formatVoiceDuration(dur - audio.currentTime);
    }

    return wrap;
}

// ============================================================
// MESSAGES VOCAUX — Enregistrement
// ============================================================
function getVoiceSupportedMimeType() {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    for (const t of types) { if (MediaRecorder.isTypeSupported(t)) return t; }
    return 'audio/webm';
}

function getEventCoords(e) {
    if (e.touches && e.touches.length > 0)    return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    if (e.changedTouches && e.changedTouches.length > 0) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    return { x: e.clientX, y: e.clientY };
}

function onVoicePressStart(e) {
    if (isRecording) return;
    if (e.type === 'touchstart') e.preventDefault();
    const { x, y } = getEventCoords(e);
    slideStartX = x; slideStartY = y;
    pressBtnTimer = setTimeout(() => startVoiceRecording(), PRESS_DURATION_MS);
    document.getElementById('voice-record-btn').style.transform = 'scale(0.9)';
}

function onVoicePressEnd(e) {
    clearTimeout(pressBtnTimer);
    document.getElementById('voice-record-btn').style.transform = '';
    hideVoiceSlideIndicator();
    if (isRecording && !isVoiceLocked) {
        const { x } = getEventCoords(e);
        if (x - slideStartX < SLIDE_CANCEL_PX) cancelVoiceRecording();
        else stopVoiceAndSend();
    }
}

function onVoicePressMove(e) {
    if (!isRecording || isVoiceLocked) return;
    if (e.type === 'touchmove') e.preventDefault();
    const { x, y } = getEventCoords(e);
    const dx = x - slideStartX, dy = y - slideStartY;
    const indicator = document.getElementById('voice-slide-indicator');

    if (dx < -20) {
        indicator.textContent = '← Relâcher pour annuler';
        indicator.style.color = `rgba(239,68,68,${0.5 + Math.min(Math.abs(dx) / 60, 1) * 0.5})`;
        indicator.classList.add('show');
    } else if (dy < -20) {
        const pct = Math.min(Math.abs(dy) / 50, 1);
        if (pct >= 1) { lockVoiceRecording(); return; }
        indicator.textContent = '↑ Relâcher pour verrouiller';
        indicator.style.color = 'var(--accent)';
        indicator.classList.add('show');
    } else {
        indicator.classList.remove('show');
    }
}

function hideVoiceSlideIndicator() {
    document.getElementById('voice-slide-indicator')?.classList.remove('show');
}

async function startVoiceRecording() {
    try {
        recordingStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 44100 }
        });
    } catch {
        alert('Microphone inaccessible. Vérifiez les permissions du navigateur.'); return;
    }

    voiceAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    voiceAnalyserNode = voiceAudioContext.createAnalyser();
    voiceAnalyserNode.fftSize = 256;
    voiceGainNode = voiceAudioContext.createGain();
    voiceGainNode.gain.value = 1.2;
    voiceFilterNode = voiceAudioContext.createBiquadFilter();
    voiceFilterNode.type = 'highpass';
    voiceFilterNode.frequency.value = 80;

    const source = voiceAudioContext.createMediaStreamSource(recordingStream);
    source.connect(voiceGainNode);
    voiceGainNode.connect(voiceAnalyserNode);
    voiceGainNode.connect(voiceFilterNode);

    mediaRecorder = new MediaRecorder(recordingStream, { mimeType: getVoiceSupportedMimeType() });
    audioChunks = [];
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.start(100);

    isRecording = true; isPaused = false; isVoiceLocked = false;
    pausedDuration = 0; pauseStartTime = null;
    recordingStartTime = Date.now();

    const micBtn = document.getElementById('voice-record-btn');
    micBtn.classList.add('recording');
    micBtn.innerHTML = '⏹';

    document.getElementById('voice-slide-hint').classList.add('visible');
    startVoiceTimer();
}

function lockVoiceRecording() {
    if (!isRecording || isVoiceLocked) return;
    isVoiceLocked = true;
    const micBtn = document.getElementById('voice-record-btn');
    micBtn.classList.remove('recording');
    micBtn.classList.add('locked');
    micBtn.innerHTML = '🔒';
    document.getElementById('voice-slide-hint').classList.remove('visible');
    document.getElementById('voice-locked-bar').classList.add('visible');
    startVoiceWaveform();
    hideVoiceSlideIndicator();
}

function toggleVoicePause() {
    if (!isRecording) return;
    const btn = document.getElementById('vlb-pause-btn');
    if (isPaused) {
        mediaRecorder.resume(); isPaused = false;
        if (pauseStartTime) { pausedDuration += Date.now() - pauseStartTime; pauseStartTime = null; }
        btn.textContent = '⏸ Pause'; btn.classList.remove('paused');
        startVoiceWaveform();
    } else {
        mediaRecorder.pause(); isPaused = true;
        pauseStartTime = Date.now();
        btn.textContent = '▶ Reprendre'; btn.classList.add('paused');
        cancelAnimationFrame(waveformAnimId);
    }
}

function cancelVoiceRecording() { cleanupVoiceRecording(); audioChunks = []; }

function stopVoiceAndSend() {
    if (!isRecording) return;
    const durationSeconds = Math.round((Date.now() - recordingStartTime - pausedDuration) / 1000);
    mediaRecorder.onstop = async () => {
        const mimeType = getVoiceSupportedMimeType();
        const blob = new Blob(audioChunks, { type: mimeType });
        audioChunks = [];
        await processAndSendVoice(blob, mimeType, durationSeconds);
    };
    mediaRecorder.stop();
    cleanupVoiceRecording();
}

function cleanupVoiceRecording() {
    isRecording = false; isPaused = false; isVoiceLocked = false;
    if (recordingStream) { recordingStream.getTracks().forEach(t => t.stop()); recordingStream = null; }
    if (voiceAudioContext) { voiceAudioContext.close(); voiceAudioContext = null; }
    voiceAnalyserNode = null; voiceGainNode = null; voiceFilterNode = null;
    cancelAnimationFrame(waveformAnimId);
    clearInterval(recordingTimer); recordingTimer = null; recordingStartTime = null;
    stopVoiceAmbianceSound();

    const micBtn = document.getElementById('voice-record-btn');
    if (micBtn) { micBtn.classList.remove('recording', 'locked'); micBtn.innerHTML = '🎙️'; micBtn.style.transform = ''; }
    document.getElementById('voice-slide-hint')?.classList.remove('visible');
    document.getElementById('voice-locked-bar')?.classList.remove('visible');
    document.getElementById('voice-effects-panel')?.classList.remove('visible');
    const vlbTimer = document.getElementById('vlb-timer');
    const hintTimer = document.getElementById('voice-hint-timer');
    if (vlbTimer)  vlbTimer.textContent  = '0:00';
    if (hintTimer) hintTimer.textContent = '0:00';
    const pauseBtn = document.getElementById('vlb-pause-btn');
    if (pauseBtn) { pauseBtn.textContent = '⏸ Pause'; pauseBtn.classList.remove('paused'); }
    hideVoiceSlideIndicator();
}

function startVoiceTimer() {
    clearInterval(recordingTimer);
    recordingTimer = setInterval(() => {
        if (!recordingStartTime) return;
        const elapsed = Math.floor((Date.now() - recordingStartTime - pausedDuration) / 1000);
        const text = formatVoiceDuration(elapsed);
        const hintTimer = document.getElementById('voice-hint-timer');
        const vlbTimer  = document.getElementById('vlb-timer');
        if (hintTimer) hintTimer.textContent = text;
        if (vlbTimer)  vlbTimer.textContent  = text;
        if (elapsed >= MAX_VOICE_DURATION) stopVoiceAndSend();
    }, 500);
}

function startVoiceWaveform() {
    cancelAnimationFrame(waveformAnimId);
    const canvas = document.getElementById('vlb-waveform-canvas');
    if (!canvas || !voiceAnalyserNode) return;
    const ctx = canvas.getContext('2d');
    const buf = new Uint8Array(voiceAnalyserNode.frequencyBinCount);
    function draw() {
        if (!isRecording || isPaused) return;
        waveformAnimId = requestAnimationFrame(draw);
        voiceAnalyserNode.getByteTimeDomainData(buf);
        canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight;
        const W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        ctx.beginPath(); ctx.strokeStyle = 'rgba(239,68,68,0.85)'; ctx.lineWidth = 1.5;
        const step = W / buf.length;
        buf.forEach((v, i) => {
            const y = ((v / 128 - 1) * H * 0.45) + H / 2;
            i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(i * step, y);
        });
        ctx.stroke();
    }
    draw();
}

async function processAndSendVoice(blob, mimeType, durationSeconds) {
    let processedBlob = blob;
    if (voiceEffect !== 'normal') {
        try { processedBlob = await applyVoiceEffectDSP(blob); } catch { processedBlob = blob; }
    }

    const arrayBuffer = await processedBlob.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    let base64 = '';
    const chunkSize = 8192;
    for (let i = 0; i < uint8.length; i += chunkSize) {
        base64 += String.fromCharCode(...uint8.subarray(i, i + chunkSize));
    }
    const dataUrl = `data:${processedBlob.type || mimeType};base64,${btoa(base64)}`;

    if (!currentUserId || !userSelect.value) { alert('Connectez-vous pour envoyer un message vocal.'); return; }

    const voicePayload = JSON.stringify({
        type: '__voice__', data: dataUrl, mime: mimeType,
        duration: durationSeconds, effect: voiceEffect
    });

    await sendMessage(currentUserId, voicePayload);
}

async function applyVoiceEffectDSP(blob) {
    const effect = VOICE_EFFECTS[voiceEffect] || VOICE_EFFECTS.normal;
    const arrayBuffer = await blob.arrayBuffer();
    const tmpCtx = new OfflineAudioContext(1, 44100 * MAX_VOICE_DURATION, 44100);
    let decoded;
    try { decoded = await tmpCtx.decodeAudioData(arrayBuffer.slice(0)); } catch { return blob; }

    const offlineCtx = new OfflineAudioContext(1, Math.max(decoded.length, 1024), 44100);
    const source = offlineCtx.createBufferSource();
    source.buffer = decoded;
    source.playbackRate.value = effect.pitch;

    if (effect.robot) {
        const waveshaper = offlineCtx.createWaveShaper();
        const n = 256; const curve = new Float32Array(n);
        for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; curve[i] = (Math.PI + 100) * x / (Math.PI + 100 * Math.abs(x)); }
        waveshaper.curve = curve; waveshaper.oversample = '4x';
        source.connect(waveshaper); waveshaper.connect(offlineCtx.destination);
    } else {
        source.connect(offlineCtx.destination);
    }
    source.start(0);

    const rendered = await offlineCtx.startRendering();
    return audioBufferToWav(rendered);
}

function audioBufferToWav(buffer) {
    const numCh = buffer.numberOfChannels, sr = buffer.sampleRate, data = buffer.getChannelData(0);
    const byteLen = 44 + data.length * 2, ab = new ArrayBuffer(byteLen), view = new DataView(ab);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    ws(0,'RIFF'); view.setUint32(4,36+data.length*2,true); ws(8,'WAVE'); ws(12,'fmt ');
    view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,numCh,true);
    view.setUint32(24,sr,true); view.setUint32(28,sr*numCh*2,true);
    view.setUint16(32,numCh*2,true); view.setUint16(34,16,true); ws(36,'data');
    view.setUint32(40,data.length*2,true);
    let off = 44;
    for (let i = 0; i < data.length; i++) {
        const s = Math.max(-1,Math.min(1,data[i]));
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true); off += 2;
    }
    return new Blob([ab], { type: 'audio/wav' });
}

function startVoiceAmbianceSound(type) {
    stopVoiceAmbianceSound();
    if (!voiceAudioContext || !type || type === 'none') return;
    if (type === 'rain') {
        const noise = createVoiceNoise(voiceAudioContext, 0.08);
        const f = voiceAudioContext.createBiquadFilter();
        f.type = 'bandpass'; f.frequency.value = 1200; f.Q.value = 0.3;
        noise.connect(f); f.connect(voiceAudioContext.destination);
        ambianceNodes.push(noise, f);
    } else if (type === 'space') {
        [80, 120, 160].forEach(freq => {
            const osc = voiceAudioContext.createOscillator();
            const g = voiceAudioContext.createGain();
            osc.type = 'sine'; osc.frequency.value = freq; g.gain.value = 0.02;
            osc.connect(g); g.connect(voiceAudioContext.destination); osc.start();
            ambianceNodes.push(osc, g);
        });
    } else if (type === 'cafe') {
        const noise = createVoiceNoise(voiceAudioContext, 0.04);
        const f = voiceAudioContext.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = 600;
        noise.connect(f); f.connect(voiceAudioContext.destination);
        ambianceNodes.push(noise, f);
    } else if (type === 'forest') {
        [600, 800, 1200].forEach(freq => {
            const osc = voiceAudioContext.createOscillator();
            const g = voiceAudioContext.createGain();
            osc.type = 'sine'; osc.frequency.value = freq; g.gain.value = 0.01;
            osc.connect(g); g.connect(voiceAudioContext.destination); osc.start();
            ambianceNodes.push(osc, g);
        });
    }
}

function stopVoiceAmbianceSound() {
    ambianceNodes.forEach(n => { try { if (n.stop) n.stop(); n.disconnect(); } catch {} });
    ambianceNodes = [];
}

function createVoiceNoise(ctx, volume) {
    const sz = ctx.sampleRate * 2, buf = ctx.createBuffer(1, sz, ctx.sampleRate), data = buf.getChannelData(0);
    for (let i = 0; i < sz; i++) data[i] = (Math.random() * 2 - 1) * volume;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true; src.start();
    return src;
}

// ============================================================
// MESSAGES VOCAUX — Injection UI
// ============================================================
function injectVoiceUI() {
    const chatContainer = document.querySelector('.chat-container');
    const chatInputEl   = document.querySelector('.chat-input');
    const sendBtn       = document.getElementById('send-button');
    if (!chatContainer || !chatInputEl || !sendBtn) return;

    const effectsPanel = document.createElement('div');
    effectsPanel.id = 'voice-effects-panel';
    effectsPanel.innerHTML = `
        <div class="vep-section">
            <div class="vep-label">🎤 Voix</div>
            <div class="vep-chips">
                ${Object.entries(VOICE_EFFECTS).map(([k,v]) =>
                    `<button class="vep-chip voice-chip ${k==='normal'?'active':''}" data-effect="${k}">${v.label}</button>`
                ).join('')}
            </div>
        </div>
        <div class="vep-section">
            <div class="vep-label">🌍 Ambiance</div>
            <div class="vep-chips">
                <button class="vep-chip ambiance-chip active" data-ambiance="none">🔇 Aucune</button>
                <button class="vep-chip ambiance-chip" data-ambiance="rain">🌧️ Pluie</button>
                <button class="vep-chip ambiance-chip" data-ambiance="cafe">☕ Café</button>
                <button class="vep-chip ambiance-chip" data-ambiance="forest">🌲 Forêt</button>
                <button class="vep-chip ambiance-chip" data-ambiance="space">🚀 Espace</button>
            </div>
        </div>`;
    chatContainer.insertBefore(effectsPanel, chatInputEl);

    const lockedBar = document.createElement('div');
    lockedBar.id = 'voice-locked-bar';
    lockedBar.innerHTML = `
        <div class="vlb-row">
            <span class="vlb-rec-dot"></span>
            <span class="vlb-timer" id="vlb-timer">0:00</span>
            <div class="vlb-waveform"><canvas id="vlb-waveform-canvas"></canvas></div>
        </div>
        <div class="vlb-row vlb-actions">
            <button class="vlb-btn danger" id="vlb-cancel-btn">✕ Annuler</button>
            <button class="vlb-btn pause-btn" id="vlb-pause-btn">⏸ Pause</button>
            <button class="vlb-btn" id="vlb-effects-btn">🎛️ Effets</button>
            <button class="vlb-btn primary" id="vlb-send-btn" style="margin-left:auto;">Envoyer ▶</button>
        </div>`;
    chatContainer.insertBefore(lockedBar, chatInputEl);

    const slideHint = document.createElement('div');
    slideHint.id = 'voice-slide-hint';
    slideHint.innerHTML = `
        <span class="hint-cancel">← Annuler</span>
        <span class="hint-timer" id="voice-hint-timer">0:00</span>
        <span class="hint-lock">↑ Verrouiller</span>`;
    chatContainer.insertBefore(slideHint, chatInputEl);

    const slideInd = document.createElement('div');
    slideInd.className = 'voice-slide-indicator';
    slideInd.id = 'voice-slide-indicator';
    chatContainer.appendChild(slideInd);

    const micBtn = document.createElement('button');
    micBtn.id = 'voice-record-btn';
    micBtn.title = 'Message vocal (maintenir appuyé)';
    micBtn.innerHTML = '🎙️';
    chatInputEl.insertBefore(micBtn, sendBtn);

    micBtn.addEventListener('mousedown', onVoicePressStart);
    micBtn.addEventListener('touchstart', onVoicePressStart, { passive: false });
    document.addEventListener('mouseup',   onVoicePressEnd);
    document.addEventListener('touchend',  onVoicePressEnd);
    document.addEventListener('mousemove', onVoicePressMove);
    document.addEventListener('touchmove', onVoicePressMove, { passive: false });

    document.getElementById('vlb-cancel-btn').addEventListener('click', cancelVoiceRecording);
    document.getElementById('vlb-pause-btn').addEventListener('click', toggleVoicePause);
    document.getElementById('vlb-send-btn').addEventListener('click', stopVoiceAndSend);
    document.getElementById('vlb-effects-btn').addEventListener('click', () => {
        document.getElementById('voice-effects-panel').classList.toggle('visible');
    });

    effectsPanel.querySelectorAll('.voice-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            voiceEffect = chip.dataset.effect;
            effectsPanel.querySelectorAll('.voice-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
        });
    });
    effectsPanel.querySelectorAll('.ambiance-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            voiceAmbiance = chip.dataset.ambiance === 'none' ? null : chip.dataset.ambiance;
            effectsPanel.querySelectorAll('.ambiance-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            if (isRecording && voiceAudioContext) {
                voiceAmbiance ? startVoiceAmbianceSound(voiceAmbiance) : stopVoiceAmbianceSound();
            }
        });
    });
}

// ============================================================
// MESSAGES — Récupération et affichage
// ============================================================
async function deleteMessage(messageId) {
    const r = await fetch(`${supabaseUrl}/rest/v1/messages?id=eq.${messageId}`,
        { method: 'DELETE', headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
    if (r.ok) getMessages();
    else console.error('deleteMessage:', await r.json());
}

async function getMessages() {
    if (!currentUserId || !userSelect.value) { chatMessages.innerHTML = ''; currentMessages = []; lastMessageCount = 0; return; }
    const query = `${supabaseUrl}/rest/v1/messages?select=*&order=created_at.asc` +
        `&or=(and(id_sent.eq.${currentUserId},id_received.eq.${userSelect.value}),` +
        `and(id_sent.eq.${userSelect.value},id_received.eq.${currentUserId}))`;
    const r = await fetch(query, { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
    const data = await r.json();
    if (!r.ok) { console.error('getMessages:', data); return; }

    if (data.length > lastMessageCount && lastMessageCount > 0) {
        data.slice(lastMessageCount).forEach(msg => {
            if (msg.id_sent === userSelect.value && msg.id_received === currentUserId) {
                const voiceData = parseVoiceMessage(msg.content);
                const preview = voiceData ? '🎙️ Message vocal' : msg.content.substring(0, 50);
                showNotification(`Nouveau message de ${users[msg.id_sent]?.username || 'quelqu\'un'}`, preview);
            }
        });
    }
    lastMessageCount = data.length;
    await markMessagesAsRead();

    const hasChanges = data.length !== currentMessages.length ||
        data.some((m, i) => m.id !== currentMessages[i]?.id || m.read_at !== currentMessages[i]?.read_at);
    if (!hasChanges) return;

    const wasAtBottom = chatMessages.scrollHeight - chatMessages.scrollTop <= chatMessages.clientHeight + 50;
    currentMessages = data;
    renderMessages(data);
    if (wasAtBottom) chatMessages.scrollTop = chatMessages.scrollHeight;
    if (data.length > 0) generateQuickReplies(data[data.length - 1]);
}

// ============================================================
// OPTIMISATION : rendu des messages séparé et réutilisable
// ============================================================
function renderMessages(data) {
    chatMessages.innerHTML = '';
    let lastDate = null;
    const fragment = document.createDocumentFragment();

    data.forEach(message => {
        const dateObj  = new Date(message.created_at);
        const msgDate  = dateObj.toLocaleDateString('fr-FR');
        const msgTime  = dateObj.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        const isMine   = message.id_sent === currentUserId;
        const sender   = users[message.id_sent]?.username || 'Inconnu';
        const voiceData = parseVoiceMessage(message.content);

        if (msgDate !== lastDate) {
            const el = document.createElement('div');
            el.className = 'date'; el.textContent = msgDate;
            fragment.appendChild(el); lastDate = msgDate;
        }

        const msgEl = document.createElement('div');
        msgEl.classList.add('message', isMine ? 'sent' : 'received');
        if (voiceData) msgEl.classList.add('voice-msg');

        const senderSpan = document.createElement('span');
        senderSpan.className = 'msg-sender'; senderSpan.textContent = sender;

        const metaSpan = document.createElement('span');
        metaSpan.className = 'msg-meta';
        let metaText = message.city ? `📍 ${message.city} · ${msgTime}` : msgTime;
        if (isMine) {
            if (message.read_at) { metaText += ' · 👁️ Lu'; metaSpan.classList.add('read'); }
            else                  { metaText += ' · ✓ Envoyé'; metaSpan.classList.add('sent-status'); }
        }
        metaSpan.textContent = metaText;

        msgEl.appendChild(senderSpan);

        if (voiceData) {
            const player = createVoiceMessagePlayer(voiceData, isMine);
            msgEl.appendChild(player);
        } else {
            msgEl.appendChild(document.createTextNode(message.content));
        }

        msgEl.appendChild(metaSpan);

        if (isMine) {
            const del = document.createElement('span');
            del.textContent = '✖'; del.className = 'delete-button';
            del.addEventListener('click', () => deleteMessage(message.id));
            msgEl.appendChild(del);
        }
        fragment.appendChild(msgEl);
    });

    chatMessages.appendChild(fragment);
}

// ============================================================
// OPTIMISATION : affichage optimiste immédiat
// ============================================================
function appendOptimisticMessage(content) {
    const now = new Date();
    const msgTime = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const msgDate = now.toLocaleDateString('fr-FR');

    // Séparateur de date si nécessaire
    const lastDateEl = chatMessages.querySelector('.date:last-of-type');
    if (!lastDateEl || lastDateEl.textContent !== msgDate) {
        const dateEl = document.createElement('div');
        dateEl.className = 'date'; dateEl.textContent = msgDate;
        chatMessages.appendChild(dateEl);
    }

    const voiceData = parseVoiceMessage(content);
    const msgEl = document.createElement('div');
    msgEl.classList.add('message', 'sent', 'optimistic');
    if (voiceData) msgEl.classList.add('voice-msg');

    const senderSpan = document.createElement('span');
    senderSpan.className = 'msg-sender';
    senderSpan.textContent = users[currentUserId]?.username || 'Moi';

    const metaSpan = document.createElement('span');
    metaSpan.className = 'msg-meta';
    metaSpan.textContent = `${msgTime} · ⏳`;

    msgEl.appendChild(senderSpan);

    if (voiceData) {
        const player = createVoiceMessagePlayer(voiceData, true);
        msgEl.appendChild(player);
    } else {
        msgEl.appendChild(document.createTextNode(content));
    }

    msgEl.appendChild(metaSpan);
    chatMessages.appendChild(msgEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return msgEl;
}

function refreshMessages() {
    if (refreshInterval) clearInterval(refreshInterval);
    // OPTIMISATION : getMessages et checkTypingStatus en parallèle
    refreshInterval = setInterval(() => {
        Promise.all([getMessages(), checkTypingStatus()]);
    }, 1000);
}

// ============================================================
// ENVOI DE MESSAGES — Optimisé
// ============================================================
async function sendMessage(userId, content) {
    const isVoice = content.startsWith('{"type":"__voice__"');

    // OPTIMISATION : affichage optimiste immédiat (sauf vocal déjà affiché via player)
    let optimisticEl = null;
    if (!isVoice) {
        optimisticEl = appendOptimisticMessage(content);
    }

    // Annuler l'indicateur de frappe sans attendre (fire-and-forget)
    isTyping = false;
    clearTimeout(typingTimeout);
    updateTypingStatus(false); // pas de await ici

    // POST immédiat sans attendre la géoloc
    const postBody = {
        id_sent:     userId,
        content:     content,
        created_at:  new Date().toISOString(),
        id_received: userSelect.value,
        read_at:     null,
        latitude:    null,
        longitude:   null,
        city:        null
    };

    let messageId = null;
    try {
        const r = await fetch(`${supabaseUrl}/rest/v1/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: supabaseKey,
                Authorization: `Bearer ${supabaseKey}`,
                Prefer: 'return=representation'
            },
            body: JSON.stringify(postBody)
        });

        if (r.ok) {
            const inserted = await r.json();
            messageId = Array.isArray(inserted) ? inserted[0]?.id : inserted?.id;

            // Supprimer le message optimiste et recharger
            if (optimisticEl) optimisticEl.remove();
            getMessages();

            // Géoloc en arrière-plan : patch si dispo
            if (messageId) {
                getGeolocationCached().then(async geo => {
                    const city = await getCityFromCoordinates(geo.latitude, geo.longitude);
                    if (!city && !geo.latitude) return;
                    fetch(`${supabaseUrl}/rest/v1/messages?id=eq.${messageId}`, {
                        method: 'PATCH',
                        headers: {
                            'Content-Type': 'application/json',
                            apikey: supabaseKey,
                            Authorization: `Bearer ${supabaseKey}`,
                            Prefer: 'return=minimal'
                        },
                        body: JSON.stringify({ latitude: geo.latitude, longitude: geo.longitude, city })
                    }).catch(() => {});
                }).catch(() => {});
            }

            return true;
        } else {
            console.error('sendMessage:', await r.json());
            if (optimisticEl) optimisticEl.remove();
        }
    } catch (e) {
        console.error('sendMessage:', e);
        if (optimisticEl) optimisticEl.remove();
    }
    return false;
}

async function handleSend() {
    if (!currentUserId) { alert('Veuillez vous connecter pour envoyer un message'); return; }
    const content = messageInput.value.trim();
    if (!content) return;

    // Vider l'input immédiatement pour feedback instantané
    messageInput.value = '';
    messageInput.focus();
    quickReplies.style.display = 'none';
    rawInputText = ''; prevConvertedValue = '';

    await sendMessage(currentUserId, content);
}

sendButton.addEventListener('click', handleSend);
messageInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); handleSend(); } });

// ============================================================
// CONNEXION
// ============================================================
async function completeLogin(user, plainPassword) {
    currentUserId = user.id;
    users[user.id] = { id: user.id, username: user.username };
    loginContainer.style.display  = 'none';
    connectedUser.style.display   = 'flex';
    connectedUsername.textContent  = user.username;
    saveSession({ userId: user.id, username: user.username, plainPassword, refreshToken: generateRefreshToken(), issuedAt: Date.now(), expiresAt: Date.now() + SESSION_DURATION_MS, lastValidatedAt: Date.now() });
    await getUsers(); getMessages(); refreshMessages(); startSessionValidation(); startPresence();
    // Préchauffage géoloc en arrière-plan dès la connexion
    getGeolocationCached().catch(() => {});
}

async function login() {
    const username = loginUsername.value.trim(), password = loginPassword.value;
    if (!username || !password) { alert('Veuillez remplir tous les champs'); return; }
    try {
        const r = await fetch(`${supabaseUrl}/rest/v1/users?select=id,username,password&username=eq.${encodeURIComponent(username)}`,
            { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
        const data = await r.json();
        if (!r.ok)        { alert('Erreur de connexion'); return; }
        if (!data.length) { alert('Utilisateur non trouvé'); return; }
        if (data[0].password !== password) { alert('Mot de passe incorrect'); return; }
        await requestNotificationPermission();
        await completeLogin(data[0], password);
    } catch (e) { console.error('login:', e); alert('Erreur de connexion'); }
}

async function checkAutoLogin() {
    const raw = localStorage.getItem('pending_auto_login');
    if (!raw) return false;
    localStorage.removeItem('pending_auto_login');
    let pending; try { pending = JSON.parse(raw); } catch { return false; }
    if (!pending?.userId || !pending?.plainPassword) return false;
    try {
        const r = await fetch(`${supabaseUrl}/rest/v1/users?select=id,username,password&id=eq.${pending.userId}`,
            { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
        const data = await r.json();
        if (!r.ok || !data.length || data[0].password !== pending.plainPassword) return false;
        await requestNotificationPermission();
        await completeLogin(data[0], pending.plainPassword);
        return true;
    } catch { return false; }
}

// ============================================================
// DÉCONNEXION
// ============================================================
async function logout(options = {}) {
    const { silent = false, reason = '' } = options;
    if (isTyping) await updateTypingStatus(false);
    if (isRecording) cancelVoiceRecording();
    closeEmojiPicker(); closeFontPicker(); resetFont();
    currentUserId = null; isTyping = false; clearTimeout(typingTimeout);
    if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
    stopSessionValidation(); stopPresence(); clearSession(); clearPresenceUI();
    loginContainer.style.display  = 'block';
    connectedUser.style.display   = 'none';
    chatMessages.innerHTML        = '';
    currentMessages = []; lastMessageCount = 0;
    typingIndicator.style.display = 'none';
    quickReplies.style.display    = 'none';
    // Réinitialiser le cache géoloc à la déconnexion
    _geoCache = null; _geoPending = null;
    if (!silent && reason) alert(reason);
}

loginButton.addEventListener('click', login);
logoutButton.addEventListener('click', () => logout());
loginPassword.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); login(); } });

// ============================================================
// INJECTION DES BOUTONS
// ============================================================
function injectChatInputButtons() {
    const chatInput = document.querySelector('.chat-input');
    const sendBtn   = document.getElementById('send-button');
    if (!chatInput || !sendBtn) return;

    const fontBtn = document.createElement('button');
    fontBtn.id = 'font-button'; fontBtn.className = 'icon-button font-button';
    fontBtn.textContent = '🔤'; fontBtn.title = 'Style de texte'; fontBtn.type = 'button';
    fontBtn.addEventListener('click', e => { e.stopPropagation(); openFontPicker(); });
    chatInput.insertBefore(fontBtn, sendBtn);
}

// ============================================================
// INIT
// ============================================================
window.onload = async () => {
    injectChatInputButtons();
    injectVoiceUI();

    await getUsers();
    const autoLogged = await checkAutoLogin();
    if (!autoLogged) {
        const restored = await restoreSession();
        if (!restored) getMessages();
    }
};

userSelect.addEventListener('change', () => {
    currentMessages = []; lastMessageCount = 0;
    typingIndicator.style.display = 'none';
    quickReplies.style.display    = 'none';
    if (currentUserId) updatePresenceUI_display();
    getMessages();
});

window.addEventListener('beforeunload', () => {
    if (isTyping && currentUserId) updateTypingStatus(false);
    if (isRecording) cancelVoiceRecording();
});