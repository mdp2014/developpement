// Import de la bibliothèque emoji-picker
import 'https://cdn.jsdelivr.net/npm/emoji-picker-element@^1/index.js';

const supabaseUrl = 'https://unjdpzraozgcswfucezd.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVuamRwenJhb3pnY3N3ZnVjZXpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5NTMzOTQsImV4cCI6MjA4NTUyOTM5NH0.2fAnI9_Z-iay53GZ2UkXWxBnDULPC6Dm0sCK3XXIMwc';
const chatMessages      = document.getElementById('chat-messages');
const messageInput      = document.getElementById('message-input');
const sendButton        = document.getElementById('send-button');
const emojiButton       = document.getElementById('emoji-button');
const emojiPickerWrapper = document.getElementById('emoji-picker-wrapper');
const userSelect        = document.getElementById('user-select');
const loginUsername     = document.getElementById('login-username');
const loginPassword     = document.getElementById('login-password');
const loginButton       = document.getElementById('login-button');
const loginContainer    = document.getElementById('login-container');
const connectedUser     = document.getElementById('connected-user');
const connectedUsername = document.getElementById('connected-username');
const logoutButton      = document.getElementById('logout-button');
const typingIndicator   = document.getElementById('typing-indicator');

let users = {};
let currentUserId = null;
let refreshInterval = null;
let typingTimeout = null;
let isTyping = false;
let currentMessages = [];
let lastMessageCount = 0;
let emojiPickerInstance = null;
let emojiPickerOverlay = null;
let sessionValidationInterval = null;

const SESSION_STORAGE_KEY = 'persistent_session_v1';
const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 30; // 30 jours
const SESSION_CHECK_INTERVAL_MS = 1000 * 60 * 5; // 5 minutes

