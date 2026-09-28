const gameList = document.querySelector('#game-list');
const gameFrame = document.querySelector('#game-frame');
const frameWrap = document.querySelector('#frame-wrap');
const scoreList = document.querySelector('#score-list');
const scoreNotice = document.querySelector('#score-notice');
const refreshMark = document.querySelector('#refresh-mark');
const clientSession = document.querySelector('#client-session');
const sessionCountdown = document.querySelector('#session-countdown');
const sessionEnded = document.querySelector('#session-ended');
const sessionEndedTitle = document.querySelector('#session-ended-title');
const sessionEndedMessage = document.querySelector('#session-ended-message');
const fullscreenButton = document.querySelector('#fullscreen-button');
const rewardsButton = document.querySelector('#rewards-button');
const rewardsMessage = document.querySelector('#rewards-message');

let games = [];
let activeGame = null;
let sessionExpiresAt = null;
let sessionTimer = null;
let sessionCheckTimer = null;
const gameLogos = {
  'quick-tap': '/dgit-tap.png',
  typer: '/dgit-type.jpg',
  'plapi-bird': '/dgit-flap.png',
  pacman: '/dgit-pac.png',
};

function formatRemaining(remainingMs) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function endClientSession({ title, message }) {
  if (sessionTimer !== null) window.clearInterval(sessionTimer);
  if (sessionCheckTimer !== null) window.clearInterval(sessionCheckTimer);
  sessionTimer = null;
  sessionCheckTimer = null;
  clientSession.hidden = true;
  gameFrame.src = 'about:blank';
  gameList.querySelectorAll('button').forEach((button) => { button.disabled = true; });
  fullscreenButton.disabled = true;
  document.querySelector('#game-title').textContent = title;
  document.querySelector('#game-description').textContent = message;
  sessionEndedTitle.textContent = title;
  sessionEndedMessage.textContent = message;
  sessionEnded.hidden = false;
  scoreList.replaceChildren();
  document.querySelector('#board-updated').textContent = 'SESSION INACTIVE';
  setNotice(message);
}

function updateSessionCountdown() {
  if (sessionExpiresAt === null) return;
  const remainingMs = sessionExpiresAt - Date.now();
  if (remainingMs <= 0) {
    endClientSession({ title: 'Session expired', message: 'Ask the arcade admin to add time, then check your session.' });
    return;
  }
  sessionCountdown.textContent = formatRemaining(remainingMs);
}

async function loadClientSession() {
  const response = await fetch('/api/session', { cache: 'no-store' });
  if (!response.ok) throw new Error('Session status could not be checked.');
  const session = await response.json();
  if (session.isLocal) return true;
  if (!session.registered) {
    endClientSession({ title: 'Device not registered', message: `Ask the arcade admin to register ${session.clientIp}.` });
    return false;
  }
  if (!session.active) {
    endClientSession({ title: 'Session expired', message: 'Ask the arcade admin to add time, then check your session.' });
    return false;
  }

  sessionExpiresAt = Date.now() + session.remainingMs;
  clientSession.hidden = false;
  updateSessionCountdown();
  sessionTimer = window.setInterval(updateSessionCountdown, 1000);
  sessionCheckTimer = window.setInterval(async () => {
    try {
      const response = await fetch('/api/session', { cache: 'no-store' });
      if (!response.ok) throw new Error('Session status could not be checked.');
      const currentSession = await response.json();
      if (!currentSession.isLocal && (!currentSession.registered || !currentSession.active)) {
        endClientSession({ title: 'Session ended', message: 'This device no longer has arcade access.' });
        return;
      }
      if (!currentSession.isLocal) sessionExpiresAt = Date.now() + currentSession.remainingMs;
    } catch {
      endClientSession({ title: 'Session check failed', message: 'The arcade could not verify this device session.' });
    }
  }, 5000);
  return true;
}

function setNotice(message, submitted = false) {
  scoreNotice.innerHTML = `<span class="score-notice-icon">${submitted ? '&#10003;' : '+'}</span><span></span>`;
  scoreNotice.lastElementChild.textContent = message;
}

function renderGames() {
  document.querySelector('#game-count').textContent = String(games.length).padStart(2, '0');
  gameList.replaceChildren(...games.map((game, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'game-choice';
    button.setAttribute('role', 'listitem');
    button.setAttribute('aria-current', String(game.id === activeGame?.id));
    button.style.setProperty('--game-accent', game.accent);
    button.innerHTML = `<span class="game-thumb" aria-hidden="true">${['+', '◉', '↗'][index % 3]}</span><span class="game-choice-copy"><span class="game-choice-title"></span><span class="game-choice-genre"></span></span><span class="game-choice-arrow" aria-hidden="true">›</span>`;
    const logoPath = gameLogos[game.id];
    if (logoPath) {
      const logo = document.createElement('img');
      logo.className = 'game-thumb-image';
      logo.src = logoPath;
      logo.alt = '';
      button.querySelector('.game-thumb').replaceChildren(logo);
    }
    button.querySelector('.game-choice-title').textContent = game.title;
    button.querySelector('.game-choice-genre').textContent = game.genre;
    button.addEventListener('click', () => selectGame(game));
    return button;
  }));
}

