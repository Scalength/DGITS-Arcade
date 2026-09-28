(function () {
  'use strict';

  const match = window.location.pathname.match(/^\/games\/([^/]+)\//);
  const gameId = match ? decodeURIComponent(match[1]) : null;

  function submitScore({ score, playerName = 'Guest' }) {
    if (!gameId) throw new Error('ArcadeSDK must be loaded from a registered game iframe.');
    if (window.parent === window) throw new Error('ArcadeSDK scores must be submitted from an arcade iframe.');

    window.parent.postMessage({
      type: 'arcade:submit-score',
      gameId,
      score: Number(score),
      playerName: String(playerName).slice(0, 24),
    }, window.location.origin);
  }

  window.ArcadeSDK = Object.freeze({ submitScore });
})();