function generateRefreshToken() {
    const bytes = new Uint8Array(32);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const digest = await window.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

function loadSession() {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (error) {
        console.warn('Session corrompue, suppression du stockage.', error);
        localStorage.removeItem(SESSION_STORAGE_KEY);
        return null;
    }
}

function saveSession(session) {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

function clearSession() {
    localStorage.removeItem(SESSION_STORAGE_KEY);
}

function stopSessionValidation() {
    if (sessionValidationInterval) {
        clearInterval(sessionValidationInterval);
        sessionValidationInterval = null;
    }
}

async function validateSession(session) {
    if (!session || !session.userId || !session.refreshToken) {
        return false;
    }

    const now = Date.now();
    if (session.expiresAt && now > session.expiresAt) {
        return false;
    }

    try {
        const response = await fetch(
            `${supabaseUrl}/rest/v1/users?select=id,username,password&id=eq.${session.userId}`,
            {
                method: 'GET',
                headers: {
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`
                }
            }
        );
        const data = await response.json();
        if (!response.ok || data.length === 0) {
            return false;
        }

        const user = data[0];
        const serverPasswordDigest = await hashPassword(user.password);
        if (serverPasswordDigest !== session.passwordDigest) {
            return false;
        }

        session.username = user.username;
        session.lastValidatedAt = now;
        saveSession(session);
        return true;
    } catch (error) {
        console.warn('Validation de session indisponible:', error);
        return true;
    }
}

function startSessionValidation() {
    stopSessionValidation();
    sessionValidationInterval = setInterval(async () => {
        const session = loadSession();
        const isValid = await validateSession(session);
        if (!isValid) {
            logout({ silent: true, reason: 'Session expirée ou révoquée.' });
        }
    }, SESSION_CHECK_INTERVAL_MS);
}

async function restoreSession() {
    const session = loadSession();
    if (!session) return false;

    const isValid = await validateSession(session);
    if (!isValid) {
        clearSession();
        return false;
    }

    currentUserId = session.userId;
    users[session.userId] = { id: session.userId, username: session.username };

    loginContainer.style.display = 'none';
    connectedUser.style.display = 'block';
    connectedUsername.textContent = session.username;

    await requestNotificationPermission();
    getMessages();
    refreshMessages();
    startSessionValidation();
    return true;
}

// ============================================================
// EMOJI PICKER
// ============================================================
function initEmojiPicker() {
    emojiPickerInstance = document.querySelector('emoji-picker');
    
    // Écouter les sélections d'emoji
    emojiPickerInstance.addEventListener('emoji-click', (event) => {
        const cursorPos = messageInput.selectionStart || messageInput.value.length;
        const textBefore = messageInput.value.substring(0, cursorPos);
        const textAfter = messageInput.value.substring(cursorPos);
        
        messageInput.value = textBefore + event.detail.unicode + textAfter;
        
        // Remettre le curseur après l'emoji inséré
        const newCursorPos = cursorPos + event.detail.unicode.length;
        messageInput.setSelectionRange(newCursorPos, newCursorPos);
        
        // Garder le focus sur l'input
        messageInput.focus();
    });
}

function toggleEmojiPicker() {
    const isVisible = emojiPickerWrapper.style.display !== 'none';
    
    if (isVisible) {
        closeEmojiPicker();
    } else {
        openEmojiPicker();
    }
}

function openEmojiPicker() {
    // Créer l'overlay si nécessaire
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
    
    setTimeout(() => {
        emojiPickerWrapper.style.display = 'none';
        emojiPickerWrapper.classList.remove('hiding');
    }, 200);
    
    if (emojiPickerOverlay && emojiPickerOverlay.parentNode) {
        emojiPickerOverlay.parentNode.removeChild(emojiPickerOverlay);
        emojiPickerOverlay = null;
    }
}

// Initialiser le picker une fois le DOM chargé
document.addEventListener('DOMContentLoaded', initEmojiPicker);

// Toggle emoji picker au clic
emojiButton.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleEmojiPicker();
});

// Fermer le picker si on clique sur le bouton emoji alors qu'il est ouvert
document.addEventListener('click', (e) => {
    if (!emojiPickerWrapper.contains(e.target) && e.target !== emojiButton) {
        if (emojiPickerWrapper.style.display !== 'none') {
            closeEmojiPicker();
        }
    }
});

// ============================================================
// NOTIFICATIONS PUSH
// ============================================================
async function requestNotificationPermission() {
    if (!('Notification' in window)) {
        console.log('Ce navigateur ne supporte pas les notifications');
        return false;
    }

    if (Notification.permission === 'granted') {
        return true;
    }

    if (Notification.permission !== 'denied') {
        const permission = await Notification.requestPermission();
        return permission === 'granted';
    }

    return false;
}

function showNotification(title, body, icon = '💬') {
    if (Notification.permission === 'granted' && document.hidden) {
        const notification = new Notification(title, {
            body: body,
            icon: icon,
            badge: icon,
            tag: 'message-notification',
            requireInteraction: false,
            silent: false
        });

        notification.onclick = () => {
            window.focus();
            notification.close();
        };

        // Auto-fermer après 5 secondes
        setTimeout(() => notification.close(), 5000);
    }
}

// ============================================================
// GESTION DES UTILISATEURS
// ============================================================
async function getUsers() {
    const response = await fetch(`${supabaseUrl}/rest/v1/users?select=id,username`, {
        method: 'GET',
        headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`
        }
    });
    const data = await response.json();
    if (!response.ok) {
        console.error('Error fetching users:', data);
    } else {
        userSelect.innerHTML = '';
        data.forEach(user => {
            const option = document.createElement('option');
            option.value    = user.id;
            option.textContent = user.username;
            userSelect.appendChild(option);
            users[user.id] = user;
        });
    }
}

// ============================================================
// GÉOLOCALISATION
// ============================================================
function getGeolocation() {
    return new Promise((resolve, reject) => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                position => resolve({
                    latitude:  position.coords.latitude,
                    longitude: position.coords.longitude
                }),
                error => reject(error)
            );
        } else {
            reject(new Error('Geolocation is not supported by this browser.'));
        }
    });
}

