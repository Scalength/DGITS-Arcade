const gameList = document.querySelector('#game-list');
const gameFrame = document.querySelector('#game-frame');
const scoreList = document.querySelector('#score-list');
const scoreNotice = document.querySelector('#score-notice');
const refreshMark = document.querySelector('#refresh-mark');

let games = [];
let activeGame = null;

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
  const frameWrap = document.querySelector('#frame-wrap');
  if (document.fullscreenElement) await document.exitFullscreen();
  else await frameWrap.requestFullscreen();
});

async function initialize() {
  try {
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