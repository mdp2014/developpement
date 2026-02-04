// Import de la bibliothèque emoji-picker
import 'https://cdn.jsdelivr.net/npm/emoji-picker-element@^1/index.js';

const supabaseUrl = 'https://unjdpzraozgcswfucezd.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVuamRwenJhb3pnY3N3ZnVjZXpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5NTMzOTQsImV4cCI6MjA4NTUyOTM5NH0.2fAnI9_Z-iay53GZ2UkXWxBnDULPC6Dm0sCK3XXIMwc';

// DOM Elements
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
const fileInput         = document.getElementById('file-input');
const attachButton      = document.getElementById('attach-button');
const voiceButton       = document.getElementById('voice-button');
const quickRepliesContainer = document.getElementById('quick-replies');
const summaryButton     = document.getElementById('summary-button');
const summaryModal      = document.getElementById('summary-modal');
const summaryContent    = document.getElementById('summary-content');
const closeSummary      = document.getElementById('close-summary');

// State variables
let users = {};
let currentUserId = null;
let refreshInterval = null;
let typingTimeout = null;
let isTyping = false;
let currentMessages = [];
let lastMessageCount = 0;
let emojiPickerInstance = null;
let emojiPickerOverlay = null;
let reminderCheckInterval = null;
let networkQuality = 'high'; // high, medium, low
let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];

// ============================================================
// 1. AUTO-REMINDER SYSTEM (Fonctionnalité 1)
// ============================================================
const REMINDER_CONFIG = {
    enabled: true,
    delayMinutes: 60, // Rappel après 1 heure sans réponse
    checkIntervalMinutes: 5 // Vérifier toutes les 5 minutes
};

async function checkForReminders() {
    if (!currentUserId || !REMINDER_CONFIG.enabled) return;

    try {
        // Récupérer les messages envoyés par l'utilisateur actuel
        const sentQuery = `${supabaseUrl}/rest/v1/messages?select=*&id_sent=eq.${currentUserId}&order=created_at.desc`;
        const sentResponse = await fetch(sentQuery, {
            method: 'GET',
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`
            }
        });
        const sentMessages = await sentResponse.json();

        // Grouper par destinataire et trouver le dernier message
        const conversationMap = new Map();
        
        sentMessages.forEach(msg => {
            if (!conversationMap.has(msg.id_received)) {
                conversationMap.set(msg.id_received, msg);
            }
        });

        // Vérifier si des réponses ont été reçues
        for (const [recipientId, lastSentMsg] of conversationMap) {
            const timeSinceSent = (Date.now() - new Date(lastSentMsg.created_at).getTime()) / 1000 / 60; // en minutes
            
            if (timeSinceSent >= REMINDER_CONFIG.delayMinutes) {
                // Vérifier s'il y a eu une réponse depuis
                const replyQuery = `${supabaseUrl}/rest/v1/messages?select=id&id_sent=eq.${recipientId}&id_received=eq.${currentUserId}&created_at=gt.${lastSentMsg.created_at}&limit=1`;
                const replyResponse = await fetch(replyQuery, {
                    method: 'GET',
                    headers: {
                        'apikey': supabaseKey,
                        'Authorization': `Bearer ${supabaseKey}`
                    }
                });
                const replies = await replyResponse.json();

                if (replies.length === 0) {
                    // Pas de réponse reçue - Envoyer un rappel
                    const recipientName = users[recipientId]?.username || 'Un utilisateur';
                    showNotification(
                        '⏰ Rappel',
                        `${recipientName} n'a pas encore répondu à votre message`,
                        '⏰'
                    );
                    
                    // Afficher également un badge dans l'interface si c'est la conversation active
                    if (userSelect.value === recipientId) {
                        displayReminderBadge();
                    }
                }
            }
        }
    } catch (error) {
        console.error('Erreur lors de la vérification des rappels:', error);
    }
}

