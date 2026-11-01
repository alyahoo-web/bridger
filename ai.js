// ai.js: picks a random legal card for a defender, using rules.js to decide what is legal.
(function () {
  'use strict';

  var Bridge = window.Bridge = window.Bridge || {};
  if (!Bridge.legalPlays || !Bridge.isUserTurn || !Bridge.isFinished) {
    throw new Error('ai.js needs rules.js loaded first: put the rules.js <script> tag before the ai.js one');
  }

  // Returns a random card string from the legal plays of the defender to play.
  // rng is optional (a function returning a number in [0, 1)); it defaults to Math.random.
  // Throws if the game is finished or it is declarer's or dummy's turn rather than a defender's.
  function randomDefenderCard(state, rng) {
    var random = rng === undefined ? Math.random : rng;
    if (typeof random !== 'function') {
      throw new Error('randomDefenderCard: rng must be a function returning a number from 0 up to (not including) 1');
    }
    if (Bridge.isFinished(state)) {
      throw new Error('randomDefenderCard: the game is finished, so there is nothing to play');
    }
    if (Bridge.isUserTurn(state)) {
      throw new Error('randomDefenderCard: it is ' + state.toPlay + ' to play, who is declarer or dummy, not a defender');
    }
    var plays = Bridge.legalPlays(state);
    if (plays.length === 0) {
      throw new Error('randomDefenderCard: ' + state.toPlay + ' has no legal play');
    }
    var x = random();
    if (typeof x !== 'number' || !(x >= 0 && x < 1)) {
      throw new Error('randomDefenderCard: rng must return a number from 0 up to (not including) 1, got ' + x);
    }
    return plays[Math.floor(x * plays.length)];
  }

  Bridge.randomDefenderCard = randomDefenderCard;
})();
