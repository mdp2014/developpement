const supabaseUrl = 'https://toglujtvmslqutjeqmrh.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvZ2x1anR2bXNscXV0amVxbXJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1ODg0OTUsImV4cCI6MjA4OTE2NDQ5NX0.uezhrVRl2FTtVRfgXBMAnxcwROUNc91ruVegsyMD38U';

const regUsername        = document.getElementById('reg-username');
const regPassword        = document.getElementById('reg-password');
const regPasswordConfirm = document.getElementById('reg-password-confirm');
const regButton          = document.getElementById('reg-button');
const regError           = document.getElementById('reg-error');
const successOverlay     = document.getElementById('success-overlay');
const confettiCanvas     = document.getElementById('confetti-canvas');

// ============================================================
// ERROR / UI HELPERS
// ============================================================
function showError(message) {
    regError.textContent = message;
    regError.style.display = 'block';
    void regError.offsetWidth;
    regError.style.animation = 'none';
    void regError.offsetWidth;
    regError.style.animation = '';
}

function hideError() {
    regError.style.display = 'none';
}

function markInvalid(input) {
    input.classList.remove('valid');
    input.classList.add('invalid');
    input.addEventListener('animationend', () => input.classList.remove('invalid'), { once: true });
}

function markValid(input) {
    input.classList.remove('invalid');
    input.classList.add('valid');
}

function clearState(input) {
    input.classList.remove('valid', 'invalid');
}

// ============================================================
// LIVE VALIDATION
// ============================================================
regUsername.addEventListener('input', () => {
    clearState(regUsername);
    if (regUsername.value.trim().length >= 3) markValid(regUsername);
});

regPassword.addEventListener('input', () => {
    clearState(regPassword);
    if (regPassword.value.length >= 4) markValid(regPassword);
    if (regPasswordConfirm.value.length > 0) checkConfirmMatch();
});

regPasswordConfirm.addEventListener('input', checkConfirmMatch);

function checkConfirmMatch() {
    clearState(regPasswordConfirm);
    if (regPasswordConfirm.value.length === 0) return;
    regPassword.value === regPasswordConfirm.value
        ? markValid(regPasswordConfirm)
        : markInvalid(regPasswordConfirm);
}