function displayReminderBadge() {
    const existingBadge = document.querySelector('.reminder-badge');
    if (!existingBadge) {
        const badge = document.createElement('div');
        badge.className = 'reminder-badge';
        badge.innerHTML = '⏰ En attente de réponse';
        document.querySelector('.user-selection').appendChild(badge);
        
        setTimeout(() => badge.remove(), 5000);
    }
}

function startReminderChecks() {
    if (reminderCheckInterval) clearInterval(reminderCheckInterval);
    reminderCheckInterval = setInterval(checkForReminders, REMINDER_CONFIG.checkIntervalMinutes * 60 * 1000);
    checkForReminders(); // Vérification immédiate
}

// ============================================================
// 2. NETWORK QUALITY DETECTION & ADAPTIVE COMPRESSION
// ============================================================
function detectNetworkQuality() {
    if ('connection' in navigator) {
        const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        const effectiveType = connection.effectiveType;
        
        if (effectiveType === '4g' || effectiveType === 'wifi') {
            networkQuality = 'high';
        } else if (effectiveType === '3g') {
            networkQuality = 'medium';
        } else {
            networkQuality = 'low';
        }
        
        console.log('Network quality:', networkQuality);
        updateNetworkIndicator();
    }
}

function updateNetworkIndicator() {
    const indicator = document.getElementById('network-indicator');
    if (indicator) {
        const icons = {
            high: '📶',
            medium: '📡',
            low: '⚠️'
        };
        indicator.textContent = icons[networkQuality] || '';
    }
}

async function compressImage(file, quality = 0.8) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                
                // Compression selon la qualité réseau
                const maxSize = networkQuality === 'high' ? 1920 : 
                               networkQuality === 'medium' ? 1280 : 800;
                
                if (width > height && width > maxSize) {
                    height = (height * maxSize) / width;
                    width = maxSize;
                } else if (height > maxSize) {
                    width = (width * maxSize) / height;
                    height = maxSize;
                }
                
                canvas.width = width;
                canvas.height = height;
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                // Ajuster la qualité selon le réseau
                const compressionQuality = networkQuality === 'high' ? quality : 
                                          networkQuality === 'medium' ? quality * 0.7 : 
                                          quality * 0.5;
                
                canvas.toBlob((blob) => {
                    resolve(blob);
                }, file.type, compressionQuality);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function compressAudio(audioBlob) {
    // Compression audio basique selon la qualité réseau
    if (networkQuality === 'low') {
        // Convertir en qualité réduite (simulation - en production, utiliser un vrai encoder)
        return audioBlob; // Placeholder
    }
    return audioBlob;
}

// ============================================================
// 3. FILE SHARING (Images, fichiers, liens)
// ============================================================
async function handleFileUpload(file) {
    if (!file) return null;
    
    try {
        // Vérifier le type de fichier
        const isImage = file.type.startsWith('image/');
        const isAudio = file.type.startsWith('audio/');
        
        let processedFile = file;
        
        // Compresser si nécessaire
        if (isImage) {
            showUploadProgress('Compression de l\'image...');
            processedFile = await compressImage(file);
        } else if (isAudio) {
            showUploadProgress('Traitement audio...');
            processedFile = await compressAudio(file);
        }
        
        // Convertir en base64 pour stockage (simplifié - en production, utiliser un service de stockage)
        const base64 = await fileToBase64(processedFile);
        
        return {
            type: file.type,
            name: file.name,
            size: processedFile.size,
            data: base64
        };
    } catch (error) {
        console.error('Erreur lors du traitement du fichier:', error);
        return null;
    }
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function showUploadProgress(message) {
    const progressDiv = document.getElementById('upload-progress');
    if (progressDiv) {
        progressDiv.textContent = message;
        progressDiv.style.display = 'block';
        setTimeout(() => {
            progressDiv.style.display = 'none';
        }, 2000);
    }
}

// ============================================================
// 4. VOICE MESSAGES
// ============================================================
async function startVoiceRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];
        
        mediaRecorder.ondataavailable = (event) => {
            audioChunks.push(event.data);
        };
        
        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            const compressedAudio = await compressAudio(audioBlob);
            
            const fileData = await handleFileUpload(new File([compressedAudio], 'voice-message.webm', { type: 'audio/webm' }));
            
            if (fileData) {
                await sendMessage(currentUserId, '[Message vocal]', fileData);
            }
            
            stream.getTracks().forEach(track => track.stop());
        };
        
        mediaRecorder.start();
        isRecording = true;
        updateVoiceButton();
    } catch (error) {
        console.error('Erreur lors de l\'enregistrement vocal:', error);
        alert('Impossible d\'accéder au microphone');
    }
}