async function getCityFromCoordinates(latitude, longitude) {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`);
    const data = await response.json();
    return data.address.city || data.address.town || data.address.village || 'Unknown';
}

// ============================================================
// INDICATEUR "EN TRAIN D'ÉCRIRE"
// ============================================================
async function updateTypingStatus(isTypingNow) {
    if (!currentUserId || !userSelect.value) return;

    try {
        // Vérifier si un statut existe déjà
        const checkResponse = await fetch(
            `${supabaseUrl}/rest/v1/typing_status?user_id=eq.${currentUserId}&recipient_id=eq.${userSelect.value}`,
            {
                method: 'GET',
                headers: {
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`
                }
            }
        );
        const existingStatus = await checkResponse.json();

        if (existingStatus.length > 0) {
            // Mettre à jour le statut existant
            await fetch(
                `${supabaseUrl}/rest/v1/typing_status?user_id=eq.${currentUserId}&recipient_id=eq.${userSelect.value}`,
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'apikey': supabaseKey,
                        'Authorization': `Bearer ${supabaseKey}`
                    },
                    body: JSON.stringify({
                        is_typing: isTypingNow,
                        updated_at: new Date().toISOString()
                    })
                }
            );
        } else {
            // Créer un nouveau statut
            await fetch(`${supabaseUrl}/rest/v1/typing_status`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`,
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify({
                    user_id: currentUserId,
                    recipient_id: userSelect.value,
                    is_typing: isTypingNow,
                    updated_at: new Date().toISOString()
                })
            });
        }
    } catch (error) {
        console.error('Erreur lors de la mise à jour du statut de frappe:', error);
    }
}

async function checkTypingStatus() {
    if (!currentUserId || !userSelect.value) {
        typingIndicator.style.display = 'none';
        return;
    }

    try {
        const response = await fetch(
            `${supabaseUrl}/rest/v1/typing_status?user_id=eq.${userSelect.value}&recipient_id=eq.${currentUserId}&select=*`,
            {
                method: 'GET',
                headers: {
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`
                }
            }
        );
        const data = await response.json();

        if (data.length > 0) {
            const status = data[0];
            const updatedAt = new Date(status.updated_at);
            const now = new Date();
            const secondsSinceUpdate = (now - updatedAt) / 1000;

            // Afficher l'indicateur seulement si la mise à jour est récente (moins de 3 secondes)
            if (status.is_typing && secondsSinceUpdate < 3) {
                const recipientName = users[userSelect.value]?.username || 'L\'utilisateur';
                typingIndicator.textContent = `${recipientName} est en train d'écrire...`;
                typingIndicator.style.display = 'block';
            } else {
                typingIndicator.style.display = 'none';
            }
        } else {
            typingIndicator.style.display = 'none';
        }
    } catch (error) {
        console.error('Erreur lors de la vérification du statut de frappe:', error);
    }
}

// Gérer la saisie dans le champ de message
messageInput.addEventListener('input', () => {
    if (!isTyping) {
        isTyping = true;
        updateTypingStatus(true);
    }

    // Réinitialiser le timeout
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        isTyping = false;
        updateTypingStatus(false);
    }, 2000); // Arrêter après 2 secondes d'inactivité
});

// ============================================================
// ENVOI DE MESSAGES
// ============================================================
async function sendMessage(userId, content) {
    console.log('Sending message:', { userId, content });
    let latitude = null, longitude = null, city = null;

    try {
        const geolocation = await getGeolocation();
        latitude  = geolocation.latitude;
        longitude = geolocation.longitude;
        city      = await getCityFromCoordinates(latitude, longitude);
    } catch (error) {
        console.warn('Géolocalisation indisponible, message envoyé sans position :', error);
    }

    // Arrêter l'indicateur de frappe
    isTyping = false;
    clearTimeout(typingTimeout);
    await updateTypingStatus(false);

    try {
        const response = await fetch(`${supabaseUrl}/rest/v1/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`
            },
            body: JSON.stringify({
                id_sent:     userId,
                content:     content,
                created_at:  new Date().toISOString(),
                id_received: userSelect.value,
                read_at:     null,
                latitude:    latitude,
                longitude:   longitude,
                city:        city
            })
        });
        const data = await response.json();
        if (!response.ok) {
            console.error('Error inserting message:', data);
        } else {
            console.log('Message inserted:', data);
            getMessages();
            return true;
        }
    } catch (error) {
        console.error('Error sending message:', error);
    }
    return false;
}

