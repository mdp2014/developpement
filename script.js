// Animation de fond avec des cercles flottants
const bgAnimation = document.createElement('div');
bgAnimation.classList.add('bg-animation');
document.body.appendChild(bgAnimation);

for (let i = 0; i < 40; i++) {
  const circle = document.createElement('div');
  circle.classList.add('circle');
  circle.style.width = circle.style.height = `${Math.random() * 80 + 40}px`;
  circle.style.left = `${Math.random() * 100}%`;
  circle.style.animationDuration = `${15 + Math.random() * 20}s`;
  bgAnimation.appendChild(circle);
}

// Animation d'entrée des cartes avec délai
const cards = document.querySelectorAll('.site-card');
cards.forEach((card, i) => {
  card.style.opacity = '0';
  card.style.transform = 'translateY(50px)';
  setTimeout(() => {
    card.style.transition = 'all 0.6s ease';
    card.style.opacity = '1';
    card.style.transform = 'translateY(0)';
  }, i * 250);
});

// Fonction de survol et clic des cartes
cards.forEach(card => {
  card.addEventListener('mouseover', () => {
    card.style.transform = 'scale(1.05)';
    card.style.boxShadow = '0 0 25px #ff7f50';
  });

  card.addEventListener('mouseout', () => {
    card.style.transform = 'scale(1)';
    card.style.boxShadow = 'none';
  });
});