function stopVoiceRecording() {
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        updateVoiceButton();
    }
}

function updateVoiceButton() {
    if (voiceButton) {
        voiceButton.textContent = isRecording ? '⏹️' : '🎤';
        voiceButton.classList.toggle('recording', isRecording);
    }
}

// ============================================================
// 5. SMART QUICK REPLIES (Réponses rapides suggérées)
// ============================================================
async function generateQuickReplies(lastMessage) {
    if (!lastMessage) return [];
    
    const content = lastMessage.content.toLowerCase();
    const replies = [];
    
    // Règles heuristiques pour générer des réponses rapides
    if (content.includes('?') || content.includes('comment') || content.includes('quoi') || content.includes('où') || content.includes('quand')) {
        replies.push('Je vais vérifier et te dis ça');
        replies.push('Bonne question, laisse-moi réfléchir');
    }
    
    if (content.includes('merci') || content.includes('thanks')) {
        replies.push('De rien ! 😊');
        replies.push('Avec plaisir');
        replies.push('Pas de problème');
    }
    
    if (content.includes('ok') || content.includes('d\'accord')) {
        replies.push('Parfait !');
        replies.push('Super 👍');
    }
    
    if (content.includes('salut') || content.includes('bonjour') || content.includes('hello')) {
        replies.push('Salut ! Ça va ?');
        replies.push('Hello ! 👋');
        replies.push('Coucou !');
    }
    
    if (content.includes('ça va') || content.includes('comment vas-tu')) {
        replies.push('Très bien, et toi ?');
        replies.push('Ça va super ! Et toi ?');
        replies.push('Bien, merci !');
    }
    
    if (content.includes('oui') || content.includes('yes')) {
        replies.push('Cool !');
        replies.push('Génial !');
    }
    
    if (content.includes('non') || content.includes('no')) {
        replies.push('D\'accord, pas de souci');
        replies.push('Ok, compris');
    }
    
    // Réponses génériques si rien ne correspond
    if (replies.length === 0) {
        replies.push('Ok');
        replies.push('D\'accord');
        replies.push('👍');
    }
    
    return replies.slice(0, 3); // Maximum 3 suggestions
}

function displayQuickReplies(replies) {
    if (!quickRepliesContainer || replies.length === 0) return;
    
    quickRepliesContainer.innerHTML = '';
    quickRepliesContainer.style.display = 'flex';
    
    replies.forEach(reply => {
        const button = document.createElement('button');
        button.className = 'quick-reply-btn';
        button.textContent = reply;
        button.addEventListener('click', () => {
            messageInput.value = reply;
            handleSend();
            quickRepliesContainer.style.display = 'none';
        });
        quickRepliesContainer.appendChild(button);
    });
}

async function updateQuickReplies() {
    if (currentMessages.length > 0) {
        const lastReceivedMessage = [...currentMessages].reverse().find(msg => msg.id_sent !== currentUserId);
        if (lastReceivedMessage) {
            const replies = await generateQuickReplies(lastReceivedMessage);
            displayQuickReplies(replies);
        }
    }
}