// ============================================================
// VÉRIFICATION DISPONIBILITÉ USERNAME
// ============================================================
async function checkUsernameAvailable(username) {
    const r = await fetch(
        `${supabaseUrl}/rest/v1/users?select=id&username=eq.${encodeURIComponent(username)}`,
        { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
    );
    const data = await r.json();
    return data.length === 0;
}

// ============================================================
// CONFETTI ENGINE
// ============================================================
const confettiCtx = confettiCanvas.getContext('2d');
let confettiParticles = [];
let confettiAnimId    = null;

const COLORS = ['#6ee7b7','#818cf8','#f472b6','#fb923c','#facc15','#38bdf8','#a78bfa','#34d399'];

function resizeConfettiCanvas() {
    confettiCanvas.width  = window.innerWidth;
    confettiCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeConfettiCanvas);
resizeConfettiCanvas();

function createConfettiParticle() {
    const size = 6 + Math.random() * 8;
    return {
        x: confettiCanvas.width * Math.random(), y: -size,
        vx: (Math.random() - 0.5) * 4, vy: 2 + Math.random() * 3,
        rot: Math.random() * Math.PI * 2, rotV: (Math.random() - 0.5) * 0.4,
        size, color: COLORS[Math.floor(Math.random() * COLORS.length)],
        life: 1, decay: 0.003 + Math.random() * 0.004
    };
}

function launchConfetti() {
    confettiParticles = [];
    for (let i = 0; i < 100; i++) confettiParticles.push(createConfettiParticle());
    setTimeout(() => {
        for (let i = 0; i < 40; i++) confettiParticles.push(createConfettiParticle());
    }, 250);
    if (confettiAnimId) cancelAnimationFrame(confettiAnimId);
    animateConfetti();
}

function animateConfetti() {
    confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    for (let i = confettiParticles.length - 1; i >= 0; i--) {
        const p = confettiParticles[i];
        p.x += p.vx; p.y += p.vy; p.vy += 0.06; p.vx *= 0.995; p.rot += p.rotV;
        if (p.y > confettiCanvas.height * 0.75) p.life -= 0.025;
        if (p.life <= 0) { confettiParticles.splice(i, 1); continue; }
        confettiCtx.save();
        confettiCtx.translate(p.x, p.y);
        confettiCtx.rotate(p.rot);
        confettiCtx.globalAlpha = p.life;
        confettiCtx.fillStyle   = p.color;
        confettiCtx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
        confettiCtx.restore();
    }
    if (confettiParticles.length > 0) confettiAnimId = requestAnimationFrame(animateConfetti);
}

// ============================================================
// SUCCESS SCREEN + CONNEXION AUTOMATIQUE
// ============================================================

/**
 * Prépare la connexion automatique en stockant les credentials dans localStorage.
 * app.js les lira au démarrage via checkAutoLogin().
 */
function prepareAutoLogin(userId, username, plainPassword) {
    localStorage.setItem('pending_auto_login', JSON.stringify({
        userId,
        username,
        plainPassword
    }));
}

function showSuccess(userId, username, plainPassword) {
    // Préparer la connexion automatique avant l'animation
    prepareAutoLogin(userId, username, plainPassword);

    successOverlay.classList.add('visible');
    launchConfetti();

    // Rediriger vers l'app (avec connexion automatique via pending_auto_login)
    setTimeout(() => {
        window.location.href = 'index.html';
    }, 2800);
}

// ============================================================
// INSCRIPTION
// ============================================================
async function register() {
    hideError();

    const username        = regUsername.value.trim();
    const password        = regPassword.value;
    const passwordConfirm = regPasswordConfirm.value;

    if (!username)              { showError('Le nom d\'utilisateur est obligatoire.'); markInvalid(regUsername); return; }
    if (username.length < 3)    { showError('Le nom d\'utilisateur doit contenir au moins 3 caractères.'); markInvalid(regUsername); return; }
    if (!password)              { showError('Le mot de passe est obligatoire.'); markInvalid(regPassword); return; }
    if (password.length < 4)    { showError('Le mot de passe doit contenir au moins 4 caractères.'); markInvalid(regPassword); return; }
    if (password !== passwordConfirm) { showError('Les deux mots de passe ne correspondent pas.'); markInvalid(regPasswordConfirm); return; }

    regButton.disabled    = true;
    regButton.textContent = 'Vérification…';

    const available = await checkUsernameAvailable(username);
    if (!available) {
        showError('Ce nom d\'utilisateur est déjà utilisé.');
        markInvalid(regUsername);
        regButton.disabled    = false;
        regButton.textContent = 'S\'inscrire';
        return;
    }

    regButton.textContent = 'Création…';

    const response = await fetch(`${supabaseUrl}/rest/v1/users`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            // Important : on demande à Supabase de retourner le nouvel enregistrement
            // pour récupérer l'id généré automatiquement
            'Prefer': 'return=representation'
        },
        body: JSON.stringify({ username, password })
    });

    if (!response.ok) {
        const error = await response.json();
        console.error('Erreur inscription:', error);
        showError('Une erreur est survenue lors de la création du compte.');
        regButton.disabled    = false;
        regButton.textContent = 'S\'inscrire';
        return;
    }

    // Récupérer les données du nouvel utilisateur (id, username)
    const newUsers = await response.json();
    const newUser  = Array.isArray(newUsers) ? newUsers[0] : newUsers;

    if (!newUser || !newUser.id) {
        // Si l'id n'est pas retourné (selon la config Supabase), on le récupère
        const fetchRes = await fetch(
            `${supabaseUrl}/rest/v1/users?select=id,username&username=eq.${encodeURIComponent(username)}`,
            { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
        );
        const fetchData = await fetchRes.json();
        if (fetchData.length > 0) {
            showSuccess(fetchData[0].id, fetchData[0].username, password);
        } else {
            // Fallback : redirection simple sans auto-login
            successOverlay.classList.add('visible');
            launchConfetti();
            setTimeout(() => { window.location.href = 'index.html'; }, 2800);
        }
        return;
    }

    showSuccess(newUser.id, newUser.username, password);
}

regButton.addEventListener('click', register);
regPasswordConfirm.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); register(); }
});