// ============================================================
// ACCUSÉS DE RÉCEPTION
// ============================================================
async function markMessagesAsRead() {
    if (!currentUserId || !userSelect.value) return;

    try {
        // Marquer comme lus tous les messages reçus de l'utilisateur sélectionné qui ne sont pas encore lus
        const response = await fetch(
            `${supabaseUrl}/rest/v1/messages?id_sent=eq.${userSelect.value}&id_received=eq.${currentUserId}&read_at=is.null`,
            {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`,
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify({
                    read_at: new Date().toISOString()
                })
            }
        );

        if (response.ok) {
            console.log('Messages marqués comme lus');
        }
    } catch (error) {
        console.error('Erreur lors du marquage des messages comme lus:', error);
    }
}

// ============================================================
// RÉCUPÉRATION DES MESSAGES
// ============================================================
async function deleteMessage(messageId) {
    const response = await fetch(`${supabaseUrl}/rest/v1/messages?id=eq.${messageId}`, {
        method: 'DELETE',
        headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`
        }
    });
    if (!response.ok) {
        console.error('Error deleting message:', await response.json());
    } else {
        console.log('Message deleted:', messageId);
        getMessages();
    }
}

async function getMessages() {
    if (!currentUserId || !userSelect.value) {
        chatMessages.innerHTML = '';
        currentMessages = [];
        lastMessageCount = 0;
        return;
    }

    console.log('Fetching messages...');
    const query = `${supabaseUrl}/rest/v1/messages?select=*&order=created_at.asc&or=(and(id_sent.eq.${currentUserId},id_received.eq.${userSelect.value}),and(id_sent.eq.${userSelect.value},id_received.eq.${currentUserId}))`;
    const response = await fetch(query, {
        method: 'GET',
        headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`
        }
    });
    const data = await response.json();
    if (!response.ok) {
        console.error('Error fetching messages:', data);
    } else {
        console.log('Messages fetched:', data);
        
        // Détecter les nouveaux messages pour les notifications
        if (data.length > lastMessageCount && lastMessageCount > 0) {
            const newMessages = data.slice(lastMessageCount);
            newMessages.forEach(msg => {
                if (msg.id_sent === userSelect.value && msg.id_received === currentUserId) {
                    const senderName = users[msg.id_sent]?.username || 'Un utilisateur';
                    showNotification(
                        `Nouveau message de ${senderName}`,
                        msg.content.substring(0, 50) + (msg.content.length > 50 ? '...' : '')
                    );
                }
            });
        }
        lastMessageCount = data.length;

        // Marquer les messages comme lus
        await markMessagesAsRead();
        
        // Vérifier s'il y a de nouveaux messages ou des suppressions
        const dataIds = data.map(m => m.id);
        const currentIds = currentMessages.map(m => m.id);
        const hasChanges = dataIds.length !== currentIds.length || 
                          dataIds.some((id, idx) => id !== currentIds[idx]) ||
                          data.some((msg, idx) => currentMessages[idx]?.read_at !== msg.read_at);
        
        // Ne redessiner que s'il y a des changements
        if (hasChanges) {
            // Sauvegarder la position de scroll actuelle
            const wasAtBottom = chatMessages.scrollHeight - chatMessages.scrollTop <= chatMessages.clientHeight + 50;
            
            currentMessages = data;
            chatMessages.innerHTML = '';
            let lastDate = null;

            data.forEach(message => {
                const dateObj   = new Date(message.created_at);
                const messageDate = dateObj.toLocaleDateString();
                const messageTime = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const senderName  = users[message.id_sent]?.username || 'Unknown';

                // Date separator
                if (messageDate !== lastDate) {
                    const dateElement = document.createElement('div');
                    dateElement.textContent = messageDate;
                    dateElement.classList.add('date');
                    chatMessages.appendChild(dateElement);
                    lastDate = messageDate;
                }

                // Bubble wrapper
                const messageElement = document.createElement('div');
                messageElement.classList.add('message');

                // Sender label
                const senderSpan = document.createElement('span');
                senderSpan.classList.add('msg-sender');
                senderSpan.textContent = senderName;

                // Main text
                const textNode = document.createTextNode(message.content);

                // Meta (city + time + read status)
                const metaSpan = document.createElement('span');
                metaSpan.classList.add('msg-meta');
                
                let metaText = message.city
                    ? `📍 ${message.city} · ${messageTime}`
                    : messageTime;

                // Ajouter l'indicateur de lecture pour les messages envoyés
                if (message.id_sent === currentUserId) {
                    if (message.read_at) {
                        metaText += ' · ✓✓ Lu';
                        metaSpan.classList.add('read');
                    } else {
                        metaText += ' · ✓ Envoyé';
                        metaSpan.classList.add('sent');
                    }
                }

                metaSpan.textContent = metaText;

                messageElement.appendChild(senderSpan);
                messageElement.appendChild(textNode);
                messageElement.appendChild(metaSpan);

                if (message.id_sent === currentUserId) {
                    messageElement.classList.add('sent');
                    // Delete button (only on own messages)
                    const deleteButton = document.createElement('span');
                    deleteButton.textContent = '✖';
                    deleteButton.classList.add('delete-button');
                    deleteButton.addEventListener('click', () => deleteMessage(message.id));
                    messageElement.appendChild(deleteButton);
                } else {
                    messageElement.classList.add('received');
                }

                chatMessages.appendChild(messageElement);
            });

            // Auto-scroll uniquement si l'utilisateur était déjà en bas
            if (wasAtBottom) {
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }
        }
    }
}

// ============================================================
// RAFRAÎCHISSEMENT
// ============================================================
function refreshMessages() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(() => {
        getMessages();
        checkTypingStatus();
    }, 1000); // Vérifier toutes les secondes
}

// ============================================================
// CONNEXION / DÉCONNEXION
// ============================================================
async function login() {
    const username = loginUsername.value.trim();
    const password = loginPassword.value;

    if (!username || !password) {
        alert('Veuillez remplir tous les champs');
        return;
    }

    try {
        const response = await fetch(
            `${supabaseUrl}/rest/v1/users?select=id,username,password&username=eq.${encodeURIComponent(username)}`,
            {
                method: 'GET',
                headers: {
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`
                }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            console.error('Erreur lors de la connexion:', data);
            alert('Erreur de connexion');
            return;
        }

        if (data.length === 0) {
            alert('Utilisateur non trouvé');
            return;
        }

        const user = data[0];

        if (user.password !== password) {
            alert('Mot de passe incorrect');
            return;
        }

        // Demander la permission pour les notifications
        await requestNotificationPermission();

        currentUserId = user.id;
        alert('Connexion réussie');
        loginContainer.style.display  = 'none';
        connectedUser.style.display   = 'block';
        connectedUsername.textContent  = user.username;
        
        users[user.id] = { id: user.id, username: user.username };

        const session = {
            userId: user.id,
            username: user.username,
            refreshToken: generateRefreshToken(),
            passwordDigest: await hashPassword(password),
            issuedAt: Date.now(),
            expiresAt: Date.now() + SESSION_DURATION_MS,
            lastValidatedAt: Date.now()
        };
        saveSession(session);
        
        getMessages();
        refreshMessages();
        startSessionValidation();

    } catch (error) {
        console.error('Erreur lors de la connexion:', error);
        alert('Erreur de connexion');
    }
}

