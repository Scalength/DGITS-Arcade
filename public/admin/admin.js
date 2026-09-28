const scoreRows = document.querySelector('#score-rows');
const adminStatus = document.querySelector('#admin-status');
const refreshButton = document.querySelector('#refresh-button');

function appendEmptyState(message) {
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.className = 'admin-empty';
  cell.colSpan = 5;
  cell.textContent = message;
  row.append(cell);
  scoreRows.replaceChildren(row);
}

function createScoreRow(entry) {
  const row = document.createElement('tr');
  const date = document.createElement('td');
  date.textContent = new Date(entry.createdAt).toLocaleString();
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
  row.append(date, game, player, score, action);
  return row;
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
void loadEntries();