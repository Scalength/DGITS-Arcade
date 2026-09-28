const scorePanel = document.querySelector('#arcade-score-panel');
const scoreForm = document.querySelector('#arcade-score-form');
const playerNameInput = document.querySelector('#arcade-player-name');
const scoreLabel = document.querySelector('#arcade-score-value');
const scoreStatus = document.querySelector('#arcade-score-status');
const invalidMessage = document.querySelector('#arcade-score-invalid');
const submitButton = scoreForm.querySelector('button[type="submit"]');
const replayButton = document.querySelector('#arcade-score-replay');

let finalScore = 0;
let scoreSubmitted = false;
let replayGame = null;

window.ArcadePacmanScore = Object.freeze({
    open(score, isValid, onReplay) {
        finalScore = Math.max(0, Number(score) || 0);
        replayGame = onReplay;
        scoreLabel.textContent = String(finalScore);
        playerNameInput.value = '';
        scoreSubmitted = false;
        submitButton.disabled = false;
        scoreForm.hidden = !isValid;
        invalidMessage.hidden = isValid;
        scoreStatus.textContent = isValid ? 'YOUR SCORE IS READY.' : 'THIS SCORE COULD NOT BE VERIFIED.';
        scorePanel.hidden = false;
        if (isValid) playerNameInput.focus();
    }
});

scoreForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (scoreSubmitted) return;

    try {
        window.ArcadeSDK.submitScore({ score: finalScore, playerName: playerNameInput.value });
        scoreSubmitted = true;
        submitButton.disabled = true;
        scoreStatus.textContent = 'SCORE SENT TO THE BOARD.';
    } catch (error) {
        scoreStatus.textContent = error.message.toUpperCase();
    }
});

replayButton.addEventListener('click', () => {
    scorePanel.hidden = true;
    if (replayGame) replayGame();
});