async function logout(options = {}) {
    const { silent = false, reason = '' } = options;
    // Arrêter l'indicateur de frappe
    if (isTyping) {
        await updateTypingStatus(false);
    }
    
    // Fermer le emoji picker
    closeEmojiPicker();
    
    currentUserId = null;
    isTyping = false;
    clearTimeout(typingTimeout);
    
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
    stopSessionValidation();
    clearSession();
    loginContainer.style.display = 'block';
    connectedUser.style.display  = 'none';
    chatMessages.innerHTML       = '';
    currentMessages = [];
    lastMessageCount = 0;
    typingIndicator.style.display = 'none';

    if (!silent && reason) {
        alert(reason);
    }
}

// ============================================================
// ENVOI DE MESSAGES
// ============================================================
async function handleSend() {
    if (currentUserId) {
        const content = messageInput.value.trim();
        if (content !== '') {
            messageInput.value = '';
            messageInput.focus();
            
            await sendMessage(currentUserId, content);
        }
    } else {
        alert('Veuillez vous connecter pour envoyer un message');
    }
}

sendButton.addEventListener('click', handleSend);

messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        handleSend();
    }
});

loginButton.addEventListener('click', login);
logoutButton.addEventListener('click', logout);

loginPassword.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        login();
    }
});

window.onload = () => {
    getUsers().then(async () => {
        const restored = await restoreSession();
        if (!restored) {
            getMessages();
        }
    });
};

userSelect.addEventListener('change', () => {
    currentMessages = [];
    lastMessageCount = 0;
    typingIndicator.style.display = 'none';
    getMessages();
});

// Nettoyer le statut de frappe quand on quitte la page
window.addEventListener('beforeunload', () => {
    if (isTyping && currentUserId) {
        updateTypingStatus(false);
    }
});
