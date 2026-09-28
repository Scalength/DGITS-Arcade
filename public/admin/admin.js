const scoreRows = document.querySelector('#score-rows');
const adminStatus = document.querySelector('#admin-status');
const refreshButton = document.querySelector('#refresh-button');
const sessionRows = document.querySelector('#session-rows');
const sessionStatus = document.querySelector('#session-status');
const sessionForm = document.querySelector('#session-form');
const sessionIpInput = document.querySelector('#session-ip');
const sessionMinutesInput = document.querySelector('#session-minutes');
const grantSessionButton = document.querySelector('#grant-session-button');
const liveClock = document.querySelector('#live-clock');

function appendEmptyState(message) {
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.className = 'admin-empty';
  cell.colSpan = 6;
  cell.textContent = message;
  row.append(cell);
  scoreRows.replaceChildren(row);
}

function createScoreRow(entry) {
  const row = document.createElement('tr');
  const submittedAt = new Date(entry.createdAt);
  const date = document.createElement('td');
  date.textContent = submittedAt.toLocaleDateString();
  const time = document.createElement('td');
  time.textContent = submittedAt.toLocaleTimeString();
  const game = document.createElement('td');
  game.textContent = entry.gameId;
  const player = document.createElement('td');
  player.textContent = entry.playerName;
  const score = document.createElement('td');
  score.textContent = Number(entry.score).toLocaleString();
  const action = document.createElement('td');
  const removeButton = document.createElement('button');
  removeButton.className = 'remove-entry';
  removeButton.type = 'button';
  removeButton.textContent = 'Remove';
  removeButton.setAttribute('aria-label', `Remove score entry ${entry.id}`);
  removeButton.addEventListener('click', () => void removeEntry(entry, removeButton));
  action.append(removeButton);
  row.append(date, time, game, player, score, action);
  return row;
}

function formatRemaining(remainingMs) {
  if (remainingMs <= 0) return '00:00';
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function createSessionRow(session) {
  const row = document.createElement('tr');
  const ip = document.createElement('td');
  ip.className = 'session-ip';
  ip.textContent = session.clientIp;
  const remaining = document.createElement('td');
  remaining.className = `session-countdown${session.active ? '' : ' is-expired'}`;
  remaining.dataset.expiresAt = String(session.expiresAt);
  remaining.textContent = formatRemaining(session.remainingMs);
  const lastSeen = document.createElement('td');
  lastSeen.textContent = session.lastSeenAt ? new Date(session.lastSeenAt).toLocaleString() : 'Never';
  const expires = document.createElement('td');
  expires.textContent = new Date(session.expiresAt).toLocaleString();
  const status = document.createElement('td');
  status.className = session.active ? 'session-active' : 'session-expired';
  status.textContent = session.active ? 'ACTIVE' : 'EXPIRED';
  const action = document.createElement('td');
  const removeButton = document.createElement('button');
  removeButton.className = 'remove-session';
  removeButton.type = 'button';
  removeButton.textContent = 'Remove';
  removeButton.setAttribute('aria-label', `Remove access for ${session.clientIp}`);
  removeButton.addEventListener('click', () => void removeSession(session.clientIp, removeButton));
  action.append(removeButton);
  row.append(ip, remaining, lastSeen, expires, status, action);
  return row;
}

async function loadSessions() {
  sessionStatus.textContent = 'Loading client sessions...';
  try {
    const response = await fetch('/api/admin/sessions', { cache: 'no-store' });
    const sessions = await response.json();
    if (!response.ok) throw new Error(sessions.error || 'Client sessions could not be loaded.');
    if (!sessions.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.className = 'admin-empty';
      cell.colSpan = 6;
      cell.textContent = 'No registered client sessions.';
      row.append(cell);
      sessionRows.replaceChildren(row);
    } else {
      sessionRows.replaceChildren(...sessions.map(createSessionRow));
    }
    const activeCount = sessions.filter((session) => session.active).length;
    sessionStatus.textContent = `${activeCount} active of ${sessions.length} registered client ${sessions.length === 1 ? 'session' : 'sessions'}.`;
  } catch (error) {
    sessionStatus.textContent = error.message;
  }
}

async function removeSession(clientIp, button) {
  if (!window.confirm(`Remove arcade access for ${clientIp}? Their game will stop shortly.`)) return;

  button.disabled = true;
  try {
    const response = await fetch('/api/admin/sessions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip: clientIp }),
    });
    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.error || 'Client session could not be removed.');
    }
    sessionStatus.textContent = `Removed arcade access for ${clientIp}.`;
    await loadSessions();
  } catch (error) {
    button.disabled = false;
    sessionStatus.textContent = error.message;
  }
}

function updateClocks() {
  liveClock.textContent = new Date().toLocaleTimeString();
  for (const countdown of sessionRows.querySelectorAll('.session-countdown')) {
    const remainingMs = Number(countdown.dataset.expiresAt) - Date.now();
    countdown.textContent = formatRemaining(remainingMs);
    countdown.classList.toggle('is-expired', remainingMs <= 0);
  }
}

async function grantSession(event) {
  event.preventDefault();
  grantSessionButton.disabled = true;
  sessionStatus.textContent = 'Saving client session...';
  try {
    const response = await fetch('/api/admin/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip: sessionIpInput.value, minutes: Number(sessionMinutesInput.value) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Client time could not be added.');
    await loadSessions();
    sessionStatus.textContent = `${result.clientIp} now has ${formatRemaining(result.remainingMs)} remaining.`;
    sessionForm.reset();
    sessionMinutesInput.value = '60';
  } catch (error) {
    sessionStatus.textContent = error.message;
  } finally {
    grantSessionButton.disabled = false;
  }
}

async function loadEntries() {
  refreshButton.disabled = true;
  adminStatus.textContent = 'Loading score entries...';
  try {
    const response = await fetch('/api/admin/scores', { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Score entries could not be loaded.');
    if (!result.length) {
      appendEmptyState('No score entries found.');
    } else {
      scoreRows.replaceChildren(...result.map(createScoreRow));
    }
    adminStatus.textContent = `${result.length} recent score ${result.length === 1 ? 'entry' : 'entries'}.`;
  } catch (error) {
    appendEmptyState('Score entries could not be loaded.');
    adminStatus.textContent = error.message;
  } finally {
    refreshButton.disabled = false;
  }
}

async function removeEntry(entry, button) {
  if (!window.confirm(`Remove ${entry.playerName}'s score of ${entry.score}?`)) return;

  button.disabled = true;
  try {
    const response = await fetch(`/api/admin/scores/${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.error || 'Score entry could not be removed.');
    }
    adminStatus.textContent = `Removed ${entry.playerName}'s score.`;
    await loadEntries();
  } catch (error) {
    button.disabled = false;
    adminStatus.textContent = error.message;
  }
}

refreshButton.addEventListener('click', () => void loadEntries());
refreshButton.addEventListener('click', () => void loadSessions());
sessionForm.addEventListener('submit', (event) => void grantSession(event));
window.setInterval(updateClocks, 1000);
updateClocks();
void loadEntries();
void loadSessions();