// ============================================================
// 6. CONVERSATION SUMMARY (Résumé automatique)
// ============================================================
async function generateConversationSummary() {
    if (currentMessages.length < 5) {
        alert('La conversation est trop courte pour générer un résumé');
        return;
    }
    
    try {
        summaryContent.innerHTML = '<div class="loading">Génération du résumé en cours...</div>';
        summaryModal.style.display = 'flex';
        
        // Préparer le contexte de la conversation
        const conversationText = currentMessages.map(msg => {
            const sender = users[msg.id_sent]?.username || 'Utilisateur';
            return `${sender}: ${msg.content}`;
        }).join('\n');
        
        // Appel à l'API Anthropic pour générer le résumé
        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "claude-sonnet-4-20250514",
                max_tokens: 1000,
                messages: [
                    {
                        role: "user",
                        content: `Voici une conversation de messagerie instantanée. Génère un résumé concis et structuré qui met en avant :
- Les sujets principaux abordés
- Les décisions importantes prises
- Les actions à retenir ou les points à suivre

Conversation:
${conversationText}

Format le résumé en HTML avec des balises <h3>, <ul>, <li> pour une meilleure lisibilité. Sois concis et pertinent.`
                    }
                ],
            })
        });
        
        const data = await response.json();
        
        if (data.content && data.content[0]) {
            const summaryHTML = data.content[0].text;
            summaryContent.innerHTML = summaryHTML;
        } else {
            throw new Error('Impossible de générer le résumé');
        }
    } catch (error) {
        console.error('Erreur lors de la génération du résumé:', error);
        summaryContent.innerHTML = `
            <h3>📝 Résumé de la conversation</h3>
            <p><strong>Nombre de messages :</strong> ${currentMessages.length}</p>
            <p><strong>Participants :</strong> ${Object.values(users).map(u => u.username).join(', ')}</p>
            <p><em>Note : Le résumé automatique par IA n'est pas disponible pour le moment. Utilisez cette vue pour parcourir manuellement les messages importants.</em></p>
            <div class="summary-tips">
                <h4>Points clés à retenir :</h4>
                <ul>
                    <li>Vérifiez les dates et heures importantes</li>
                    <li>Notez les décisions prises</li>
                    <li>Identifiez les actions à suivre</li>
                </ul>
            </div>
        `;
    }
}

// ============================================================
// EMOJI PICKER (Code existant maintenu)
// ============================================================
function initEmojiPicker() {
    emojiPickerInstance = document.querySelector('emoji-picker');
    
    emojiPickerInstance.addEventListener('emoji-click', (event) => {
        const cursorPos = messageInput.selectionStart || messageInput.value.length;
        const textBefore = messageInput.value.substring(0, cursorPos);
        const textAfter = messageInput.value.substring(cursorPos);
        
        messageInput.value = textBefore + event.detail.unicode + textAfter;
        
        const newCursorPos = cursorPos + event.detail.unicode.length;
        messageInput.setSelectionRange(newCursorPos, newCursorPos);
        
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

document.addEventListener('DOMContentLoaded', initEmojiPicker);

emojiButton.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleEmojiPicker();
});

document.addEventListener('click', (e) => {
    if (!emojiPickerWrapper.contains(e.target) && e.target !== emojiButton) {
        if (emojiPickerWrapper.style.display !== 'none') {
            closeEmojiPicker();
        }
    }
});

// ============================================================
// NOTIFICATIONS PUSH (Code existant maintenu)
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

        setTimeout(() => notification.close(), 5000);
    }
}

