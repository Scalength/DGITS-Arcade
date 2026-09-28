const target = document.querySelector('#tap-target');
const scoreLabel = document.querySelector('#tap-number');
const form = document.querySelector('#score-form');
const statusLabel = document.querySelector('#game-status');
const submitButton = form.querySelector('button[type="submit"]');
let score = 0;
let submitted = false;

target.addEventListener('click', () => {
  score += 10;
  scoreLabel.textContent = String(score).padStart(2, '0');
  statusLabel.textContent = 'NICE. KEEP IT GOING.';
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (submitted) return;
  if (score < 1) {
    statusLabel.textContent = 'PLAY A ROUND FIRST.';
    return;
  }
  try {
    window.ArcadeSDK.submitScore({ score, playerName: document.querySelector('#player-name').value });
    submitted = true;
    submitButton.disabled = true;
    statusLabel.textContent = 'SCORE SENT TO THE BOARD.';
  } catch (error) {
    statusLabel.textContent = error.message.toUpperCase();
  }
});