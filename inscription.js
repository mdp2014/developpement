const supabaseUrl = 'https://unjdpzraozgcswfucezd.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVuamRwenJhb3pnY3N3ZnVjZXpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk5NTMzOTQsImV4cCI6MjA4NTUyOTM5NH0.2fAnI9_Z-iay53GZ2UkXWxBnDULPC6Dm0sCK3XXIMwc';

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
    // Trigger re-flow so the slideIn animation replays
    void regError.offsetWidth;
    regError.style.animation = 'none';
    void regError.offsetWidth;
    regError.style.animation = '';
}

function hideError() {
    regError.style.display = 'none';
}

// Shake an input and mark it invalid
function markInvalid(input) {
    input.classList.remove('valid');
    input.classList.add('invalid');
    // Remove class after animation ends so it can re-trigger
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
// LIVE VALIDATION FEEDBACK (while user types)
// ============================================================
regUsername.addEventListener('input', () => {
    clearState(regUsername);
    if (regUsername.value.trim().length >= 3) markValid(regUsername);
});

regPassword.addEventListener('input', () => {
    clearState(regPassword);
    if (regPassword.value.length >= 4) markValid(regPassword);
    // Re-check confirm match if both have value
    if (regPasswordConfirm.value.length > 0) checkConfirmMatch();
});

regPasswordConfirm.addEventListener('input', checkConfirmMatch);

function checkConfirmMatch() {
    clearState(regPasswordConfirm);
    if (regPasswordConfirm.value.length === 0) return;
    if (regPassword.value === regPasswordConfirm.value) {
        markValid(regPasswordConfirm);
    } else {
        markInvalid(regPasswordConfirm);
    }
}

// ============================================================
// SUPABASE — check username availability
// ============================================================
async function checkUsernameAvailable(username) {
    const response = await fetch(
        `${supabaseUrl}/rest/v1/users?select=id&username=eq.${encodeURIComponent(username)}`,
        {
            method: 'GET',
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`
            }
        }
    );
    const data = await response.json();
    return data.length === 0; // true si disponible
}

// ============================================================
// CONFETTI ENGINE (canvas-based)
// ============================================================
const confettiCtx = confettiCanvas.getContext('2d');
let confettiParticles = [];
let confettiAnimId = null;

const COLORS = [
    '#6ee7b7', '#818cf8', '#f472b6', '#fb923c',
    '#facc15', '#38bdf8', '#a78bfa', '#34d399'
];

function resizeConfettiCanvas() {
    confettiCanvas.width  = window.innerWidth;
    confettiCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeConfettiCanvas);
resizeConfettiCanvas();

function createConfettiParticle() {
    const size = 6 + Math.random() * 8;
    return {
        x:      confettiCanvas.width  * Math.random(),
        y:      -size,                                      // start above viewport
        vx:     (Math.random() - 0.5) * 4,
        vy:     2 + Math.random() * 3,                      // fall speed
        rot:    Math.random() * Math.PI * 2,
        rotV:   (Math.random() - 0.5) * 0.4,
        size:   size,
        color:  COLORS[Math.floor(Math.random() * COLORS.length)],
        life:   1,                                          // opacity multiplier
        decay:  0.003 + Math.random() * 0.004              // when to start fading
    };
}

function launchConfetti() {
    confettiParticles = [];
    // Burst: create 140 particles in two waves
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

        // Physics
        p.x  += p.vx;
        p.y  += p.vy;
        p.vy += 0.06;            // gravity
        p.vx *= 0.995;           // air drag
        p.rot += p.rotV;

        // Fade out near bottom
        if (p.y > confettiCanvas.height * 0.75) {
            p.life -= 0.025;
        }

        if (p.life <= 0) {
            confettiParticles.splice(i, 1);
            continue;
        }

        // Draw rectangle rotated around its centre
        confettiCtx.save();
        confettiCtx.translate(p.x, p.y);
        confettiCtx.rotate(p.rot);
        confettiCtx.globalAlpha = p.life;
        confettiCtx.fillStyle   = p.color;
        confettiCtx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
        confettiCtx.restore();
    }

    // Keep animating while particles remain
    if (confettiParticles.length > 0) {
        confettiAnimId = requestAnimationFrame(animateConfetti);
    }
}

// ============================================================
// SUCCESS SCREEN
// ============================================================
function showSuccess() {
    successOverlay.classList.add('visible');
    launchConfetti();

    // Redirect after overlay has been appreciated
    setTimeout(() => {
        window.location.href = 'index.html';
    }, 2800);
}

// ============================================================
// REGISTRATION FLOW (logic unchanged from original)
// ============================================================
async function register() {
    hideError();

    const username        = regUsername.value.trim();
    const password        = regPassword.value;
    const passwordConfirm = regPasswordConfirm.value;

    // --- Validations côté client ---
    if (username === '') {
        showError('Le nom d\'utilisateur est obligatoire.');
        markInvalid(regUsername);
        return;
    }
    if (username.length < 3) {
        showError('Le nom d\'utilisateur doit contenir au moins 3 caractères.');
        markInvalid(regUsername);
        return;
    }
    if (password === '') {
        showError('Le mot de passe est obligatoire.');
        markInvalid(regPassword);
        return;
    }
    if (password.length < 4) {
        showError('Le mot de passe doit contenir au moins 4 caractères.');
        markInvalid(regPassword);
        return;
    }
    if (password !== passwordConfirm) {
        showError('Les deux mots de passe ne correspondent pas.');
        markInvalid(regPasswordConfirm);
        return;
    }

    // --- Vérifie si le username est déjà pris ---
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

    // --- POST vers Supabase pour créer l'utilisateur ---
    regButton.textContent = 'Création…';

    const response = await fetch(`${supabaseUrl}/rest/v1/users`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`
        },
        body: JSON.stringify({
            username: username,
            password: password
        })
    });

    if (!response.ok) {
        const error = await response.json();
        console.error('Erreur inscription :', error);
        showError('Une erreur est survenue lors de la création du compte.');
        regButton.disabled    = false;
        regButton.textContent = 'S\'inscrire';
        return;
    }

    // --- Succès : affiche l'overlay animé + confettis ---
    showSuccess();
}

regButton.addEventListener('click', register);

// Permettre l'inscription avec Enter depuis le dernier champ
regPasswordConfirm.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        register();
    }
});