// ============================================================
// GESTION DES UTILISATEURS (Code existant maintenu)
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
// GÉOLOCALISATION (Code existant maintenu)
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
// INDICATEUR "EN TRAIN D'ÉCRIRE" (Code existant maintenu)
// ============================================================
async function updateTypingStatus(isTypingNow) {
    if (!currentUserId || !userSelect.value) return;

    try {
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

            if (status.is_typing && secondsSinceUpdate < 3) {
                const recipientName = users[userSelect.value]?.username || 'L\'utilisateur';
                typingIndicator.innerHTML = `
                    <span class="typing-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                    </span>
                    ${recipientName} est en train d'écrire...
                `;
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

messageInput.addEventListener('input', () => {
    if (!isTyping) {
        isTyping = true;
        updateTypingStatus(true);
    }

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        isTyping = false;
        updateTypingStatus(false);
    }, 2000);
});

// ============================================================
// ENVOI DE MESSAGES (Modifié pour supporter les fichiers)
// ============================================================
async function sendMessage(userId, content, fileData = null) {
    console.log('Sending message:', { userId, content, fileData });
    let latitude = null, longitude = null, city = null;

    try {
        const geolocation = await getGeolocation();
        latitude  = geolocation.latitude;
        longitude = geolocation.longitude;
        city      = await getCityFromCoordinates(latitude, longitude);
    } catch (error) {
        console.warn('Géolocalisation indisponible:', error);
    }

    isTyping = false;
    clearTimeout(typingTimeout);
    await updateTypingStatus(false);

    try {
        const messageData = {
            id_sent:     userId,
            content:     content,
            created_at:  new Date().toISOString(),
            id_received: userSelect.value,
            read_at:     null,
            latitude:    latitude,
            longitude:   longitude,
            city:        city
        };

        // Ajouter les données du fichier si présentes
        if (fileData) {
            messageData.file_type = fileData.type;
            messageData.file_name = fileData.name;
            messageData.file_data = fileData.data;
            messageData.file_size = fileData.size;
        }

        const response = await fetch(`${supabaseUrl}/rest/v1/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`
            },
            body: JSON.stringify(messageData)
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
// ACCUSÉS DE RÉCEPTION (Code existant maintenu)
// ============================================================
async function markMessagesAsRead() {
    if (!currentUserId || !userSelect.value) return;

    try {
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
// RÉCUPÉRATION DES MESSAGES (Modifié pour afficher les fichiers)
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

        await markMessagesAsRead();
        
        const dataIds = data.map(m => m.id);
        const currentIds = currentMessages.map(m => m.id);
        const hasChanges = dataIds.length !== currentIds.length || 
                          dataIds.some((id, idx) => id !== currentIds[idx]) ||
                          data.some((msg, idx) => currentMessages[idx]?.read_at !== msg.read_at);
        
        if (hasChanges) {
            const wasAtBottom = chatMessages.scrollHeight - chatMessages.scrollTop <= chatMessages.clientHeight + 50;
            
            currentMessages = data;
            chatMessages.innerHTML = '';
            let lastDate = null;

            data.forEach(message => {
                const dateObj   = new Date(message.created_at);
                const messageDate = dateObj.toLocaleDateString();
                const messageTime = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const senderName  = users[message.id_sent]?.username || 'Unknown';

                if (messageDate !== lastDate) {
                    const dateElement = document.createElement('div');
                    dateElement.textContent = messageDate;
                    dateElement.classList.add('date');
                    chatMessages.appendChild(dateElement);
                    lastDate = messageDate;
                }

                const messageElement = document.createElement('div');
                messageElement.classList.add('message');

                const senderSpan = document.createElement('span');
                senderSpan.classList.add('msg-sender');
                senderSpan.textContent = senderName;

                messageElement.appendChild(senderSpan);

                // Afficher le fichier s'il existe
                if (message.file_data) {
                    const fileElement = createFileElement(message);
                    messageElement.appendChild(fileElement);
                }

                const textNode = document.createTextNode(message.content);
                messageElement.appendChild(textNode);

                const metaSpan = document.createElement('span');
                metaSpan.classList.add('msg-meta');
                
                let metaText = message.city
                    ? `📍 ${message.city} · ${messageTime}`
                    : messageTime;

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
                messageElement.appendChild(metaSpan);

                if (message.id_sent === currentUserId) {
                    messageElement.classList.add('sent');
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

            if (wasAtBottom) {
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }
            
            // Mettre à jour les réponses rapides
            updateQuickReplies();
        }
    }
}

function createFileElement(message) {
    const fileDiv = document.createElement('div');
    fileDiv.className = 'message-file';
    
    if (message.file_type.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = message.file_data;
        img.alt = message.file_name;
        img.className = 'message-image';
        fileDiv.appendChild(img);
    } else if (message.file_type.startsWith('audio/')) {
        const audio = document.createElement('audio');
        audio.src = message.file_data;
        audio.controls = true;
        audio.className = 'message-audio';
        fileDiv.appendChild(audio);
    } else {
        const fileLink = document.createElement('a');
        fileLink.href = message.file_data;
        fileLink.download = message.file_name;
        fileLink.className = 'message-file-link';
        fileLink.innerHTML = `📎 ${message.file_name} (${formatFileSize(message.file_size)})`;
        fileDiv.appendChild(fileLink);
    }
    
    return fileDiv;
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ============================================================
// RAFRAÎCHISSEMENT (Code existant maintenu)
// ============================================================
function refreshMessages() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(() => {
        getMessages();
        checkTypingStatus();
    }, 1000);
}

// ============================================================
// CONNEXION / DÉCONNEXION (Code existant maintenu avec rappels)
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

        await requestNotificationPermission();

        currentUserId = user.id;
        alert('Connexion réussie');
        loginContainer.style.display  = 'none';
        connectedUser.style.display   = 'block';
        connectedUsername.textContent  = user.username;
        
        users[user.id] = { id: user.id, username: user.username };
        
        detectNetworkQuality();
        getMessages();
        refreshMessages();
        startReminderChecks();

    } catch (error) {
        console.error('Erreur lors de la connexion:', error);
        alert('Erreur de connexion');
    }
}

async function logout() {
    if (isTyping) {
        await updateTypingStatus(false);
    }
    
    closeEmojiPicker();
    
    currentUserId = null;
    isTyping = false;
    clearTimeout(typingTimeout);
    
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
    
    if (reminderCheckInterval) {
        clearInterval(reminderCheckInterval);
        reminderCheckInterval = null;
    }
    
    loginContainer.style.display = 'block';
    connectedUser.style.display  = 'none';
    chatMessages.innerHTML       = '';
    currentMessages = [];
    lastMessageCount = 0;
    typingIndicator.style.display = 'none';
    if (quickRepliesContainer) {
        quickRepliesContainer.style.display = 'none';
    }
}

// ============================================================
// ENVOI DE MESSAGES (Code existant maintenu)
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

// ============================================================
// EVENT LISTENERS
// ============================================================
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

// File attachment
if (attachButton && fileInput) {
    attachButton.addEventListener('click', () => {
        fileInput.click();
    });
    
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            const fileData = await handleFileUpload(file);
            if (fileData) {
                const fileName = file.name;
                await sendMessage(currentUserId, `📎 ${fileName}`, fileData);
            }
            fileInput.value = ''; // Reset input
        }
    });
}

// Voice recording
if (voiceButton) {
    voiceButton.addEventListener('click', () => {
        if (isRecording) {
            stopVoiceRecording();
        } else {
            startVoiceRecording();
        }
    });
}

// Summary button
if (summaryButton) {
    summaryButton.addEventListener('click', generateConversationSummary);
}

if (closeSummary) {
    closeSummary.addEventListener('click', () => {
        summaryModal.style.display = 'none';
    });
}

// Network change detection
if ('connection' in navigator) {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    connection.addEventListener('change', detectNetworkQuality);
}

window.onload = () => {
    getUsers().then(() => {
        getMessages();
    });
};

userSelect.addEventListener('change', () => {
    currentMessages = [];
    lastMessageCount = 0;
    typingIndicator.style.display = 'none';
    if (quickRepliesContainer) {
        quickRepliesContainer.style.display = 'none';
    }
    getMessages();
});

window.addEventListener('beforeunload', () => {
    if (isTyping && currentUserId) {
        updateTypingStatus(false);
    }
});