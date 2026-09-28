const scorePanel = document.querySelector('#arcade-score-panel');
const scoreForm = document.querySelector('#arcade-score-form');
const playerNameInput = document.querySelector('#arcade-player-name');
const scoreLabel = document.querySelector('#arcade-score-value');
const scoreStatus = document.querySelector('#arcade-score-status');
const submitButton = scoreForm.querySelector('button[type="submit"]');
const continueButton = document.querySelector('#arcade-score-continue');

let finalScore = 0;
let scoreSubmitted = false;
let gameOverHooksInstalled = false;

if (me.state.GAME_OVER === undefined) me.state.GAME_OVER = me.state.GAMEOVER;

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

continueButton.addEventListener('click', () => me.state.change(me.state.MENU));

function installGameOverHooks() {
    if (gameOverHooksInstalled || typeof game.GameOverScreen !== 'function') return;

    const gameOverPrototype = game.GameOverScreen.prototype;
    const originalOnResetEvent = gameOverPrototype.onResetEvent;
    const originalOnDestroyEvent = gameOverPrototype.onDestroyEvent;

    Object.defineProperty(gameOverPrototype, 'onResetEvent', {
        configurable: true,
        writable: true,
        value: function () {
            originalOnResetEvent.apply(this, arguments);
            finalScore = Math.max(0, Number(game.data.steps) || 0);
            scoreLabel.textContent = String(finalScore);
            playerNameInput.value = '';
            scoreStatus.textContent = 'YOUR SCORE IS READY.';
            submitButton.disabled = false;
            scoreSubmitted = false;
            scorePanel.hidden = false;
            me.input.unbindKey(me.input.KEY.ENTER);
            me.input.unbindKey(me.input.KEY.SPACE);
            me.input.unbindPointer(me.input.pointer.LEFT);
            playerNameInput.focus();
        }
    });

    Object.defineProperty(gameOverPrototype, 'onDestroyEvent', {
        configurable: true,
        writable: true,
        value: function () {
            scorePanel.hidden = true;
            originalOnDestroyEvent.apply(this, arguments);
        }
    });
    gameOverHooksInstalled = true;
}

const originalGameLoaded = game.loaded;
game.loaded = function () {
    originalGameLoaded.apply(this, arguments);
    installGameOverHooks();
};

const gameOverHookTimer = window.setInterval(() => {
    installGameOverHooks();
    if (gameOverHooksInstalled) window.clearInterval(gameOverHookTimer);
}, 50);
