/**
 * app.js — Messagerie Instantanée
 *
 * Correctifs :
 *  - Fix affichage date : renderMessages utilise un objet partagé pour lastDate
 *  - Partage d'écran : toggleScreenShare() via getDisplayMedia() dans l'appel WebRTC
 *  - Audio WebRTC : flux remote correctement routé via remoteAudio
 *  - Vidéo WebRTC : flux remote attaché au bon <video> element via ontrack
 *  - Partage de fichiers (photos, vidéos, images) via Supabase Storage
 *  - Bouton 📎 + accès caméra directe 📷 sur mobile
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import 'https://cdn.jsdelivr.net/npm/emoji-picker-element@^1/index.js';

// ============================================================
// CONFIG
// ============================================================
const SUPABASE_URL = 'https://ukqksglsxupbqsserylq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVrcWtzZ2xzeHVwYnFzc2VyeWxxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MDYwNTMsImV4cCI6MjA5MzQ4MjA1M30.DAlc38E9sUvr9MhpHtDjP8xeT0-50ARdPMQafTsB7fo';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    realtime: { params: { eventsPerSecond: 10 } }
});

const FILE_BUCKET = 'chat-files';
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

// ============================================================
// REFS DOM
// ============================================================
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

// ============================================================
// ÉTAT GLOBAL
// ============================================================
let users            = {};
let currentUserId    = null;
let currentMessages  = [];
let emojiPickerOverlay = null;

let msgChannel          = null;
let typingChannel       = null;
let presenceChannel     = null;
let incomingCallChannel = null;

let typingTimeout    = null;
let isTyping         = false;

let onlineUsers      = new Set();
let usersWithUnread  = new Map();
let groups           = [];
let targetMode       = 'direct';
let groupSelect      = null;
let targetModeSelect = null;
let createGroupButton = null;
let groupCallButton  = null;
let activeGroupId    = '';
let groupSchemaErrorShown = false;

const SESSION_KEY    = 'session_v2';
const SESSION_MS     = 1000 * 60 * 60 * 24 * 30;
const WELCOME_SESSION_KEY = 'welcome_screen_shown';
const GROUP_CALL_BASE_URL = 'https://meet.jit.si';
const GROUPS_TABLE = 'chat_groups';
const GROUP_MEMBERS_TABLE = 'chat_group_members';

let _geoCache  = null;
let _geoPend   = null;

// Font picker
let activeFontId        = 'normal';
let rawInputText        = '';
let prevConvertedValue  = '';
let fontPickerOpen      = false;
let fontPickerEl        = null;
let fontPickerOverlay   = null;

// ============================================================
// APPELS WEBRTC — État
// ============================================================
let callState             = 'idle';
let currentCallId         = null;
let callPeerUserId        = null;
let peerConnection        = null;
let localStream           = null;
let remoteAudio           = null;
let callTimer             = null;
let callDuration          = 0;
let isMuted               = false;
let isSpeakerOn           = false;
let callReconnectAttempts = 0;
let ringtoneInterval      = null;
let ringtoneCtx           = null;
let _pendingCallOffer     = null;

// Vidéo
let isVideoEnabled     = false;
let remoteVideoEnabled = false;
let localVideoStream   = null;
let currentFacingMode  = 'user';

// Partage d'écran
let isScreenSharing   = false;
let screenStream      = null;
let screenSharingPeer = false;

const CALL_TIMEOUT_MS = 30000;
const MAX_RECONNECT   = 3;
const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
];

const CALL_REACTIONS = ['👍','❤️','😂','😮','🔥','👏','🥳','😢'];

// Messages vocaux
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
// FONT STYLES — Unicode
// ============================================================
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
    if (!networkIndicator) return;
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
function loadSession()  { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; } }
function saveSession(s) { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
function clearSession() { localStorage.removeItem(SESSION_KEY); }

async function validateSession(session) {
    if (!session?.userId || !session?.expiresAt) return false;
    if (Date.now() > session.expiresAt) return false;
    try {
        const { data, error } = await supabase.from('users').select('id, username, password').eq('id', session.userId).single();
        if (error || !data) return false;
        if (data.password !== session.plainPassword) return false;
        session.username = data.username;
        saveSession(session);
        return true;
    } catch { return true; }
}

async function restoreSession() {
    const session = loadSession();
    if (!session) return false;
    if (!await validateSession(session)) { clearSession(); return false; }
    currentUserId = session.userId;
    users[session.userId] = { id: session.userId, username: session.username };
    showConnectedUI(session.username);
    await requestNotificationPermission();
    await getUsers();
    await refreshGroupsCache();
    refreshGroupSelector();
    refreshTargetModeUI();
    await loadInitialMessages();
    subscribeToConversation();
    subscribeToTyping();
    subscribeToPresence();
    subscribeToIncomingCalls();
    getGeolocationCached().catch(() => {});
    return true;
}

// ============================================================
// GROUPES — Gestion via Supabase
// ============================================================
function normalizeGroupMembers(memberIds = []) {
    return [...new Set((memberIds || []).map(v => String(v).trim()).filter(Boolean))];
}

function isGroupMode() {
    return targetMode === 'group';
}

function getVisibleGroups() {
    return groups;
}

function getActiveGroup() {
    if (!isGroupMode() || !groupSelect) return null;
    const gid = groupSelect.value;
    if (!gid) return null;
    return getVisibleGroups().find(g => g.id === gid) || null;
}

function parseGroupCallPayload(content) {
    if (!content || !content.startsWith('{')) return null;
    try {
        const obj = JSON.parse(content);
        return obj.type === '__group_call__' && obj.url ? obj : null;
    } catch {
        return null;
    }
}

function dedupeMessagesForCurrentThread(messages) {
    if (!isGroupMode()) return messages;
    const byLogicalId = new Map();
    for (const msg of messages) {
        const logicalId = msg.logical_id || msg.id;
        const existing = byLogicalId.get(logicalId);
        if (!existing || new Date(msg.created_at).getTime() < new Date(existing.created_at).getTime()) {
            byLogicalId.set(logicalId, msg);
        }
    }
    return [...byLogicalId.values()].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

function isMissingGroupSchemaError(error) {
    if (!error) return false;
    const msg = String(error.message || '').toLowerCase();
    return error.code === '42P01' || error.code === '42703' || msg.includes('does not exist');
}

function showGroupSchemaErrorOnce(error) {
    console.error('[Groups] schema issue:', error);
    if (groupSchemaErrorShown) return;
    groupSchemaErrorShown = true;
    alert('Tables groupes manquantes. Exécute le SQL de migration groupes puis recharge la page.');
}

async function loadGroupsFromDatabase() {
    if (!currentUserId) return [];

    const { data: memberships, error: membershipsError } = await supabase
        .from(GROUP_MEMBERS_TABLE)
        .select('group_id')
        .eq('user_id', currentUserId);

    if (membershipsError) {
        if (isMissingGroupSchemaError(membershipsError)) showGroupSchemaErrorOnce(membershipsError);
        else console.error('loadGroupsFromDatabase memberships:', membershipsError);
        return [];
    }

    const groupIds = [...new Set((memberships || []).map(row => row.group_id).filter(Boolean))];
    if (!groupIds.length) return [];

    const [{ data: groupRows, error: groupRowsError }, { data: memberRows, error: memberRowsError }] = await Promise.all([
        supabase.from(GROUPS_TABLE).select('id, name, created_by, created_at').in('id', groupIds),
        supabase.from(GROUP_MEMBERS_TABLE).select('group_id, user_id').in('group_id', groupIds)
    ]);

    if (groupRowsError || memberRowsError) {
        const err = groupRowsError || memberRowsError;
        if (isMissingGroupSchemaError(err)) showGroupSchemaErrorOnce(err);
        else console.error('loadGroupsFromDatabase rows:', err);
        return [];
    }

    const membersByGroup = new Map();
    (memberRows || []).forEach(row => {
        const gid = String(row.group_id);
        if (!membersByGroup.has(gid)) membersByGroup.set(gid, []);
        membersByGroup.get(gid).push(String(row.user_id));
    });

    return (groupRows || [])
        .map(row => ({
            id: String(row.id),
            name: String(row.name || 'Groupe').trim().slice(0, 60) || 'Groupe',
            members: normalizeGroupMembers(membersByGroup.get(String(row.id)) || []),
            createdBy: row.created_by ? String(row.created_by) : null,
            createdAt: row.created_at || null
        }))
        .filter(g => g.members.includes(String(currentUserId)))
        .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
}

async function refreshGroupsCache() {
    groups = await loadGroupsFromDatabase();
    return groups;
}

function buildGroupCallUrl(group) {
    const slug = `${group.name}-${group.id}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || group.id;
    return `${GROUP_CALL_BASE_URL}/${slug}-${Date.now().toString(36)}#config.prejoinConfig.enabled=true`;
}

// ============================================================
// PRÉSENCE — Supabase Presence
// ============================================================
function subscribeToPresence() {
    if (presenceChannel) { supabase.removeChannel(presenceChannel); presenceChannel = null; }
    presenceChannel = supabase.channel('online-users', { config: { presence: { key: currentUserId } } });
    presenceChannel
        .on('presence', { event: 'sync' }, () => {
            const state = presenceChannel.presenceState();
            onlineUsers = new Set(Object.keys(state));
            updatePresenceUI();
        })
        .on('presence', { event: 'join' }, ({ key }) => { onlineUsers.add(key); updatePresenceUI(); })
        .on('presence', { event: 'leave' }, ({ key }) => { onlineUsers.delete(key); updatePresenceUI(); })
        .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                await presenceChannel.track({ user_id: currentUserId, online_at: new Date().toISOString() });
                await fetchUnreadByUser();
                updatePresenceUI();
            }
        });
}

async function fetchUnreadByUser() {
    if (!currentUserId) return;
    try {
        const { data, error } = await supabase
            .from('messages')
            .select('id_sent')
            .eq('id_received', currentUserId)
            .is('group_id', null)
            .is('read_at', null);
        if (error) return;
        const map = new Map();
        data.forEach(msg => { if (msg.id_sent !== userSelect.value) map.set(msg.id_sent, (map.get(msg.id_sent) || 0) + 1); });
        usersWithUnread = map;
    } catch {}
}

function updatePresenceUI() {
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
        if (!isGroupMode() && selId) {
            const pill = document.createElement('span');
            pill.className = 'status-pill';
            if (usersWithUnread.has(selId)) {
                pill.textContent = usersWithUnread.get(selId); pill.dataset.status = 'unread';
                pill.title = `${usersWithUnread.get(selId)} message(s) non lu(s)`;
                wrapper.appendChild(pill);
            } else if (onlineUsers.has(selId)) {
                pill.dataset.status = 'online'; pill.title = 'En ligne'; wrapper.appendChild(pill);
            }
        }
    }
    document.querySelectorAll('.unread-total-badge').forEach(el => el.remove());
    const total = [...usersWithUnread.values()].reduce((a, b) => a + b, 0);
    if (total > 0) {
        const badge = document.createElement('span');
        badge.className = 'unread-total-badge';
        badge.textContent = total > 99 ? '99+' : total;
        badge.title = `${total} message(s) non lu(s)`;
        userSelect.insertAdjacentElement('beforebegin', badge);
    }
    updateCallButtonState();
    updateGroupCallButtonState();
}

function clearPresenceUI() {
    Array.from(userSelect.options).forEach(opt => { if (opt.value && users[opt.value]) opt.textContent = users[opt.value].username; });
    document.querySelectorAll('.status-pill, .unread-total-badge').forEach(el => el.remove());
    onlineUsers = new Set(); usersWithUnread = new Map();
}

function refreshGroupSelector() {
    if (!groupSelect) return;
    const visibleGroups = getVisibleGroups();
    const prev = groupSelect.value;
    groupSelect.innerHTML = '';
    visibleGroups.forEach(group => {
        const opt = document.createElement('option');
        opt.value = group.id;
        const others = group.members.filter(m => m !== String(currentUserId)).length;
        opt.textContent = `${group.name} (${others + 1})`;
        groupSelect.appendChild(opt);
    });
    if (visibleGroups.find(g => g.id === prev)) groupSelect.value = prev;
    else groupSelect.value = visibleGroups[0]?.id || '';
    activeGroupId = groupSelect.value || '';
    updateGroupCallButtonState();
}

function refreshTargetModeUI() {
    if (!targetModeSelect || !groupSelect || !userSelect) return;
    if (targetMode === 'group' && !groupSelect.value) {
        targetMode = 'direct';
        targetModeSelect.value = 'direct';
    }
    const groupMode = isGroupMode();
    userSelect.style.display = groupMode ? 'none' : '';
    groupSelect.style.display = groupMode ? '' : 'none';
    if (createGroupButton) createGroupButton.style.display = currentUserId ? 'inline-flex' : 'none';
    updateCallButtonState();
    updateGroupCallButtonState();
}

function updateGroupCallButtonState() {
    if (!groupCallButton) return;
    const group = getActiveGroup();
    const canCall = !!(currentUserId && isGroupMode() && group && group.members.filter(m => m !== String(currentUserId)).length > 0);
    groupCallButton.style.display = canCall ? 'flex' : 'none';
}

function hasActiveTarget() {
    if (!currentUserId) return false;
    if (isGroupMode()) return !!getActiveGroup();
    return !!userSelect.value;
}

function switchTargetMode(nextMode) {
    targetMode = nextMode === 'group' ? 'group' : 'direct';
    if (targetModeSelect) targetModeSelect.value = targetMode;
    activeGroupId = isGroupMode() ? (groupSelect?.value || '') : '';
    refreshTargetModeUI();
    currentMessages = [];
    typingIndicator.style.display = 'none';
    quickReplies.style.display = 'none';
    isTyping = false;
    clearTimeout(typingTimeout);
    if (currentUserId) {
        subscribeToConversation();
        subscribeToTyping();
        loadInitialMessages().then(() => updatePresenceUI());
    }
}

async function createGroupFlow() {
    if (!currentUserId) { alert('Connectez-vous pour créer un groupe.'); return; }
    const groupNameRaw = prompt('Nom du groupe :');
    if (!groupNameRaw) return;
    const groupName = groupNameRaw.trim().slice(0, 60);
    if (!groupName) { alert('Nom de groupe invalide.'); return; }

    const selectable = Object.values(users).filter(u => String(u.id) !== String(currentUserId));
    if (!selectable.length) { alert('Aucun utilisateur disponible pour ce groupe.'); return; }

    const choices = selectable.map((u, i) => `${i + 1}. ${u.username}`).join('\n');
    const answer = prompt(`Choisis les membres (numéros séparés par des virgules) :\n${choices}`);
    if (!answer) return;

    const pickedIndexes = [...new Set(
        answer.split(',').map(v => Number.parseInt(v.trim(), 10)).filter(n => Number.isInteger(n) && n >= 1 && n <= selectable.length)
    )];
    if (!pickedIndexes.length) { alert('Aucun membre valide sélectionné.'); return; }

    const memberIds = normalizeGroupMembers([String(currentUserId), ...pickedIndexes.map(idx => String(selectable[idx - 1].id))]);
    const { data: createdGroup, error: createGroupError } = await supabase
        .from(GROUPS_TABLE)
        .insert({ name: groupName, created_by: currentUserId })
        .select('id, name, created_by, created_at')
        .single();
    if (createGroupError || !createdGroup) {
        if (isMissingGroupSchemaError(createGroupError)) showGroupSchemaErrorOnce(createGroupError);
        else console.error('createGroupFlow group:', createGroupError);
        alert('Impossible de créer le groupe.');
        return;
    }

    const memberRows = memberIds.map(uid => ({ group_id: createdGroup.id, user_id: uid }));
    const { error: membersError } = await supabase.from(GROUP_MEMBERS_TABLE).insert(memberRows);
    if (membersError) {
        console.error('createGroupFlow members:', membersError);
        await supabase.from(GROUPS_TABLE).delete().eq('id', createdGroup.id).catch(() => {});
        alert('Impossible d\'ajouter les membres au groupe.');
        return;
    }

    await refreshGroupsCache();
    refreshGroupSelector();
    switchTargetMode('group');
    if (groupSelect) groupSelect.value = String(createdGroup.id);
    activeGroupId = String(createdGroup.id);
    await loadInitialMessages();
    showNotification('Groupe créé', `${createdGroup.name} est prêt ✅`);
}

async function startGroupCall() {
    const group = getActiveGroup();
    if (!group) { alert('Sélectionnez un groupe.'); return; }
    const roomUrl = buildGroupCallUrl(group);
    const payload = JSON.stringify({
        type: '__group_call__',
        url: roomUrl,
        label: `Appel de groupe - ${group.name}`
    });
    await sendMessage(currentUserId, payload);
    window.open(roomUrl, '_blank', 'noopener,noreferrer');
}

// ============================================================
// MESSAGES — Chargement initial
// ============================================================
async function loadInitialMessages() {
    if (!currentUserId || !hasActiveTarget()) { chatMessages.innerHTML = ''; currentMessages = []; return; }

    if (isGroupMode()) {
        const group = getActiveGroup();
        if (!group) { chatMessages.innerHTML = ''; currentMessages = []; return; }
        const uid = String(currentUserId);
        const { data, error } = await supabase.from('messages')
            .select('id, id_sent, id_received, content, created_at, read_at, city, group_id, logical_id, message_type')
            .eq('group_id', group.id)
            .or(`id_received.eq.${uid},id_sent.eq.${uid}`)
            .order('created_at', { ascending: true });
        if (error) {
            if (isMissingGroupSchemaError(error)) showGroupSchemaErrorOnce(error);
            else console.error('loadInitialMessages(group):', error);
            return;
        }
        currentMessages = dedupeMessagesForCurrentThread(data || []);
    } else {
        const uid = currentUserId;
        const peer = userSelect.value;
        const { data, error } = await supabase.from('messages')
            .select('id, id_sent, id_received, content, created_at, read_at, city, group_id')
            .or(`and(id_sent.eq.${uid},id_received.eq.${peer}),and(id_sent.eq.${peer},id_received.eq.${uid})`)
            .is('group_id', null)
            .order('created_at', { ascending: true });
        if (error) { console.error('loadInitialMessages:', error); return; }
        currentMessages = data || [];
    }

    renderMessages(currentMessages);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    await markMessagesAsRead();
    await fetchUnreadByUser();
    updatePresenceUI();
    if (currentMessages.length > 0) generateQuickReplies(currentMessages[currentMessages.length - 1]);
}

// ============================================================
// MESSAGES — Realtime
// ============================================================
function subscribeToConversation() {
    if (msgChannel) { supabase.removeChannel(msgChannel); msgChannel = null; }
    if (!currentUserId || !hasActiveTarget()) return;
    const uid = String(currentUserId);
    const peer = String(userSelect.value || '');
    const activeGroup = getActiveGroup();
    const channelKey = isGroupMode() ? `group-${activeGroup?.id || 'none'}` : `direct-${peer || 'none'}`;
    msgChannel = supabase.channel(`conv-${uid}-${channelKey}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `id_received=eq.${uid}` }, async (payload) => {
            const msg = payload.new;
            if (!isGroupMode()) {
                if (msg.group_id) {
                    if (!groups.some(g => String(g.id) === String(msg.group_id))) {
                        await refreshGroupsCache();
                        refreshGroupSelector();
                    }
                    const group = groups.find(g => String(g.id) === String(msg.group_id));
                    if (document.hidden && String(msg.id_sent) !== uid) {
                        const groupCall = parseGroupCallPayload(msg.content);
                        const voiceData = parseVoiceMessage(msg.content);
                        const fileData = parseFileMessage(msg.content);
                        const preview = groupCall
                            ? `📞 ${groupCall.label || 'Appel de groupe'}`
                            : voiceData ? '🎙️ Message vocal' : fileData ? `📎 ${fileData.name}` : msg.content.substring(0, 60);
                        showNotification(`Nouveau message dans ${group?.name || 'un groupe'}`, preview);
                    }
                    return;
                }
                const isOurConv = String(msg.id_sent) === String(peer) && String(msg.id_received) === uid;
                if (!isOurConv) {
                    usersWithUnread.set(msg.id_sent, (usersWithUnread.get(msg.id_sent) || 0) + 1);
                    updatePresenceUI();
                    return;
                }
                if (currentMessages.find(m => m.id === msg.id)) return;
                const wasAtBottom = chatMessages.scrollHeight - chatMessages.scrollTop <= chatMessages.clientHeight + 60;
                currentMessages.push(msg);
                appendMessageElement(msg);
                if (wasAtBottom) chatMessages.scrollTop = chatMessages.scrollHeight;
                if (document.hidden && String(msg.id_sent) === String(peer)) {
                    const voiceData = parseVoiceMessage(msg.content);
                    const fileData = parseFileMessage(msg.content);
                    const preview = voiceData ? '🎙️ Message vocal' : fileData ? `📎 ${fileData.name}` : msg.content.substring(0, 60);
                    showNotification(`Nouveau message de ${users[msg.id_sent]?.username || '?'}`, preview);
                }
                if (String(msg.id_received) === uid) { await markMessagesAsRead(); await fetchUnreadByUser(); updatePresenceUI(); }
                return;
            }

            const group = getActiveGroup();
            if (!group || !msg.group_id || String(msg.group_id) !== String(group.id)) return;

            const logicalMsg = {
                ...msg,
                logical_id: msg.logical_id || msg.id,
                group_id: msg.group_id
            };
            const exists = currentMessages.find(m => (m.logical_id && m.logical_id === logicalMsg.logical_id) || m.id === logicalMsg.id);
            if (exists) return;
            const wasAtBottom = chatMessages.scrollHeight - chatMessages.scrollTop <= chatMessages.clientHeight + 60;
            currentMessages.push(logicalMsg);
            appendMessageElement(logicalMsg);
            if (wasAtBottom) chatMessages.scrollTop = chatMessages.scrollHeight;
            if (document.hidden && String(msg.id_sent) !== uid) {
                const groupCall = parseGroupCallPayload(logicalMsg.content);
                const voiceData = parseVoiceMessage(logicalMsg.content);
                const fileData = parseFileMessage(logicalMsg.content);
                const preview = groupCall
                    ? `📞 ${groupCall.label || 'Appel de groupe'}`
                    : voiceData ? '🎙️ Message vocal' : fileData ? `📎 ${fileData.name}` : logicalMsg.content.substring(0, 60);
                showNotification(`Nouveau message dans ${group.name}`, preview);
            }
            if (String(msg.id_received) === uid) await markMessagesAsRead();
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `id_sent=eq.${uid}` }, (payload) => {
            const updated = payload.new;
            if (!isGroupMode()) {
                if (updated.group_id) return;
                const isOurConv = String(updated.id_sent) === uid && String(updated.id_received) === String(peer);
                if (!isOurConv) return;
                const idx = currentMessages.findIndex(m => m.id === updated.id);
                if (idx !== -1) { currentMessages[idx] = { ...currentMessages[idx], ...updated }; updateMessageReadStatus(updated.id, updated.read_at); }
                return;
            }
            const group = getActiveGroup();
            if (!group || !updated.group_id || String(updated.group_id) !== String(group.id)) return;
            const logicalId = updated.logical_id || updated.id;
            const idx = currentMessages.findIndex(m => (m.logical_id && m.logical_id === logicalId) || m.id === updated.id);
            if (idx !== -1) {
                currentMessages[idx] = { ...currentMessages[idx], ...updated, logical_id: logicalId, group_id: updated.group_id };
                updateMessageReadStatus(currentMessages[idx].id, updated.read_at);
            }
        })
        .subscribe((status, err) => { if (err) console.error('subscribeToConversation error:', err); });
}

function updateMessageReadStatus(msgId, readAt) {
    const msgEl = chatMessages.querySelector(`[data-msg-id="${msgId}"]`);
    if (!msgEl) return;
    const metaEl = msgEl.querySelector('.msg-meta');
    if (!metaEl) return;
    const msg = currentMessages.find(m => m.id === msgId);
    if (!msg) return;
    const dateObj = new Date(msg.created_at);
    const msgTime = dateObj.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    let metaText = msg.city ? `📍 ${msg.city} · ${msgTime}` : msgTime;
    if (readAt) { metaText += ' · 👁️ Lu'; metaEl.classList.remove('sent-status'); metaEl.classList.add('read'); }
    else { metaText += ' · ✓ Envoyé'; metaEl.classList.remove('read'); metaEl.classList.add('sent-status'); }
    metaEl.textContent = metaText;
}

// ============================================================
// TYPING — Broadcast
// ============================================================
function subscribeToTyping() {
    if (typingChannel) { supabase.removeChannel(typingChannel); typingChannel = null; }
    if (!currentUserId || !userSelect.value || isGroupMode()) return;
    const channelName = `typing:${[currentUserId, userSelect.value].sort().join(':')}`;
    typingChannel = supabase.channel(channelName)
        .on('broadcast', { event: 'typing' }, ({ payload }) => {
            if (payload.user_id === currentUserId) return;
            if (payload.is_typing) {
                const name = users[payload.user_id]?.username || 'U';
                typingIndicator.innerHTML = `
                    <div class="typing-avatar">${name.charAt(0).toUpperCase()}</div>
                    <div class="typing-body"><div class="typing-dots"><span></span><span></span><span></span></div></div>
                `;
                typingIndicator.style.display = 'flex';
            } else { typingIndicator.style.display = 'none'; }
        })
        .subscribe();
}

async function broadcastTyping(isTypingNow) {
    if (!typingChannel || !currentUserId || isGroupMode()) return;
    try {
        await typingChannel.send({ type: 'broadcast', event: 'typing', payload: { user_id: currentUserId, is_typing: isTypingNow } });
    } catch {}
}

messageInput.addEventListener('input', e => {
    handleFontInput(e);
    if (!isTyping) { isTyping = true; broadcastTyping(true); }
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => { isTyping = false; broadcastTyping(false); typingIndicator.style.display = 'none'; }, 2000);
});

// ============================================================
// APPELS ENTRANTS — Broadcast
// ============================================================
function subscribeToIncomingCalls() {
    if (incomingCallChannel) { supabase.removeChannel(incomingCallChannel); incomingCallChannel = null; }
    if (!currentUserId) return;
    incomingCallChannel = supabase.channel(`calls:${currentUserId}`)
        .on('broadcast', { event: 'call_signal' }, ({ payload }) => { handleCallSignal(payload); })
        .subscribe();
}

async function sendCallSignal(calleeId, payload) {
    const ch = supabase.channel(`calls:${calleeId}`);
    await ch.subscribe();
    await ch.send({ type: 'broadcast', event: 'call_signal', payload });
    setTimeout(() => supabase.removeChannel(ch), 2000);
}

function handleCallSignal(payload) {
    if (payload.type === 'incoming' && callState === 'idle') {
        callState = 'ringing'; currentCallId = payload.callId; callPeerUserId = payload.callerId;
        _pendingCallOffer = payload.offer; showCallScreen('ringing'); return;
    }
    if (payload.type === 'rejected' && callState === 'calling') { endCall(false); showCallEndedBrief('Appel refusé'); return; }
    if (payload.type === 'ended') { if (callState !== 'idle') endCall(false); return; }
    if (payload.type === 'answer' && peerConnection) {
        peerConnection.setRemoteDescription(new RTCSessionDescription(payload.answer))
            .then(() => { callState = 'active'; showCallScreen('active'); })
            .catch(e => console.error('[Call] setRemoteDescription:', e));
        return;
    }
    if (payload.type === 'ice_candidate' && peerConnection) {
        peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {}); return;
    }
    if (payload.type === 'renegotiate' && peerConnection && callState === 'active') {
        peerConnection.setRemoteDescription(new RTCSessionDescription(payload.offer))
            .then(() => peerConnection.createAnswer())
            .then(answer => peerConnection.setLocalDescription(answer).then(() => answer))
            .then(answer => sendCallSignal(callPeerUserId, { type: 'renegotiate_answer', answer: { type: answer.type, sdp: answer.sdp }, callId: currentCallId, callerId: currentUserId }))
            .catch(e => console.error('[Video] renegotiate:', e));
        return;
    }
    if (payload.type === 'renegotiate_answer' && peerConnection) {
        peerConnection.setRemoteDescription(new RTCSessionDescription(payload.answer)).catch(e => console.error('[Video] renegotiate_answer:', e)); return;
    }
    if (payload.type === 'video_enabled' && callState === 'active') { remoteVideoEnabled = true; updateVideoLayout(); return; }
    if (payload.type === 'video_disabled' && callState === 'active') { remoteVideoEnabled = false; updateVideoLayout(); return; }
    if (payload.type === 'screen_sharing_started' && callState === 'active') { screenSharingPeer = true; return; }
    if (payload.type === 'screen_sharing_stopped' && callState === 'active') { screenSharingPeer = false; return; }
    if (payload.type === 'reaction' && callState === 'active') { showReactionBubble(payload.emoji, 'remote'); return; }
}

// ============================================================
// GÉOLOCALISATION
// ============================================================
async function getGeolocationCached() {
    if (_geoCache) return _geoCache;
    if (_geoPend)  return _geoPend;
    _geoPend = new Promise((resolve, reject) => {
        if (!navigator.geolocation) { reject(new Error('Non supporté')); return; }
        navigator.geolocation.getCurrentPosition(
            p => { _geoCache = { latitude: p.coords.latitude, longitude: p.coords.longitude }; _geoPend = null; resolve(_geoCache); },
            err => { _geoPend = null; reject(err); },
            { timeout: 3000, maximumAge: 300000 }
        );
    });
    return _geoPend;
}

async function getCityFromCoordinates(lat, lon) {
    try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`);
        const d = await r.json();
        return d.address?.city || d.address?.town || d.address?.village || null;
    } catch { return null; }
}

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
    const { data, error } = await supabase.from('users').select('id, username');
    if (error) { console.error('getUsers:', error); return; }
    userSelect.innerHTML = '';
    data.forEach(user => {
        users[user.id] = user;
        const opt = document.createElement('option');
        opt.value = user.id; opt.textContent = user.username;
        userSelect.appendChild(opt);
    });
    const firstPeer = Array.from(userSelect.options).find(opt => String(opt.value) !== String(currentUserId));
    if (firstPeer) userSelect.value = firstPeer.value;
    refreshGroupSelector();
    refreshTargetModeUI();
    if (currentUserId) updatePresenceUI();
}

// ============================================================
// ACCUSÉS DE LECTURE
// ============================================================
async function markMessagesAsRead() {
    if (!currentUserId || !hasActiveTarget()) return;
    try {
        const nowIso = new Date().toISOString();
        if (isGroupMode()) {
            const group = getActiveGroup();
            if (!group) return;
            const { data, error } = await supabase.from('messages')
                .select('id')
                .eq('id_received', currentUserId)
                .eq('group_id', group.id)
                .is('read_at', null);
            if (error || !data?.length) return;
            const ids = data.map(msg => msg.id);
            if (ids.length) await supabase.from('messages').update({ read_at: nowIso }).in('id', ids);
            return;
        }
        const { data, error } = await supabase.from('messages')
            .select('id')
            .eq('id_sent', userSelect.value)
            .eq('id_received', currentUserId)
            .is('group_id', null)
            .is('read_at', null);
        if (error || !data?.length) return;
        const ids = data.map(msg => msg.id);
        if (ids.length) await supabase.from('messages').update({ read_at: nowIso }).in('id', ids);
    } catch (e) { console.error('markMessagesAsRead:', e); }
}

// ============================================================
// QUICK REPLIES
// ============================================================
function generateQuickReplies(lastMessage) {
    if (!lastMessage || lastMessage.id_sent === currentUserId) { quickReplies.style.display = 'none'; return; }
    const content = lastMessage.content.toLowerCase().trim();
    if (content.startsWith('{"type":"__voice__"') || content.startsWith('{"type":"__file__"') || content.startsWith('{"type":"__group_call__"') || content.length < 3) { quickReplies.style.display = 'none'; return; }
    const patterns = {
        greeting:     { kw: ['bonjour','salut','hello','coucou','bonsoir'],        r: ['👋 Bonjour !','Salut !','Hello !','Ça va ?'] },
        thanks:       { kw: ['merci','thanks','thx'],                              r: ['De rien !','Avec plaisir !','😊','Pas de souci !'] },
        howareyou:    { kw: ['comment vas','ça va','tu vas'],                      r: ['Très bien merci !','Ça va et toi ?','Super !'] },
        agreement:    { kw: ['ok','oui','yes',"d'accord"],                         r: ['Parfait !','👍','Super !','Génial !'] },
        disagreement: { kw: ['non','no',"pas d'accord"],                           r: ["D'accord",'Pas de souci','Compris'] },
        apology:      { kw: ['désolé','sorry','pardon'],                           r: ['Pas grave !',"T\'inquiète pas",'Aucun souci'] },
        laugh:        { kw: ['haha','lol','mdr'],                                  r: ['😂','Haha oui','Trop marrant'] },
        planning:     { kw: ['demain','ce soir','weekend','plan','rendez-vous'],   r: ['Avec plaisir','Super idée','Je suis partant'] },
        tired:        { kw: ['occupé','fatigue','dormir','pas le temps'],          r: ['Pas grave','À plus tard','Dors bien !'] },
        help:         { kw: ['aide','help','besoin'],                              r: ['Bien sûr !','Avec plaisir','Je suis là'] },
        default:      { kw: [],                                                    r: ['👍','❤️','😊','🔥','Cool','Oui'] },
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
        btn.addEventListener('click', () => {
            messageInput.value = reply; rawInputText = reply; prevConvertedValue = reply;
            handleSend(); quickReplies.style.display = 'none';
        });
        quickReplies.appendChild(btn);
    });
    quickReplies.style.display = 'flex';
}

// ============================================================
// EMOJI PICKER
// ============================================================
function initEmojiPicker() {
    const picker = document.querySelector('emoji-picker');
    if (!picker) return;
    picker.addEventListener('emoji-click', e => {
        const pos = messageInput.selectionStart ?? messageInput.value.length;
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
    emojiPickerWrapper.style.display = 'block'; emojiPickerWrapper.classList.remove('hiding');
    emojiButton.classList.add('active');
}

function closeEmojiPicker() {
    emojiPickerWrapper.classList.add('hiding'); emojiButton.classList.remove('active');
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
// PARTAGE DE FICHIERS — Supabase Storage
// ============================================================
function parseFileMessage(content) {
    if (!content || !content.startsWith('{')) return null;
    try { const obj = JSON.parse(content); if (obj.type === '__file__') return obj; } catch {}
    return null;
}

function isImageMime(mime) {
    return mime && mime.startsWith('image/');
}

function isVideoMime(mime) {
    return mime && mime.startsWith('video/');
}

async function handleFileUpload(file) {
    if (!currentUserId || !hasActiveTarget()) { alert('Connectez-vous pour envoyer des fichiers.'); return; }
    if (file.size > MAX_FILE_SIZE) { alert(`Fichier trop volumineux. Maximum : ${MAX_FILE_SIZE / 1024 / 1024} MB`); return; }

    const allowedMimes = ['image/jpeg','image/png','image/gif','image/webp','image/heic','image/heif','video/mp4','video/webm','video/quicktime','video/3gpp'];
    if (!allowedMimes.includes(file.type)) {
        alert('Format non supporté. Formats acceptés : JPG, PNG, GIF, WEBP, HEIC, MP4, WEBM, MOV, 3GP');
        return;
    }

    const progressEl = document.getElementById('upload-progress');
    if (progressEl) { progressEl.style.display = 'block'; progressEl.textContent = '📤 Envoi en cours…'; }

    try {
        const ext = file.name.split('.').pop();
        const uniqueName = `${currentUserId}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const filePath = `${currentUserId}/${uniqueName}`;

        const { data: uploadData, error: uploadError } = await supabase.storage
            .from(FILE_BUCKET)
            .upload(filePath, file, { contentType: file.type, upsert: false });

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage.from(FILE_BUCKET).getPublicUrl(filePath);
        const publicUrl = urlData.publicUrl;

        const filePayload = JSON.stringify({
            type: '__file__',
            url: publicUrl,
            name: file.name,
            mime: file.type,
            size: file.size,
            path: filePath
        });

        await sendMessage(currentUserId, filePayload);

        if (progressEl) { progressEl.textContent = '✅ Fichier envoyé !'; setTimeout(() => { progressEl.style.display = 'none'; }, 2000); }
    } catch (err) {
        console.error('handleFileUpload:', err);
        if (progressEl) { progressEl.textContent = '❌ Erreur lors de l\'envoi'; setTimeout(() => { progressEl.style.display = 'none'; }, 3000); }
        alert('Erreur lors de l\'envoi du fichier : ' + (err.message || err));
    }
}

function createFileMessageElement(fileData, isSent) {
    const wrap = document.createElement('div');
    wrap.className = 'file-message-wrap';

    if (isImageMime(fileData.mime)) {
        const img = document.createElement('img');
        img.src = fileData.url;
        img.alt = fileData.name;
        img.className = 'file-msg-image';
        img.loading = 'lazy';
        img.addEventListener('click', () => openMediaViewer(fileData.url, 'image', fileData.name));
        wrap.appendChild(img);
    } else if (isVideoMime(fileData.mime)) {
        const video = document.createElement('video');
        video.src = fileData.url;
        video.controls = true;
        video.className = 'file-msg-video';
        video.preload = 'metadata';
        wrap.appendChild(video);
    } else {
        const fileDiv = document.createElement('div');
        fileDiv.className = 'file-msg-generic';
        fileDiv.innerHTML = `<span class="file-msg-icon">📎</span><span class="file-msg-name">${fileData.name}</span>`;
        const sizeKB = (fileData.size / 1024).toFixed(1);
        const sizeText = document.createElement('span');
        sizeText.className = 'file-msg-size';
        sizeText.textContent = sizeKB < 1024 ? `${sizeKB} Ko` : `${(fileData.size / 1024 / 1024).toFixed(1)} Mo`;
        fileDiv.appendChild(sizeText);
        const dlLink = document.createElement('a');
        dlLink.href = fileData.url; dlLink.download = fileData.name;
        dlLink.className = 'file-msg-dl'; dlLink.textContent = '⬇ Télécharger';
        dlLink.target = '_blank';
        fileDiv.appendChild(dlLink);
        wrap.appendChild(fileDiv);
    }

    if (isImageMime(fileData.mime) || isVideoMime(fileData.mime)) {
        const dlBtn = document.createElement('a');
        dlBtn.href = fileData.url; dlBtn.download = fileData.name;
        dlBtn.className = 'file-msg-dl-btn'; dlBtn.textContent = '⬇';
        dlBtn.title = 'Télécharger'; dlBtn.target = '_blank';
        wrap.appendChild(dlBtn);
    }

    return wrap;
}

function openMediaViewer(url, type, name) {
    const viewer = document.createElement('div');
    viewer.className = 'media-viewer-overlay';
    viewer.innerHTML = `
        <div class="media-viewer-content">
            <button class="media-viewer-close">✕</button>
            <a class="media-viewer-dl" href="${url}" download="${name}" target="_blank">⬇ Télécharger</a>
            <img src="${url}" alt="${name}" class="media-viewer-img">
        </div>`;
    viewer.querySelector('.media-viewer-close').addEventListener('click', () => viewer.remove());
    viewer.addEventListener('click', e => { if (e.target === viewer) viewer.remove(); });
    document.body.appendChild(viewer);
}

function injectFileUploadUI() {
    const chatInput = document.querySelector('.chat-input');
    const sendBtn   = document.getElementById('send-button');
    if (!chatInput || !sendBtn) return;

    const fileInput = document.createElement('input');
    fileInput.type = 'file'; fileInput.id = 'file-input'; fileInput.style.display = 'none';
    fileInput.accept = 'image/*,video/*';
    fileInput.addEventListener('change', e => {
        const file = e.target.files?.[0];
        if (file) handleFileUpload(file);
        fileInput.value = '';
    });
    document.body.appendChild(fileInput);

    const cameraInput = document.createElement('input');
    cameraInput.type = 'file'; cameraInput.id = 'camera-input'; cameraInput.style.display = 'none';
    cameraInput.accept = 'image/*,video/*';
    cameraInput.capture = 'environment';
    cameraInput.addEventListener('change', e => {
        const file = e.target.files?.[0];
        if (file) handleFileUpload(file);
        cameraInput.value = '';
    });
    document.body.appendChild(cameraInput);

    const attachBtn = document.createElement('button');
    attachBtn.id = 'attach-button'; attachBtn.className = 'icon-button';
    attachBtn.title = 'Envoyer une photo ou vidéo'; attachBtn.innerHTML = '📎';
    attachBtn.addEventListener('click', () => fileInput.click());

    const cameraBtn = document.createElement('button');
    cameraBtn.id = 'camera-button'; cameraBtn.className = 'icon-button';
    cameraBtn.title = 'Prendre une photo / vidéo'; cameraBtn.innerHTML = '📷';
    cameraBtn.addEventListener('click', () => cameraInput.click());

    chatInput.insertBefore(attachBtn, sendBtn);
    chatInput.insertBefore(cameraBtn, sendBtn);
}

// ============================================================
// MESSAGES — Rendu
// ============================================================
function parseVoiceMessage(content) {
    if (!content || !content.startsWith('{')) return null;
    try { const obj = JSON.parse(content); if (obj.type === '__voice__') return obj; } catch {}
    return null;
}

function createGroupCallMessageElement(callData) {
    const wrap = document.createElement('div');
    wrap.className = 'group-call-message';
    const title = document.createElement('div');
    title.className = 'group-call-title';
    title.textContent = callData.label || 'Appel de groupe';
    const link = document.createElement('a');
    link.className = 'group-call-link';
    link.href = callData.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Rejoindre l\'appel';
    wrap.appendChild(title);
    wrap.appendChild(link);
    return wrap;
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
    canvas.width = canvas.offsetWidth || 160; canvas.height = canvas.offsetHeight || 32;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height, bars = data.length, barW = W / bars;
    ctx.clearRect(0, 0, W, H);
    data.forEach((val, i) => {
        const barH = Math.max(3, val * H * 0.85), y = (H - barH) / 2;
        const played = i / bars < progress;
        ctx.fillStyle = played ? (isSent ? 'rgba(0,0,0,0.55)' : '#6ee7b7') : (isSent ? 'rgba(0,0,0,0.22)' : 'rgba(110,231,183,0.32)');
        ctx.beginPath(); ctx.roundRect(i * barW + barW * 0.15, y, barW * 0.7, barH, 2); ctx.fill();
    });
}

function createVoiceMessagePlayer(voiceData, isSent) {
    const wrap = document.createElement('div'); wrap.className = 'voice-message-player';
    const playBtn = document.createElement('button'); playBtn.className = 'vmp-play-btn'; playBtn.textContent = '▶';
    const waveWrap = document.createElement('div'); waveWrap.className = 'vmp-waveform-container';
    const canvas = document.createElement('canvas'); waveWrap.appendChild(canvas);
    const info = document.createElement('div'); info.className = 'vmp-info';
    const durSpan = document.createElement('span'); durSpan.className = 'vmp-duration'; durSpan.textContent = formatVoiceDuration(voiceData.duration || 0);
    const speedBtn = document.createElement('button'); speedBtn.className = 'vmp-speed-btn'; speedBtn.textContent = '1x';
    if (voiceData.effect && voiceData.effect !== 'normal') {
        const effectBadge = document.createElement('span'); effectBadge.className = 'vmp-effect-badge';
        effectBadge.textContent = VOICE_EFFECTS[voiceData.effect]?.label || voiceData.effect; info.appendChild(effectBadge);
    }
    info.appendChild(durSpan); info.appendChild(speedBtn);
    wrap.appendChild(playBtn); wrap.appendChild(waveWrap); wrap.appendChild(info);
    const audio = new Audio(voiceData.data || voiceData.url);
    let playbackRate = 1, isPlaying = false, animId = null;
    const waveData = generateStaticWaveform(voiceData.duration || 10, 160);
    setTimeout(() => drawStaticWaveform(canvas, waveData, 0, isSent), 60);
    speedBtn.addEventListener('click', () => {
        const speeds = [1, 1.5, 2]; playbackRate = speeds[(speeds.indexOf(playbackRate) + 1) % speeds.length];
        audio.playbackRate = playbackRate; speedBtn.textContent = `${playbackRate}x`;
    });
    playBtn.addEventListener('click', async () => {
        if (isPlaying) { audio.pause(); isPlaying = false; playBtn.textContent = '▶'; cancelAnimationFrame(animId); drawStaticWaveform(canvas, waveData, audio.currentTime / (voiceData.duration || 1), isSent); }
        else { audio.playbackRate = playbackRate; await audio.play().catch(e => console.warn('[Voice] play:', e)); isPlaying = true; playBtn.textContent = '⏸'; animatePlay(); }
    });
    audio.addEventListener('ended', () => { isPlaying = false; playBtn.textContent = '▶'; cancelAnimationFrame(animId); drawStaticWaveform(canvas, waveData, 0, isSent); durSpan.textContent = formatVoiceDuration(voiceData.duration || 0); });
    waveWrap.addEventListener('click', e => { const pct = (e.clientX - waveWrap.getBoundingClientRect().left) / waveWrap.offsetWidth; audio.currentTime = pct * (voiceData.duration || audio.duration || 0); drawStaticWaveform(canvas, waveData, pct, isSent); });
    function animatePlay() {
        animId = requestAnimationFrame(animatePlay);
        const dur = voiceData.duration || audio.duration || 1;
        drawStaticWaveform(canvas, waveData, audio.currentTime / dur, isSent);
        durSpan.textContent = formatVoiceDuration(dur - audio.currentTime);
    }
    return wrap;
}

// ============================================================
// FIX DATE : renderMessages utilise un objet partagé pour lastDate
// Le bug original : la closure du forEach capturait lastDate par valeur
// au moment de l'appel, donc setLastDate ne propageait pas la valeur
// aux itérations suivantes. L'objet _state contourne ce problème.
// ============================================================
function renderMessages(data) {
    chatMessages.innerHTML = '';
    const fragment = document.createDocumentFragment();
    const _state = { lastDate: null };
    data.forEach(message => appendToFragment(fragment, message, _state.lastDate, d => { _state.lastDate = d; }));
    chatMessages.appendChild(fragment);
}

function appendMessageElement(message) {
    const last = currentMessages[currentMessages.length - 2];
    const lastDate = last ? new Date(last.created_at).toLocaleDateString('fr-FR') : null;
    const fragment = document.createDocumentFragment();
    appendToFragment(fragment, message, lastDate, () => {});
    chatMessages.appendChild(fragment);
}

function appendToFragment(fragment, message, lastDate, setLastDate) {
    const dateObj  = new Date(message.created_at);
    const msgDate  = dateObj.toLocaleDateString('fr-FR');
    const msgTime  = dateObj.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const isMine   = message.id_sent === currentUserId;
    const sender   = users[message.id_sent]?.username || 'Inconnu';
    const voiceData = parseVoiceMessage(message.content);
    const fileData  = parseFileMessage(message.content);
    const groupCallData = parseGroupCallPayload(message.content);

    if (msgDate !== lastDate) {
        const el = document.createElement('div'); el.className = 'date'; el.textContent = msgDate;
        fragment.appendChild(el); setLastDate(msgDate);
    }

    const rowEl = document.createElement('div');
    rowEl.classList.add('message-row', isMine ? 'sent' : 'received');

    if (!isMine) {
        const avatarEl = document.createElement('div');
        avatarEl.className = 'message-avatar';
        avatarEl.textContent = sender.charAt(0).toUpperCase() || '?';
        avatarEl.title = sender;
        rowEl.appendChild(avatarEl);
    }

    const msgEl = document.createElement('div');
    msgEl.classList.add('message', isMine ? 'sent' : 'received');
    if (voiceData) msgEl.classList.add('voice-msg');
    if (fileData)  msgEl.classList.add('file-msg');
    if (groupCallData) msgEl.classList.add('group-call-msg');
    msgEl.dataset.msgId = message.id;

    const metaSpan = document.createElement('span'); metaSpan.className = 'msg-meta';
    let metaText = message.city ? `📍 ${message.city} · ${msgTime}` : msgTime;
    if (isMine) {
        if (message.read_at) { metaText += ' · 👁️ Lu'; metaSpan.classList.add('read'); }
        else                  { metaText += ' · ✓ Envoyé'; metaSpan.classList.add('sent-status'); }
    }
    metaSpan.textContent = metaText;

    if (voiceData)         { msgEl.appendChild(createVoiceMessagePlayer(voiceData, isMine)); }
    else if (fileData)     { msgEl.appendChild(createFileMessageElement(fileData, isMine)); }
    else if (groupCallData){ msgEl.appendChild(createGroupCallMessageElement(groupCallData)); }
    else                   { msgEl.appendChild(document.createTextNode(message.content)); }
    msgEl.appendChild(metaSpan);

    if (isMine) {
        const del = document.createElement('span'); del.textContent = '✖'; del.className = 'delete-button';
        del.addEventListener('click', () => deleteMessage(message.id, fileData?.path));
        msgEl.appendChild(del);
    }

    rowEl.appendChild(msgEl);
    fragment.appendChild(rowEl);
}

function appendOptimisticMessage(content) {
    const now = new Date();
    const msgTime = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const msgDate = now.toLocaleDateString('fr-FR');
    const lastDateEl = chatMessages.querySelector('.date:last-of-type');
    if (!lastDateEl || lastDateEl.textContent !== msgDate) {
        const dateEl = document.createElement('div'); dateEl.className = 'date'; dateEl.textContent = msgDate;
        chatMessages.appendChild(dateEl);
    }
    const voiceData = parseVoiceMessage(content);
    const fileData  = parseFileMessage(content);
    const groupCallData = parseGroupCallPayload(content);
    const rowEl = document.createElement('div');
    rowEl.classList.add('message-row', 'sent');

    const msgEl = document.createElement('div'); msgEl.classList.add('message', 'sent', 'optimistic');
    if (voiceData) msgEl.classList.add('voice-msg');
    if (fileData)  msgEl.classList.add('file-msg');
    if (groupCallData) msgEl.classList.add('group-call-msg');
    const metaSpan = document.createElement('span'); metaSpan.className = 'msg-meta'; metaSpan.textContent = `${msgTime} · ⏳`;
    if (voiceData)         { msgEl.appendChild(createVoiceMessagePlayer(voiceData, true)); }
    else if (fileData)     { msgEl.appendChild(createFileMessageElement(fileData, true)); }
    else if (groupCallData){ msgEl.appendChild(createGroupCallMessageElement(groupCallData)); }
    else                   { msgEl.appendChild(document.createTextNode(content)); }
    msgEl.appendChild(metaSpan);

    rowEl.appendChild(msgEl);
    chatMessages.appendChild(rowEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return msgEl;
}

// ============================================================
// ENVOI DE MESSAGES
// ============================================================
async function deleteMessage(messageId, filePath) {
    const messageRef = currentMessages.find(m => m.id === messageId);
    if (filePath) {
        await supabase.storage.from(FILE_BUCKET).remove([filePath]).catch(e => console.warn('deleteFile:', e));
    }
    let error = null;
    if (messageRef?.logical_id && messageRef?.group_id && currentUserId) {
        const { data: linkedRows } = await supabase.from('messages')
            .select('id')
            .eq('id_sent', currentUserId)
            .eq('group_id', messageRef.group_id)
            .eq('logical_id', messageRef.logical_id);
        const ids = (linkedRows || []).map(r => r.id);
        if (ids.length > 0) ({ error } = await supabase.from('messages').delete().in('id', ids));
        else ({ error } = await supabase.from('messages').delete().eq('id', messageId));
    } else {
        ({ error } = await supabase.from('messages').delete().eq('id', messageId));
    }
    if (error) { console.error('deleteMessage:', error); return; }
    const el = chatMessages.querySelector(`[data-msg-id="${messageId}"]`);
    if (el) el.remove();
    if (messageRef?.logical_id) currentMessages = currentMessages.filter(m => m.logical_id !== messageRef.logical_id);
    else currentMessages = currentMessages.filter(m => m.id !== messageId);
}

async function sendMessage(userId, content) {
    const isVoice = content.startsWith('{"type":"__voice__"');
    const isFile  = content.startsWith('{"type":"__file__"');
    const isGroupCall = content.startsWith('{"type":"__group_call__"');
    let optimisticEl = null;
    if (!isVoice) optimisticEl = appendOptimisticMessage(content);
    isTyping = false; clearTimeout(typingTimeout); broadcastTyping(false);
    const createdAt = new Date().toISOString();

    if (!isGroupMode()) {
        const { data, error } = await supabase.from('messages')
            .insert({
                id_sent: userId,
                content,
                created_at: createdAt,
                id_received: userSelect.value,
                read_at: null,
                latitude: null,
                longitude: null,
                city: null,
                group_id: null,
                logical_id: null,
                message_type: 'direct'
            })
            .select('id, id_sent, id_received, content, created_at, read_at, city').single();
        if (error) { console.error('sendMessage:', error); optimisticEl?.remove(); return false; }
        if (optimisticEl) {
            optimisticEl.remove();
            if (!currentMessages.find(m => m.id === data.id)) {
                currentMessages.push(data); appendMessageElement(data); chatMessages.scrollTop = chatMessages.scrollHeight;
            }
        }
        if (data.id && !isFile && !isGroupCall) {
            getGeolocationCached().then(async geo => {
                const city = await getCityFromCoordinates(geo.latitude, geo.longitude);
                if (!city && !geo.latitude) return;
                await supabase.from('messages').update({ latitude: geo.latitude, longitude: geo.longitude, city }).eq('id', data.id);
                const idx = currentMessages.findIndex(m => m.id === data.id);
                if (idx !== -1) currentMessages[idx].city = city;
            }).catch(() => {});
        }
        return true;
    }

    const group = getActiveGroup();
    if (!group) { optimisticEl?.remove(); alert('Groupe introuvable.'); return false; }
    const recipients = group.members.filter(m => m !== String(currentUserId));
    if (!recipients.length) { optimisticEl?.remove(); alert('Ajoutez au moins un autre membre au groupe.'); return false; }

    const logicalId = crypto.randomUUID();
    const rows = recipients.map(recipientId => ({
        id_sent: userId,
        id_received: recipientId,
        content,
        created_at: createdAt,
        read_at: null,
        latitude: null,
        longitude: null,
        city: null,
        group_id: group.id,
        logical_id: logicalId,
        message_type: isGroupCall ? 'group_call' : 'group'
    }));
    const { data, error } = await supabase.from('messages')
        .insert(rows)
        .select('id, id_sent, id_received, content, created_at, read_at, city, group_id, logical_id, message_type');
    if (error) { console.error('sendMessage(group):', error); optimisticEl?.remove(); return false; }

    const inserted = (data && data.length > 0 ? data[0] : null);
    const logicalMessage = {
        id: inserted?.id || `local-${logicalId}`,
        id_sent: userId,
        id_received: inserted?.id_received || recipients[0],
        content,
        created_at: inserted?.created_at || createdAt,
        read_at: inserted?.read_at || null,
        city: inserted?.city || null,
        logical_id: logicalId,
        group_id: group.id,
        message_type: isGroupCall ? 'group_call' : 'group'
    };

    if (optimisticEl) optimisticEl.remove();
    if (!currentMessages.find(m => (m.logical_id && m.logical_id === logicalId) || m.id === logicalMessage.id)) {
        currentMessages.push(logicalMessage);
        appendMessageElement(logicalMessage);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
    return true;
}

async function handleSend() {
    if (!currentUserId) { alert('Veuillez vous connecter pour envoyer un message'); return; }
    if (!hasActiveTarget()) { alert('Sélectionnez une conversation avant d\'envoyer un message.'); return; }
    const content = messageInput.value.trim(); if (!content) return;
    messageInput.value = ''; messageInput.focus(); quickReplies.style.display = 'none';
    rawInputText = ''; prevConvertedValue = '';
    await sendMessage(currentUserId, content);
}

sendButton.addEventListener('click', handleSend);
messageInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); handleSend(); } });

// ============================================================
// CONNEXION / DÉCONNEXION
// ============================================================
function showConnectedUI(username) {
    loginContainer.style.display = 'none'; connectedUser.style.display = 'flex';
    connectedUsername.textContent = username;
}

async function completeLogin(user, plainPassword) {
    currentUserId = user.id; users[user.id] = { id: user.id, username: user.username };
    showConnectedUI(user.username);
    saveSession({ userId: user.id, username: user.username, plainPassword, issuedAt: Date.now(), expiresAt: Date.now() + SESSION_MS });
    await getUsers();
    await refreshGroupsCache();
    refreshGroupSelector();
    refreshTargetModeUI();
    await loadInitialMessages();
    subscribeToConversation(); subscribeToTyping(); subscribeToPresence(); subscribeToIncomingCalls();
    getGeolocationCached().catch(() => {});
}

async function login() {
    const username = loginUsername.value.trim(), password = loginPassword.value;
    if (!username || !password) { alert('Veuillez remplir tous les champs'); return; }
    try {
        const { data, error } = await supabase.from('users').select('id, username, password').eq('username', username).single();
        if (error || !data) { alert('Utilisateur non trouvé'); return; }
        if (data.password !== password) { alert('Mot de passe incorrect'); return; }
        await requestNotificationPermission(); await completeLogin(data, password);
    } catch (e) { console.error('login:', e); alert('Erreur de connexion'); }
}

async function checkAutoLogin() {
    const raw = localStorage.getItem('pending_auto_login');
    if (!raw) return false;
    localStorage.removeItem('pending_auto_login');
    let pending;
    try { pending = JSON.parse(raw); } catch { return false; }
    if (!pending?.userId || !pending?.plainPassword) return false;
    try {
        const { data, error } = await supabase.from('users').select('id, username, password').eq('id', pending.userId).single();
        if (error || !data || data.password !== pending.plainPassword) return false;
        await requestNotificationPermission(); await completeLogin(data, pending.plainPassword); return true;
    } catch { return false; }
}

async function logout(options = {}) {
    const { reason = '' } = options;
    if (isTyping) { isTyping = false; broadcastTyping(false); }
    clearTimeout(typingTimeout);
    if (isRecording) cancelVoiceRecording();
    if (callState !== 'idle' && callPeerUserId) {
        await sendCallSignal(callPeerUserId, { type: 'ended', callId: currentCallId, callerId: currentUserId });
        endCall(false);
    }
    const channels = [msgChannel, typingChannel, presenceChannel, incomingCallChannel];
    for (const ch of channels) { if (ch) await supabase.removeChannel(ch).catch(() => {}); }
    msgChannel = typingChannel = presenceChannel = incomingCallChannel = null;
    closeEmojiPicker(); closeFontPicker(); resetFont();
    currentUserId = null; currentMessages = []; _geoCache = null; _geoPend = null;
    groups = [];
    targetMode = 'direct'; activeGroupId = '';
    if (targetModeSelect) targetModeSelect.value = 'direct';
    clearSession(); clearPresenceUI();
    loginContainer.style.display = 'block'; connectedUser.style.display = 'none';
    chatMessages.innerHTML = ''; typingIndicator.style.display = 'none'; quickReplies.style.display = 'none';
    refreshGroupSelector();
    refreshTargetModeUI();
    if (reason) alert(reason);
}

loginButton.addEventListener('click', login);
logoutButton.addEventListener('click', () => logout());
loginPassword.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); login(); } });

userSelect.addEventListener('change', async () => {
    if (isGroupMode()) return;
    currentMessages = []; typingIndicator.style.display = 'none'; quickReplies.style.display = 'none';
    isTyping = false; clearTimeout(typingTimeout);
    if (currentUserId) { subscribeToConversation(); subscribeToTyping(); await loadInitialMessages(); updatePresenceUI(); }
});

// ============================================================
// MESSAGES VOCAUX — Enregistrement
// ============================================================
function getVoiceSupportedMimeType() {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
    for (const t of types) { if (MediaRecorder.isTypeSupported(t)) return t; }
    return 'audio/webm';
}

function getEventCoords(e) {
    if (e.touches && e.touches.length > 0)               return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    if (e.changedTouches && e.changedTouches.length > 0)  return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
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
        indicator.style.color = 'var(--accent)'; indicator.classList.add('show');
    } else { indicator.classList.remove('show'); }
}

function hideVoiceSlideIndicator() { document.getElementById('voice-slide-indicator')?.classList.remove('show'); }

async function startVoiceRecording() {
    try {
        recordingStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 44100 }
        });
    } catch { alert('Microphone inaccessible. Vérifiez les permissions du navigateur.'); return; }
    voiceAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    voiceAnalyserNode = voiceAudioContext.createAnalyser(); voiceAnalyserNode.fftSize = 256;
    voiceGainNode = voiceAudioContext.createGain(); voiceGainNode.gain.value = 1.2;
    voiceFilterNode = voiceAudioContext.createBiquadFilter(); voiceFilterNode.type = 'highpass'; voiceFilterNode.frequency.value = 80;
    const source = voiceAudioContext.createMediaStreamSource(recordingStream);
    source.connect(voiceGainNode); voiceGainNode.connect(voiceAnalyserNode); voiceGainNode.connect(voiceFilterNode);
    mediaRecorder = new MediaRecorder(recordingStream, { mimeType: getVoiceSupportedMimeType() });
    audioChunks = [];
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.start(100);
    isRecording = true; isPaused = false; isVoiceLocked = false;
    pausedDuration = 0; pauseStartTime = null; recordingStartTime = Date.now();
    const micBtn = document.getElementById('voice-record-btn');
    micBtn.classList.add('recording'); micBtn.innerHTML = '⏹';
    document.getElementById('voice-slide-hint').classList.add('visible');
    startVoiceTimer();
}

function lockVoiceRecording() {
    if (!isRecording || isVoiceLocked) return;
    isVoiceLocked = true;
    const micBtn = document.getElementById('voice-record-btn');
    micBtn.classList.remove('recording'); micBtn.classList.add('locked'); micBtn.innerHTML = '🔒';
    document.getElementById('voice-slide-hint').classList.remove('visible');
    document.getElementById('voice-locked-bar').classList.add('visible');
    startVoiceWaveform(); hideVoiceSlideIndicator();
}

function toggleVoicePause() {
    if (!isRecording) return;
    const btn = document.getElementById('vlb-pause-btn');
    if (isPaused) {
        mediaRecorder.resume(); isPaused = false;
        if (pauseStartTime) { pausedDuration += Date.now() - pauseStartTime; pauseStartTime = null; }
        btn.textContent = '⏸ Pause'; btn.classList.remove('paused'); startVoiceWaveform();
    } else {
        mediaRecorder.pause(); isPaused = true; pauseStartTime = Date.now();
        btn.textContent = '▶ Reprendre'; btn.classList.add('paused'); cancelAnimationFrame(waveformAnimId);
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
    mediaRecorder.stop(); cleanupVoiceRecording();
}

function cleanupVoiceRecording() {
    isRecording = false; isPaused = false; isVoiceLocked = false;
    if (recordingStream) { recordingStream.getTracks().forEach(t => t.stop()); recordingStream = null; }
    if (voiceAudioContext) { voiceAudioContext.close(); voiceAudioContext = null; }
    voiceAnalyserNode = null; voiceGainNode = null; voiceFilterNode = null;
    cancelAnimationFrame(waveformAnimId); clearInterval(recordingTimer);
    recordingTimer = null; recordingStartTime = null; stopVoiceAmbianceSound();
    const micBtn = document.getElementById('voice-record-btn');
    if (micBtn) { micBtn.classList.remove('recording', 'locked'); micBtn.innerHTML = '🎙️'; micBtn.style.transform = ''; }
    document.getElementById('voice-slide-hint')?.classList.remove('visible');
    document.getElementById('voice-locked-bar')?.classList.remove('visible');
    document.getElementById('voice-effects-panel')?.classList.remove('visible');
    const vlbTimer = document.getElementById('vlb-timer'), hintTimer = document.getElementById('voice-hint-timer');
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
        const hintTimer = document.getElementById('voice-hint-timer'), vlbTimer = document.getElementById('vlb-timer');
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
        ctx.clearRect(0, 0, W, H); ctx.beginPath(); ctx.strokeStyle = 'rgba(239,68,68,0.85)'; ctx.lineWidth = 1.5;
        const step = W / buf.length;
        buf.forEach((v, i) => { const y = ((v / 128 - 1) * H * 0.45) + H / 2; i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(i * step, y); });
        ctx.stroke();
    }
    draw();
}

async function processAndSendVoice(blob, mimeType, durationSeconds) {
    let processedBlob = blob;
    if (voiceEffect !== 'normal') { try { processedBlob = await applyVoiceEffectDSP(blob); } catch { processedBlob = blob; } }
    const arrayBuffer = await processedBlob.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    let base64 = '';
    const chunkSize = 8192;
    for (let i = 0; i < uint8.length; i += chunkSize) { base64 += String.fromCharCode(...uint8.subarray(i, i + chunkSize)); }
    const dataUrl = `data:${processedBlob.type || mimeType};base64,${btoa(base64)}`;
    if (!currentUserId || !hasActiveTarget()) { alert('Connectez-vous pour envoyer un message vocal.'); return; }
    const voicePayload = JSON.stringify({ type: '__voice__', data: dataUrl, mime: mimeType, duration: durationSeconds, effect: voiceEffect });
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
    source.buffer = decoded; source.playbackRate.value = effect.pitch;
    if (effect.robot) {
        const waveshaper = offlineCtx.createWaveShaper();
        const n = 256; const curve = new Float32Array(n);
        for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; curve[i] = (Math.PI + 100) * x / (Math.PI + 100 * Math.abs(x)); }
        waveshaper.curve = curve; waveshaper.oversample = '4x';
        source.connect(waveshaper); waveshaper.connect(offlineCtx.destination);
    } else { source.connect(offlineCtx.destination); }
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
    for (let i = 0; i < data.length; i++) { const s = Math.max(-1,Math.min(1,data[i])); view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true); off += 2; }
    return new Blob([ab], { type: 'audio/wav' });
}

function startVoiceAmbianceSound(type) {
    stopVoiceAmbianceSound();
    if (!voiceAudioContext || !type || type === 'none') return;
    if (type === 'rain') {
        const noise = createVoiceNoise(voiceAudioContext, 0.08);
        const f = voiceAudioContext.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1200; f.Q.value = 0.3;
        noise.connect(f); f.connect(voiceAudioContext.destination); ambianceNodes.push(noise, f);
    } else if (type === 'space') {
        [80, 120, 160].forEach(freq => {
            const osc = voiceAudioContext.createOscillator(); const g = voiceAudioContext.createGain();
            osc.type = 'sine'; osc.frequency.value = freq; g.gain.value = 0.02;
            osc.connect(g); g.connect(voiceAudioContext.destination); osc.start(); ambianceNodes.push(osc, g);
        });
    } else if (type === 'cafe') {
        const noise = createVoiceNoise(voiceAudioContext, 0.04);
        const f = voiceAudioContext.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
        noise.connect(f); f.connect(voiceAudioContext.destination); ambianceNodes.push(noise, f);
    } else if (type === 'forest') {
        [600, 800, 1200].forEach(freq => {
            const osc = voiceAudioContext.createOscillator(); const g = voiceAudioContext.createGain();
            osc.type = 'sine'; osc.frequency.value = freq; g.gain.value = 0.01;
            osc.connect(g); g.connect(voiceAudioContext.destination); osc.start(); ambianceNodes.push(osc, g);
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
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.start();
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
                ${Object.entries(VOICE_EFFECTS).map(([k,v]) => `<button class="vep-chip voice-chip ${k==='normal'?'active':''}" data-effect="${k}">${v.label}</button>`).join('')}
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

    const lockedBar = document.createElement('div'); lockedBar.id = 'voice-locked-bar';
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

    const slideHint = document.createElement('div'); slideHint.id = 'voice-slide-hint';
    slideHint.innerHTML = `<span class="hint-cancel">← Annuler</span><span class="hint-timer" id="voice-hint-timer">0:00</span><span class="hint-lock">↑ Verrouiller</span>`;
    chatContainer.insertBefore(slideHint, chatInputEl);

    const slideInd = document.createElement('div'); slideInd.className = 'voice-slide-indicator'; slideInd.id = 'voice-slide-indicator';
    chatContainer.appendChild(slideInd);

    const micBtn = document.createElement('button');
    micBtn.id = 'voice-record-btn'; micBtn.title = 'Message vocal (maintenir appuyé)'; micBtn.innerHTML = '🎙️';
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
    document.getElementById('vlb-effects-btn').addEventListener('click', () => { document.getElementById('voice-effects-panel').classList.toggle('visible'); });

    effectsPanel.querySelectorAll('.voice-chip').forEach(chip => {
        chip.addEventListener('click', () => { voiceEffect = chip.dataset.effect; effectsPanel.querySelectorAll('.voice-chip').forEach(c => c.classList.remove('active')); chip.classList.add('active'); });
    });
    effectsPanel.querySelectorAll('.ambiance-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            voiceAmbiance = chip.dataset.ambiance === 'none' ? null : chip.dataset.ambiance;
            effectsPanel.querySelectorAll('.ambiance-chip').forEach(c => c.classList.remove('active')); chip.classList.add('active');
            if (isRecording && voiceAudioContext) { voiceAmbiance ? startVoiceAmbianceSound(voiceAmbiance) : stopVoiceAmbianceSound(); }
        });
    });
}

// ============================================================
// APPELS — SONNERIE
// ============================================================
function startRingtone(type) {
    stopRingtone();
    try { ringtoneCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    function playTone(freq, duration, startTime) {
        if (!ringtoneCtx) return;
        const osc = ringtoneCtx.createOscillator(), gain = ringtoneCtx.createGain();
        osc.type = 'sine'; osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(0.18, startTime + 0.02);
        gain.gain.linearRampToValueAtTime(0.18, startTime + duration - 0.02);
        gain.gain.linearRampToValueAtTime(0, startTime + duration);
        osc.connect(gain); gain.connect(ringtoneCtx.destination);
        osc.start(startTime); osc.stop(startTime + duration);
    }
    if (type === 'incoming') {
        function playIncomingCycle() { if (!ringtoneCtx || callState === 'idle') return; const now = ringtoneCtx.currentTime; playTone(880, 0.3, now); playTone(660, 0.3, now + 0.35); }
        playIncomingCycle(); ringtoneInterval = setInterval(playIncomingCycle, 2000);
    } else {
        function playOutgoingCycle() { if (!ringtoneCtx || callState === 'idle') return; playTone(440, 0.5, ringtoneCtx.currentTime); }
        playOutgoingCycle(); ringtoneInterval = setInterval(playOutgoingCycle, 3000);
    }
}

function stopRingtone() {
    clearInterval(ringtoneInterval); ringtoneInterval = null;
    if (ringtoneCtx) { try { ringtoneCtx.close(); } catch {} ringtoneCtx = null; }
}

// ============================================================
// APPELS — PARTAGE D'ÉCRAN
// ============================================================
async function toggleScreenShare() {
    if (!peerConnection || callState !== 'active') return;
    if (!isScreenSharing) {
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: { ideal: 30 }, cursor: 'always' },
                audio: false
            });
            const screenTrack = screenStream.getVideoTracks()[0];

            // Remplace ou ajoute la piste vidéo dans le PeerConnection
            const existingSender = peerConnection.getSenders().find(s => s.track?.kind === 'video');
            if (existingSender) {
                await existingSender.replaceTrack(screenTrack);
            } else {
                peerConnection.addTrack(screenTrack, screenStream);
            }

            // Affiche le partage d'écran localement
            const localVid = document.getElementById('call-local-video');
            if (localVid) { localVid.srcObject = screenStream; }

            isScreenSharing = true;
            isVideoEnabled  = true;
            updateScreenShareButton(true);
            updateVideoLayout();

            await sendCallSignal(callPeerUserId, {
                type: 'video_enabled', callId: currentCallId, callerId: currentUserId
            });

            // Arrêt automatique si l'utilisateur clique "Arrêter" dans le navigateur
            screenTrack.onended = () => stopScreenShare();

        } catch (err) {
            // NotAllowedError = l'utilisateur a refusé, pas besoin d'alerter
            if (err.name !== 'NotAllowedError') {
                console.error('[ScreenShare]', err);
            }
        }
    } else {
        stopScreenShare();
    }
}

async function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach(t => t.stop());
        screenStream = null;
    }
    isScreenSharing = false;

    // Si la caméra était active avant, on la restaure
    if (isVideoEnabled && localVideoStream) {
        const videoTrack = localVideoStream.getVideoTracks()[0];
        const sender = peerConnection?.getSenders().find(s => s.track?.kind === 'video');
        if (sender && videoTrack) await sender.replaceTrack(videoTrack).catch(() => {});
        const localVid = document.getElementById('call-local-video');
        if (localVid) localVid.srcObject = localVideoStream;
    } else {
        isVideoEnabled = false;
        const sender = peerConnection?.getSenders().find(s => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(null).catch(() => {});
        const localVid = document.getElementById('call-local-video');
        if (localVid) localVid.srcObject = null;
        if (callPeerUserId) await sendCallSignal(callPeerUserId, {
            type: 'video_disabled', callId: currentCallId, callerId: currentUserId
        }).catch(() => {});
    }
    updateScreenShareButton(false);
    updateVideoLayout();
}

function updateScreenShareButton(active) {
    const btn = document.getElementById('call-btn-screen');
    if (!btn) return;
    btn.innerHTML = active
        ? '<span class="call-btn-icon">🖥️</span><span class="call-btn-label">Arrêter</span>'
        : '<span class="call-btn-icon">🖥️</span><span class="call-btn-label">Écran</span>';
    btn.classList.toggle('active', active);
}

// ============================================================
// APPELS — VIDÉO bidirectionnelle
// ============================================================
async function toggleVideo() {
    if (callState !== 'active' || !peerConnection) return;
    if (!isVideoEnabled) { await enableLocalVideo(); }
    else                 { disableLocalVideo(); }
}

async function enableLocalVideo(facingMode) {
    const facing = facingMode || currentFacingMode;
    try {
        if (localVideoStream) { localVideoStream.getTracks().forEach(t => t.stop()); localVideoStream = null; }
        localVideoStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false
        });
        currentFacingMode = facing;
        const videoTrack = localVideoStream.getVideoTracks()[0];
        const existingSender = peerConnection.getSenders().find(s => s.track?.kind === 'video');
        if (existingSender) { await existingSender.replaceTrack(videoTrack); }
        else                { peerConnection.addTrack(videoTrack, localVideoStream); }
        const localVid = document.getElementById('call-local-video');
        if (localVid) { localVid.srcObject = localVideoStream; }
        isVideoEnabled = true;
        updateVideoLayout(); updateVideoButton(true); updateFlipButton(true);
        await sendCallSignal(callPeerUserId, { type: 'video_enabled', callId: currentCallId, callerId: currentUserId });
    } catch (err) { console.error('[Video] Caméra inaccessible:', err); alert('Caméra inaccessible. Vérifiez les permissions.'); }
}

function disableLocalVideo() {
    if (localVideoStream) {
        localVideoStream.getVideoTracks().forEach(t => {
            t.stop();
            const sender = peerConnection?.getSenders().find(s => s.track === t);
            if (sender) sender.replaceTrack(null).catch(() => {});
        });
        localVideoStream = null;
    }
    const localVid = document.getElementById('call-local-video');
    if (localVid) { localVid.srcObject = null; }
    isVideoEnabled = false;
    updateVideoLayout(); updateVideoButton(false); updateFlipButton(false);
    sendCallSignal(callPeerUserId, { type: 'video_disabled', callId: currentCallId, callerId: currentUserId }).catch(() => {});
}

async function flipCamera() {
    if (!isVideoEnabled) return;
    await enableLocalVideo(currentFacingMode === 'user' ? 'environment' : 'user');
}

function updateVideoLayout() {
    const overlay    = document.getElementById('call-overlay');
    const videoArea  = document.getElementById('call-video-area');
    const localVid   = document.getElementById('call-local-video');
    const remoteVid  = document.getElementById('call-remote-video');
    const avatarArea = document.getElementById('call-avatar-area');
    const infoArea   = document.getElementById('call-info');
    if (!overlay || !videoArea) return;

    document.getElementById('call-local-pip')?.remove();
    document.getElementById('call-remote-pip')?.remove();

    if (!isVideoEnabled && !remoteVideoEnabled) {
        overlay.dataset.videoMode = 'none'; videoArea.style.display = 'none';
        if (avatarArea) avatarArea.style.display = 'flex';
        if (infoArea)   infoArea.style.display   = 'flex';
        if (localVid)   { localVid.className = '';  localVid.style.display  = 'none'; }
        if (remoteVid)  { remoteVid.className = ''; remoteVid.style.display = 'none'; }
        return;
    }

    videoArea.style.display = 'flex';
    if (avatarArea) avatarArea.style.display = 'none';
    if (infoArea)   infoArea.style.display   = 'none';

    if (isVideoEnabled && remoteVideoEnabled) {
        overlay.dataset.videoMode = 'both';
        if (localVid)  { localVid.style.display  = 'block'; localVid.className  = 'call-video-half'; }
        if (remoteVid) { remoteVid.style.display = 'block'; remoteVid.className = 'call-video-half'; }
    } else if (remoteVideoEnabled && !isVideoEnabled) {
        overlay.dataset.videoMode = 'remote-only';
        if (remoteVid) { remoteVid.style.display = 'block'; remoteVid.className = 'call-video-full'; }
        if (localVid)  { localVid.style.display  = 'none';  localVid.className  = ''; }
        const pip = document.createElement('div'); pip.id = 'call-local-pip'; pip.className = 'call-pip-avatar';
        pip.textContent = (users[currentUserId]?.username || 'Moi').charAt(0).toUpperCase();
        videoArea.appendChild(pip);
    } else if (isVideoEnabled && !remoteVideoEnabled) {
        overlay.dataset.videoMode = 'local-only';
        if (localVid)  { localVid.style.display  = 'block'; localVid.className  = 'call-video-full'; }
        if (remoteVid) { remoteVid.style.display = 'none';  remoteVid.className = ''; }
        const pip = document.createElement('div'); pip.id = 'call-remote-pip'; pip.className = 'call-pip-avatar call-pip-avatar--remote';
        pip.textContent = (users[callPeerUserId]?.username || '?').charAt(0).toUpperCase();
        videoArea.appendChild(pip);
    }

    const ctrlsEl = document.getElementById('call-controls-group');
    const reactEl  = document.getElementById('call-reaction-trigger');
    const actionsEl = document.querySelector('.call-actions');
    if (ctrlsEl)   ctrlsEl.style.zIndex   = '10';
    if (reactEl)   reactEl.style.zIndex   = '10';
    if (actionsEl) actionsEl.style.zIndex = '10';
}

function updateVideoButton(enabled) {
    const btn = document.getElementById('call-btn-video'); if (!btn) return;
    btn.innerHTML = enabled
        ? `<span class="call-btn-icon">📷</span><span class="call-btn-label">Cam ON</span>`
        : `<span class="call-btn-icon">📷</span><span class="call-btn-label">Caméra</span>`;
    btn.classList.toggle('active', enabled);
}

function updateFlipButton(show) {
    const btn = document.getElementById('call-btn-flip'); if (!btn) return;
    btn.style.display = show ? 'flex' : 'none';
}

// ============================================================
// APPELS — RÉACTIONS
// ============================================================
async function sendCallReaction(emoji) {
    showReactionBubble(emoji, 'local');
    if (callPeerUserId) await sendCallSignal(callPeerUserId, { type: 'reaction', emoji, callId: currentCallId, callerId: currentUserId });
}

function showReactionBubble(emoji, origin) {
    const container = document.getElementById('call-reactions-area'); if (!container) return;
    const bubble = document.createElement('div');
    bubble.className = `call-reaction-bubble call-reaction-${origin}`; bubble.textContent = emoji;
    const xRange = origin === 'local' ? [55, 85] : [10, 40];
    bubble.style.left = `${xRange[0] + Math.random() * (xRange[1] - xRange[0])}%`;
    container.appendChild(bubble);
    bubble.addEventListener('animationend', () => bubble.remove());
}

function toggleReactionPicker() { document.getElementById('call-reaction-picker')?.classList.toggle('visible'); }

// ============================================================
// APPELS — Affichage écran
// ============================================================
function showCallScreen(mode) {
    const overlay = document.getElementById('call-overlay'); if (!overlay) return;
    const peerName = users[callPeerUserId]?.username || 'Inconnu';
    document.getElementById('call-peer-name').textContent   = peerName;
    document.getElementById('call-peer-avatar').textContent = peerName.charAt(0).toUpperCase();
    const statusEl  = document.getElementById('call-status-text');
    const timerEl   = document.getElementById('call-timer-display');
    const ctrlsEl   = document.getElementById('call-controls-group');
    const reactEl   = document.getElementById('call-reaction-trigger');
    const acceptBtn = document.getElementById('call-btn-accept');
    const rejectBtn = document.getElementById('call-btn-reject');
    const hangupBtn = document.getElementById('call-btn-hangup');
    const videoBtn  = document.getElementById('call-btn-video');
    const flipBtn   = document.getElementById('call-btn-flip');
    const screenBtn = document.getElementById('call-btn-screen');

    [acceptBtn, rejectBtn, hangupBtn].forEach(b => { if(b) b.style.display = 'none'; });

    if (mode === 'calling') {
        statusEl.textContent = 'Appel en cours…'; timerEl.style.display = 'none';
        hangupBtn.style.display = 'flex'; ctrlsEl.style.display = 'none'; reactEl.style.display = 'none';
        if (screenBtn) screenBtn.style.display = 'none';
        startRingtone('outgoing');
    } else if (mode === 'ringing') {
        statusEl.textContent = 'Appel entrant…'; timerEl.style.display = 'none';
        acceptBtn.style.display = 'flex'; rejectBtn.style.display = 'flex';
        ctrlsEl.style.display = 'none'; reactEl.style.display = 'none';
        if (screenBtn) screenBtn.style.display = 'none';
        startRingtone('incoming');
    } else if (mode === 'active') {
        statusEl.textContent = 'En communication'; timerEl.style.display = 'block';
        hangupBtn.style.display = 'flex'; ctrlsEl.style.display = 'flex'; reactEl.style.display = 'flex';
        if (videoBtn)  videoBtn.style.display  = 'flex';
        if (flipBtn)   flipBtn.style.display   = 'none';
        if (screenBtn) screenBtn.style.display = 'flex';
        stopRingtone(); startCallTimer();
    } else if (mode === 'reconnecting') {
        statusEl.textContent = 'Reconnexion…'; timerEl.style.display = 'none';
        hangupBtn.style.display = 'flex'; ctrlsEl.style.display = 'flex'; reactEl.style.display = 'none';
        if (videoBtn) videoBtn.style.display = 'flex';
        if (screenBtn) screenBtn.style.display = 'none';
    }

    overlay.style.display = 'flex';
    requestAnimationFrame(() => overlay.classList.add('visible'));
}

function hideCallScreen() {
    const overlay = document.getElementById('call-overlay'); if (!overlay) return;
    overlay.classList.remove('visible'); delete overlay.dataset.videoMode;
    setTimeout(() => { overlay.style.display = 'none'; }, 400);
    stopCallTimer(); stopRingtone();
    document.getElementById('call-reaction-picker')?.classList.remove('visible');
    const videoArea = document.getElementById('call-video-area');
    if (videoArea) videoArea.style.display = 'none';
    const localVid  = document.getElementById('call-local-video');
    const remoteVid = document.getElementById('call-remote-video');
    if (localVid)  { localVid.srcObject  = null; localVid.className  = ''; localVid.style.display  = 'none'; }
    if (remoteVid) { remoteVid.srcObject = null; remoteVid.className = ''; remoteVid.style.display = 'none'; }
    document.getElementById('call-local-pip')?.remove();
    document.getElementById('call-remote-pip')?.remove();
    const avatarArea = document.getElementById('call-avatar-area'), infoArea = document.getElementById('call-info');
    if (avatarArea) avatarArea.style.display = 'flex';
    if (infoArea)   infoArea.style.display   = 'flex';
}

// ============================================================
// BOUTON TÉLÉPHONE
// ============================================================
function updateCallButtonState() {
    const btn = document.getElementById('call-audio-btn'); if (!btn) return;
    if (isGroupMode()) { btn.style.display = 'none'; return; }
    const selId = userSelect.value;
    const peerIsOnline = onlineUsers.has(selId);
    btn.style.display = (currentUserId && selId && selId !== String(currentUserId) && peerIsOnline) ? 'flex' : 'none';
}

function startCallTimer() {
    callDuration = 0; clearInterval(callTimer);
    callTimer = setInterval(() => {
        callDuration++;
        const m = Math.floor(callDuration / 60).toString().padStart(2, '0');
        const s = (callDuration % 60).toString().padStart(2, '0');
        const el = document.getElementById('call-timer-display');
        if (el) el.textContent = `${m}:${s}`;
    }, 1000);
}

function stopCallTimer() { clearInterval(callTimer); callTimer = null; callDuration = 0; const el = document.getElementById('call-timer-display'); if (el) el.textContent = '00:00'; }

async function getLocalStream() {
    if (localStream && localStream.active) return localStream;
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    return localStream;
}

function releaseLocalStream() {
    if (localStream)      { localStream.getTracks().forEach(t => t.stop());      localStream      = null; }
    if (localVideoStream) { localVideoStream.getTracks().forEach(t => t.stop()); localVideoStream = null; }
}

// ============================================================
// WEBRTC — PeerConnection
// ============================================================
function buildPeerConnection() {
    if (peerConnection) { try { peerConnection.close(); } catch {} peerConnection = null; }
    peerConnection = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    peerConnection.onicecandidate = async (event) => {
        if (!event.candidate || !callPeerUserId) return;
        await sendCallSignal(callPeerUserId, {
            type: 'ice_candidate', candidate: event.candidate.toJSON(),
            callId: currentCallId, callerId: currentUserId
        });
    };

    const remoteStream = new MediaStream();

    peerConnection.ontrack = (event) => {
        const track = event.track;
        remoteStream.addTrack(track);

        if (track.kind === 'audio') {
            if (!remoteAudio) {
                remoteAudio = new Audio();
                remoteAudio.autoplay = true;
                remoteAudio.setAttribute('playsinline', 'true');
            }
            remoteAudio.srcObject = remoteStream;
            remoteAudio.play().catch(err => {
                const resumeAudio = () => { remoteAudio?.play().catch(() => {}); document.removeEventListener('click', resumeAudio); };
                document.addEventListener('click', resumeAudio);
            });
        }

        if (track.kind === 'video') {
            remoteVideoEnabled = true;
            const remoteVid = document.getElementById('call-remote-video');
            if (remoteVid) {
                remoteVid.srcObject = remoteStream;
                remoteVid.play().catch(err => console.warn('[Video remote] Lecture auto:', err));
            }
            updateVideoLayout();
        }

        track.onended = () => {
            if (track.kind === 'video') {
                remoteVideoEnabled = false;
                const remoteVid = document.getElementById('call-remote-video');
                if (remoteVid) remoteVid.srcObject = null;
                updateVideoLayout();
            }
        };

        track.onmute = () => {
            if (track.kind === 'video') { remoteVideoEnabled = false; updateVideoLayout(); }
        };

        track.onunmute = () => {
            if (track.kind === 'video') { remoteVideoEnabled = true; updateVideoLayout(); }
        };
    };

    peerConnection.onconnectionstatechange = () => {
        const state = peerConnection?.connectionState;
        if (state === 'connected') {
            callReconnectAttempts = 0;
            if (callState !== 'active') { callState = 'active'; showCallScreen('active'); }
        } else if (state === 'disconnected' || state === 'failed') { handleCallDisconnect(); }
    };

    peerConnection.oniceconnectionstatechange = () => {
        if (peerConnection?.iceConnectionState === 'failed') handleCallDisconnect();
    };

    peerConnection.onnegotiationneeded = async () => {
        if (callState !== 'active') return;
        try {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            await sendCallSignal(callPeerUserId, {
                type: 'renegotiate',
                offer: { type: offer.type, sdp: offer.sdp },
                callId: currentCallId, callerId: currentUserId
            });
        } catch (e) { console.error('[PC] onnegotiationneeded:', e); }
    };

    return peerConnection;
}

async function initiateCall() {
    if (!currentUserId || !userSelect.value || callState !== 'idle' || isGroupMode()) return;
    const calleeId = userSelect.value;
    if (String(calleeId) === String(currentUserId)) return;
    callState = 'calling'; callPeerUserId = calleeId; callReconnectAttempts = 0;
    currentCallId = crypto.randomUUID(); isVideoEnabled = false; remoteVideoEnabled = false;
    showCallScreen('calling');
    let stream;
    try { stream = await getLocalStream(); }
    catch { callState = 'idle'; currentCallId = null; hideCallScreen(); alert('Microphone inaccessible.'); return; }
    const pc = buildPeerConnection();
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await pc.setLocalDescription(offer);
    await sendCallSignal(calleeId, {
        type: 'incoming', callId: currentCallId, callerId: currentUserId,
        offer: { type: offer.type, sdp: offer.sdp }
    });
    setTimeout(async () => {
        if (callState === 'calling') {
            await sendCallSignal(calleeId, { type: 'ended', callId: currentCallId, callerId: currentUserId });
            endCall(); alert('Pas de réponse.');
        }
    }, CALL_TIMEOUT_MS);
}

async function acceptCall() {
    if (callState !== 'ringing' || !currentCallId) return;
    callState = 'active'; stopRingtone();
    const offer = _pendingCallOffer; if (!offer) { endCall(); return; }
    isVideoEnabled = false; remoteVideoEnabled = false;
    let stream;
    try { stream = await getLocalStream(); }
    catch { callState = 'idle'; hideCallScreen(); alert('Microphone inaccessible.'); return; }
    const pc = buildPeerConnection();
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await sendCallSignal(callPeerUserId, {
        type: 'answer', callId: currentCallId,
        answer: { type: answer.type, sdp: answer.sdp }
    });
    showCallScreen('active');
}

async function rejectCall() {
    if (!callPeerUserId) return;
    stopRingtone();
    await sendCallSignal(callPeerUserId, { type: 'rejected', callId: currentCallId, callerId: currentUserId });
    callState = 'idle'; currentCallId = null; callPeerUserId = null; _pendingCallOffer = null;
    hideCallScreen();
}

async function hangUp() {
    if (!callPeerUserId) return;
    await sendCallSignal(callPeerUserId, { type: 'ended', callId: currentCallId, callerId: currentUserId });
    endCall();
}

function endCall() {
    clearInterval(callTimer); callTimer = null;
    stopRingtone(); stopCallTimer();
    if (peerConnection) { try { peerConnection.close(); } catch {} peerConnection = null; }
    releaseLocalStream();
    if (remoteAudio) { remoteAudio.srcObject = null; remoteAudio.pause(); remoteAudio = null; }
    callState = 'idle'; currentCallId = null; callPeerUserId = null;
    callReconnectAttempts = 0; isMuted = false; isSpeakerOn = false;
    isVideoEnabled = false; remoteVideoEnabled = false; currentFacingMode = 'user';
    // Nettoyage partage d'écran
    isScreenSharing = false; screenSharingPeer = false;
    if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }
    _pendingCallOffer = null;
    hideCallScreen();
    updateMuteButton(); updateSpeakerButton(); updateVideoButton(false); updateFlipButton(false); updateScreenShareButton(false);
}

function showCallEndedBrief(message) {
    const statusEl = document.getElementById('call-status-text');
    if (statusEl) { statusEl.textContent = message; setTimeout(hideCallScreen, 1500); }
    else hideCallScreen();
}

async function handleCallDisconnect() {
    if (callState === 'idle' || callState === 'reconnecting') return;
    if (callReconnectAttempts >= MAX_RECONNECT) {
        if (callPeerUserId) await sendCallSignal(callPeerUserId, { type: 'ended', callId: currentCallId, callerId: currentUserId });
        endCall(); showCallEndedBrief('Appel interrompu'); return;
    }
    callReconnectAttempts++; callState = 'reconnecting'; showCallScreen('reconnecting');
    setTimeout(async () => {
        if (callState !== 'reconnecting' || !peerConnection) return;
        try {
            const offer = await peerConnection.createOffer({ iceRestart: true });
            await peerConnection.setLocalDescription(offer);
            if (callPeerUserId) await sendCallSignal(callPeerUserId, {
                type: 'incoming', callId: currentCallId, callerId: currentUserId,
                offer: { type: offer.type, sdp: offer.sdp }
            });
        } catch (e) { console.error('[Call] ICE restart:', e); }
    }, 2000);
}

function toggleMute() {
    isMuted = !isMuted;
    if (localStream) localStream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
    updateMuteButton();
}

function updateMuteButton() {
    const btn = document.getElementById('call-btn-mute'); if (!btn) return;
    btn.innerHTML = isMuted
        ? `<span class="call-btn-icon">🔇</span><span class="call-btn-label">Muet</span>`
        : `<span class="call-btn-icon">🎤</span><span class="call-btn-label">Micro</span>`;
    btn.classList.toggle('active', isMuted);
}

function toggleSpeaker() {
    isSpeakerOn = !isSpeakerOn;
    if (remoteAudio) remoteAudio.volume = isSpeakerOn ? 1.0 : 0.7;
    updateSpeakerButton();
}

function updateSpeakerButton() {
    const btn = document.getElementById('call-btn-speaker'); if (!btn) return;
    btn.innerHTML = isSpeakerOn
        ? `<span class="call-btn-icon">🔊</span><span class="call-btn-label">HP actif</span>`
        : `<span class="call-btn-icon">🔈</span><span class="call-btn-label">HP</span>`;
    btn.classList.toggle('active', isSpeakerOn);
}

// ============================================================
// GROUPES — Injection UI
// ============================================================
function injectGroupUI() {
    const userSelectionEl = document.querySelector('.user-selection');
    if (!userSelectionEl || targetModeSelect || groupSelect) return;

    targetModeSelect = document.createElement('select');
    targetModeSelect.id = 'target-mode-select';
    targetModeSelect.className = 'target-mode-select';
    targetModeSelect.innerHTML = `
        <option value="direct">Privé</option>
        <option value="group">Groupe</option>
    `;
    targetModeSelect.value = targetMode;
    targetModeSelect.addEventListener('change', () => switchTargetMode(targetModeSelect.value));

    groupSelect = document.createElement('select');
    groupSelect.id = 'group-select';
    groupSelect.className = 'group-select';
    groupSelect.style.display = 'none';
    groupSelect.addEventListener('change', async () => {
        activeGroupId = groupSelect.value || '';
        currentMessages = [];
        typingIndicator.style.display = 'none';
        quickReplies.style.display = 'none';
        if (currentUserId) {
            subscribeToConversation();
            await loadInitialMessages();
            updateGroupCallButtonState();
        }
    });

    createGroupButton = document.createElement('button');
    createGroupButton.id = 'create-group-btn';
    createGroupButton.className = 'icon-button create-group-btn';
    createGroupButton.type = 'button';
    createGroupButton.title = 'Créer un groupe';
    createGroupButton.textContent = '＋';
    createGroupButton.addEventListener('click', createGroupFlow);

    userSelect.insertAdjacentElement('beforebegin', targetModeSelect);
    userSelect.insertAdjacentElement('afterend', groupSelect);
    userSelectionEl.appendChild(createGroupButton);

    refreshGroupSelector();
    refreshTargetModeUI();
}

// ============================================================
// APPELS — Injection UI
// ============================================================
function injectCallUI() {
    const userSelectionEl = document.querySelector('.user-selection');
    if (userSelectionEl) {
        const callBtn = document.createElement('button');
        callBtn.id = 'call-audio-btn'; callBtn.className = 'icon-button call-audio-btn';
        callBtn.title = 'Appel'; callBtn.innerHTML = '📞'; callBtn.style.display = 'none';
        callBtn.addEventListener('click', initiateCall);
        userSelectionEl.appendChild(callBtn);

        groupCallButton = document.createElement('button');
        groupCallButton.id = 'group-call-btn';
        groupCallButton.className = 'icon-button group-call-btn';
        groupCallButton.type = 'button';
        groupCallButton.title = 'Appel de groupe';
        groupCallButton.innerHTML = '👥';
        groupCallButton.style.display = 'none';
        groupCallButton.addEventListener('click', startGroupCall);
        userSelectionEl.appendChild(groupCallButton);
    }

    const overlay = document.createElement('div');
    overlay.id = 'call-overlay'; overlay.style.display = 'none';
    overlay.innerHTML = `
        <div id="call-screen">
            <div id="call-video-area" style="display:none;">
                <video id="call-remote-video" autoplay playsinline></video>
                <video id="call-local-video"  autoplay playsinline muted></video>
            </div>
            <div class="call-avatar-wrap" id="call-avatar-area">
                <div class="call-avatar-ring call-avatar-ring--1"></div>
                <div class="call-avatar-ring call-avatar-ring--2"></div>
                <div class="call-avatar-ring call-avatar-ring--3"></div>
                <div class="call-avatar" id="call-peer-avatar">?</div>
            </div>
            <div class="call-info" id="call-info">
                <div class="call-peer-name" id="call-peer-name">…</div>
                <div class="call-status-text" id="call-status-text">Appel en cours…</div>
                <div class="call-timer-display" id="call-timer-display" style="display:none;">00:00</div>
            </div>
            <div class="call-controls-group" id="call-controls-group" style="display:none;">
                <button class="call-ctrl-btn" id="call-btn-mute">
                    <span class="call-btn-icon">🎤</span><span class="call-btn-label">Micro</span>
                </button>
                <button class="call-ctrl-btn" id="call-btn-speaker">
                    <span class="call-btn-icon">🔈</span><span class="call-btn-label">HP</span>
                </button>
                <button class="call-ctrl-btn" id="call-btn-video" style="display:none;">
                    <span class="call-btn-icon">📷</span><span class="call-btn-label">Caméra</span>
                </button>
                <button class="call-ctrl-btn" id="call-btn-flip" style="display:none;" title="Retourner la caméra">
                    <span class="call-btn-icon">🔄</span><span class="call-btn-label">Retourner</span>
                </button>
                <button class="call-ctrl-btn" id="call-btn-screen" style="display:none;" title="Partager l'écran">
                    <span class="call-btn-icon">🖥️</span><span class="call-btn-label">Écran</span>
                </button>
            </div>
            <div class="call-reaction-row" id="call-reaction-trigger" style="display:none;">
                <button class="call-reaction-open-btn" id="call-reaction-open-btn">😊 Réaction</button>
                <div class="call-reaction-picker" id="call-reaction-picker">
                    ${CALL_REACTIONS.map(e => `<button class="call-reaction-emoji" data-emoji="${e}">${e}</button>`).join('')}
                </div>
            </div>
            <div id="call-reactions-area"></div>
            <div class="call-actions">
                <button class="call-action-btn call-action-accept" id="call-btn-accept"><span>📞</span></button>
                <button class="call-action-btn call-action-reject" id="call-btn-reject"><span>📵</span></button>
                <button class="call-action-btn call-action-hangup" id="call-btn-hangup" style="display:none;"><span>📵</span></button>
            </div>
            <div class="call-action-labels">
                <span class="call-action-label">Accepter</span>
                <span class="call-action-label">Refuser</span>
                <span class="call-action-label" style="display:none;">Raccrocher</span>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    document.getElementById('call-btn-accept').addEventListener('click', acceptCall);
    document.getElementById('call-btn-reject').addEventListener('click', rejectCall);
    document.getElementById('call-btn-hangup').addEventListener('click', hangUp);
    document.getElementById('call-btn-mute').addEventListener('click', toggleMute);
    document.getElementById('call-btn-speaker').addEventListener('click', toggleSpeaker);
    document.getElementById('call-btn-video').addEventListener('click', toggleVideo);
    document.getElementById('call-btn-flip').addEventListener('click', flipCamera);
    document.getElementById('call-btn-screen').addEventListener('click', toggleScreenShare);

    document.getElementById('call-reaction-open-btn').addEventListener('click', e => { e.stopPropagation(); toggleReactionPicker(); });
    document.querySelectorAll('.call-reaction-emoji').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); sendCallReaction(btn.dataset.emoji); document.getElementById('call-reaction-picker').classList.remove('visible'); });
    });
    document.addEventListener('click', e => {
        const picker = document.getElementById('call-reaction-picker'), trigger = document.getElementById('call-reaction-open-btn');
        if (picker && !picker.contains(e.target) && e.target !== trigger) picker.classList.remove('visible');
    });
    updateCallButtonState();
    updateGroupCallButtonState();
}

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
function createWelcomeScreenStyles() {
    if (document.getElementById('welcome-screen-style')) return;
    const style = document.createElement('style');
    style.id = 'welcome-screen-style';
    style.textContent = `
        body.welcome-screen-open { overflow: hidden; }
        #welcome-screen-overlay {
            position: fixed;
            inset: 0;
            overflow-y: auto;
            background: radial-gradient(circle at top, rgba(37, 94, 255, 0.18), transparent 28%),
                        linear-gradient(135deg, rgba(0, 0, 0, 0.95), rgba(7, 13, 24, 0.98));
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 32px 18px;
            z-index: 99999;
            color: #fff;
            backdrop-filter: blur(8px);
        }
        #welcome-screen-overlay::before {
            content: '';
            position: absolute;
            inset: 0;
            background: url('9d37a8ab76ebc8086da37442fc815b7a.gif') center / 220px no-repeat;
            opacity: 0.08;
            pointer-events: none;
        }
        .welcome-card {
            position: relative;
            width: min(100%, 720px);
            max-width: 720px;
            max-height: min(92vh, 860px);
            padding: 34px;
            border-radius: 32px;
            background: rgba(7, 15, 32, 0.94);
            box-shadow: 0 32px 110px rgba(0, 0, 0, 0.45);
            border: 1px solid rgba(255, 255, 255, 0.12);
            text-align: center;
            overflow: hidden;
        }
        .welcome-card-inner {
            max-height: calc(92vh - 80px);
            overflow-y: auto;
            padding-right: 6px;
        }
        .welcome-card-inner::-webkit-scrollbar { width: 6px; }
        .welcome-card-inner::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.22); border-radius: 999px; }
        .welcome-card::after {
            content: '';
            position: absolute;
            inset: -50%;
            background: radial-gradient(circle, rgba(69, 103, 255, 0.12), transparent 32%);
            pointer-events: none;
        }
        .welcome-card * { position: relative; z-index: 1; }
        .welcome-title {
            margin: 0;
            font-size: clamp(2rem, 4vw, 3.2rem);
            letter-spacing: -0.03em;
            text-transform: uppercase;
            text-shadow: 0 18px 40px rgba(0, 0, 0, 0.22);
        }
        .welcome-text {
            margin: 18px auto 32px;
            max-width: 85%;
            color: rgba(255, 255, 255, 0.85);
            line-height: 1.7;
            font-size: 1rem;
        }
        .welcome-art { display: grid; place-items: center; margin-bottom: 28px; }
        .welcome-main-gif {
            width: 100%; max-width: 440px;
            border-radius: 24px;
            box-shadow: 0 28px 100px rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(255, 255, 255, 0.12);
            transform: translateZ(0);
        }
        .welcome-features {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 14px;
            margin: 0 auto 22px;
            width: min(100%, 680px);
            text-align: left;
        }
        .feature-card {
            padding: 18px 16px; border-radius: 20px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.08);
            box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03);
        }
        .feature-card strong { display: block; margin-bottom: 8px; font-size: 0.98rem; color: #fff; }
        .feature-card span { display: block; color: rgba(255, 255, 255, 0.75); font-size: 0.92rem; line-height: 1.55; }
        .welcome-loader {
            margin: 24px auto 16px; width: 112px; height: 112px; border-radius: 50%;
            display: grid; place-items: center;
            border: 1px solid rgba(255, 255, 255, 0.16);
            background: rgba(255, 255, 255, 0.06);
        }
        .welcome-loader img { width: 76px; height: 76px; object-fit: contain; animation: welcome-pulse 1.8s ease-in-out infinite; }
        @keyframes welcome-pulse { 0%, 100% { transform: scale(1); opacity: 0.95; } 50% { transform: scale(1.06); opacity: 1; } }
        .welcome-continue-btn {
            margin: 0 auto 8px; padding: 16px 28px;
            border: none; border-radius: 999px;
            font-size: 1rem; font-weight: 700; letter-spacing: 0.02em; color: #fff;
            background: linear-gradient(135deg, #4a6dff, #2dc4ff);
            box-shadow: 0 18px 40px rgba(42, 116, 255, 0.25);
            cursor: pointer; transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .welcome-continue-btn:hover { transform: translateY(-2px); box-shadow: 0 22px 48px rgba(42, 116, 255, 0.3); }
        .welcome-note { margin: 0; font-size: 0.95rem; color: rgba(255, 255, 255, 0.65); }
        #welcome-screen-overlay.fade-out { opacity: 0; transition: opacity 0.26s ease; }
    `;
    document.head.appendChild(style);
}

function closeWelcomeScreen(overlay) {
    if (!overlay) overlay = document.getElementById('welcome-screen-overlay');
    if (!overlay) return;
    overlay.classList.add('fade-out');
    document.body.classList.remove('welcome-screen-open');
    setTimeout(() => { overlay.remove(); }, 260);
}

function showWelcomeScreenIfNeeded() {
    if (sessionStorage.getItem(WELCOME_SESSION_KEY)) return;
    createWelcomeScreenStyles();
    const overlay = document.createElement('div');
    overlay.id = 'welcome-screen-overlay';
    overlay.innerHTML = `
        <div class="welcome-card">
            <div class="welcome-card-inner">
                <div class="welcome-art">
                    <img src="9d37a8ab76ebc8086da37442fc815b7a.gif" alt="Bienvenue" class="welcome-main-gif">
                </div>
                <h1 class="welcome-title">Bienvenue sur ta messagerie</h1>
                <p class="welcome-text">Voici ton espace privé de discussion. Appels vidéo, envoi de fichiers, messages vocaux et chat en temps réel — tout est prêt pour toi.</p>
                <div class="welcome-features">
                    <div class="feature-card">
                        <strong>📞 Appels vidéo</strong>
                        <span>Parle en direct avec tes contacts, et bascule vers la caméra quand tu veux.</span>
                    </div>
                    <div class="feature-card">
                        <strong>📁 Photos & vidéos</strong>
                        <span>Partage tes médias directement depuis ton mobile ou ton ordi.</span>
                    </div>
                    <div class="feature-card">
                        <strong>🎤 Messages vocaux</strong>
                        <span>Enregistre et envoie un message audio sans quitter la conversation.</span>
                    </div>
                </div>
                <div class="welcome-loader">
                    <img src="9d37a8ab76ebc8086da37442fc815b7a.gif" alt="Chargement" aria-label="Chargement en cours">
                </div>
                <button id="welcome-continue-btn" class="welcome-continue-btn">Continuer vers le chat</button>
                <p class="welcome-note">Clique sur continuer quand tu es prêt.</p>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    document.body.classList.add('welcome-screen-open');
    const button = overlay.querySelector('#welcome-continue-btn');
    button?.addEventListener('click', () => {
        sessionStorage.setItem(WELCOME_SESSION_KEY, '1');
        closeWelcomeScreen(overlay);
    });
}

window.onload = async () => {
    showWelcomeScreenIfNeeded();
    injectChatInputButtons();
    injectVoiceUI();
    injectFileUploadUI();
    injectGroupUI();
    injectCallUI();
    groups = [];
    refreshGroupSelector();
    refreshTargetModeUI();

    await getUsers();
    const autoLogged = await checkAutoLogin();
    if (!autoLogged) {
        const restored = await restoreSession();
        if (!restored) { chatMessages.innerHTML = ''; }
    }
};

window.addEventListener('beforeunload', () => {
    if (callState !== 'idle' && callPeerUserId && currentCallId)
        sendCallSignal(callPeerUserId, { type: 'ended', callId: currentCallId, callerId: currentUserId });
    if (isRecording) cancelVoiceRecording();
});