function selectGame(game) {
  activeGame = game;
  document.querySelector('#game-title').textContent = game.title;
  document.querySelector('#game-description').textContent = game.description;
  document.querySelector('#game-genre').textContent = game.genre;
  document.querySelector('#game-id-label').textContent = `ID: ${game.id}`;
  document.querySelector('.game-heading').style.setProperty('--active-accent', game.accent);
  frameWrap.style.aspectRatio = game.aspectRatio || '16 / 9';
  gameFrame.title = `${game.title} game`;
  gameFrame.src = `/games/${encodeURIComponent(game.id)}/index.html`;
  setNotice('Play a round. Your score will appear here.');
  renderGames();
  void loadLeaderboard();
}

function renderLeaderboard(entries) {
  if (!entries.length) {
    const empty = document.createElement('li');
    empty.className = 'empty-board';
    empty.textContent = 'No scores yet. Set the first record.';
    scoreList.replaceChildren(empty);
    return;
  }

  scoreList.replaceChildren(...entries.map((entry, index) => {
    const item = document.createElement('li');
    item.className = 'score-row';
    item.style.animationDelay = `${index * 28}ms`;
    const rank = document.createElement('span');
    rank.className = 'score-rank';
    rank.textContent = `#${String(entry.rank).padStart(2, '0')}`;
    const player = document.createElement('span');
    player.className = 'score-player';
    const playerName = document.createElement('span');
    playerName.textContent = entry.playerName;
    const date = document.createElement('span');
    date.className = 'score-date';
    date.textContent = new Date(entry.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    player.append(playerName, date);
    const points = document.createElement('span');
    points.className = 'score-points';
    points.textContent = Number(entry.score).toLocaleString();
    item.append(rank, player, points);
    return item;
  }));
}

async function loadLeaderboard() {
  if (!activeGame) return;
  const gameId = activeGame.id;
  refreshMark.classList.add('is-refreshing');
  try {
    const response = await fetch(`/api/leaderboard/${encodeURIComponent(gameId)}?limit=10`);
    if (!response.ok) throw new Error('Leaderboard request failed.');
    const entries = await response.json();
    if (activeGame?.id !== gameId) return;
    renderLeaderboard(entries);
    document.querySelector('#board-updated').textContent = `UPDATED ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    if (activeGame?.id === gameId) {
      const empty = document.createElement('li');
      empty.className = 'empty-board';
      empty.textContent = 'Could not load scores.';
      scoreList.replaceChildren(empty);
      document.querySelector('#board-updated').textContent = 'RETRYING';
    }
  } finally {
    refreshMark.classList.remove('is-refreshing');
  }
}

window.addEventListener('message', async (event) => {
  if (event.origin !== window.location.origin || event.source !== gameFrame.contentWindow) return;
  const message = event.data;
  if (message?.type !== 'arcade:submit-score' || message.gameId !== activeGame?.id) return;

  setNotice('Submitting score...');
  try {
    const response = await fetch('/api/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: message.gameId, score: message.score, playerName: message.playerName }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Score could not be saved.');
    setNotice(`${result.playerName}: ${result.score.toLocaleString()} points saved.`, true);
    await loadLeaderboard();
  } catch (error) {
    setNotice(error.message || 'Score could not be saved.');
  }
});

document.querySelector('#fullscreen-button').addEventListener('click', async () => {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await frameWrap.requestFullscreen();
});

document.querySelector('#session-recheck').addEventListener('click', () => window.location.reload());

rewardsButton.addEventListener('click', () => {
  const isExpanded = rewardsButton.getAttribute('aria-expanded') === 'true';
  rewardsButton.setAttribute('aria-expanded', String(!isExpanded));
  rewardsMessage.hidden = isExpanded;
  rewardsButton.lastElementChild.textContent = isExpanded ? '+' : '-';
});

async function initialize() {
  try {
    const hasSession = await loadClientSession();
    if (!hasSession) return;

    const response = await fetch('/api/games');
    if (!response.ok) throw new Error('Game registry could not be loaded.');
    games = await response.json();
    if (!games.length) throw new Error('No games are registered.');
    renderGames();
    selectGame(games[0]);
    window.setInterval(() => void loadLeaderboard(), 12000);
  } catch (error) {
    document.querySelector('#game-title').textContent = 'Arcade unavailable';
    document.querySelector('#game-description').textContent = error.message;
    scoreList.firstElementChild.textContent = 'Start the arcade server to play.';
  }
}

void initialize();