// rules.js: legal plays, trick winner, game-state transitions and result for Bridge declarer play, all on window.Bridge.
(function () {
  'use strict';

  var Bridge = window.Bridge = window.Bridge || {};
  if (!Bridge.SEATS || !Bridge.SUITS || !Bridge.RANKS || !Bridge.stringToCard || !Bridge.cardToString) {
    throw new Error('rules.js needs cards.js loaded first: put the cards.js <script> tag before the rules.js one');
  }

  var SEATS = Bridge.SEATS;
  var SUITS = Bridge.SUITS;
  var RANKS = Bridge.RANKS;

  // ---------------------------------------------------------------- private helpers

  function fail(message) {
    throw new Error(message);
  }

  // Accepts a card string or a {suit, rank} object and returns the card string (cards.js does not export this).
  function asCardString(card) {
    if (typeof card === 'string') {
      Bridge.stringToCard(card); // throws a clear error when malformed
      return card;
    }
    return Bridge.cardToString(card); // throws a clear error when malformed
  }

  function suitOf(cardString) {
    return cardString.charAt(0);
  }

  // Position of the card's rank in Bridge.RANKS (2 is lowest, A is highest).
  function rankValue(cardString) {
    return RANKS.indexOf(cardString.charAt(1));
  }

  function seatIndex(seat, label) {
    var i = SEATS.indexOf(seat);
    if (i < 0) fail(label + ' must be one of N, E, S, W, got ' + JSON.stringify(seat));
    return i;
  }

  function nextSeat(seat) {
    return SEATS[(seatIndex(seat, 'A seat') + 1) % 4];
  }

  function partnerSeat(seat) {
    return SEATS[(seatIndex(seat, 'A seat') + 2) % 4];
  }

  // N and S are one side, E and W the other.
  function sideOf(seat) {
    return seatIndex(seat, 'A seat') % 2 === 0 ? 'NS' : 'EW';
  }

  function isStrain(strain) {
    return strain === 'NT' || SUITS.indexOf(strain) >= 0;
  }

  // Checks a deal (four hands of 13 distinct valid cards) and returns its hands as arrays of card strings.
  function checkDeal(deal) {
    if (!deal || typeof deal !== 'object') {
      fail('newGame: the deal must be an object with hands N, E, S and W');
    }
    var seen = {};
    var hands = {};
    SEATS.forEach(function (seat) {
      var hand = deal[seat];
      if (!Array.isArray(hand)) fail('newGame: the deal has no ' + seat + ' hand');
      if (hand.length !== 13) {
        fail('newGame: the ' + seat + ' hand has ' + hand.length + ' cards, expected 13');
      }
      hands[seat] = hand.map(function (card) {
        var c = asCardString(card);
        if (seen[c]) fail('newGame: card ' + c + ' appears more than once in the deal');
        seen[c] = true;
        return c;
      });
    });
    return hands;
  }

  // Checks a contract and returns a copy of it.
  function checkContract(contract) {
    if (!contract || typeof contract !== 'object') {
      fail('newGame: the contract must be an object {level, strain, doubled, declarer}');
    }
    if (typeof contract.level !== 'number' || contract.level % 1 !== 0 || contract.level < 1 || contract.level > 7) {
      fail('newGame: contract level must be a whole number from 1 to 7, got ' + contract.level);
    }
    if (!isStrain(contract.strain)) {
      fail('newGame: contract strain must be C, D, H, S or NT, got ' + JSON.stringify(contract.strain));
    }
    if (contract.doubled !== undefined && contract.doubled !== 0 && contract.doubled !== 1 && contract.doubled !== 2) {
      fail('newGame: contract doubled must be 0, 1 or 2, got ' + contract.doubled);
    }
    seatIndex(contract.declarer, 'newGame: contract declarer');
    var copy = {};
    Object.keys(contract).forEach(function (key) { copy[key] = contract[key]; });
    return copy;
  }

  function requireState(state, fnName) {
    if (!state || typeof state !== 'object' || !state.contract || !state.deal || !state.handsRemaining ||
        !Array.isArray(state.currentTrick) || !Array.isArray(state.completedTricks) ||
        !state.tricksWon || SEATS.indexOf(state.toPlay) < 0) {
      fail(fnName + ': expected a Game state as returned by newGame or playCard');
    }
  }

  function cloneTrick(trick) {
    return trick.map(function (play) { return { seat: play.seat, card: play.card }; });
  }

  // A full copy, so the state passed in is never touched.
  function cloneState(state) {
    var contract = {};
    Object.keys(state.contract).forEach(function (key) { contract[key] = state.contract[key]; });
    var deal = {};
    var hands = {};
    SEATS.forEach(function (seat) {
      deal[seat] = state.deal[seat].slice();
      hands[seat] = state.handsRemaining[seat].slice();
    });
    return {
      deal: deal,
      contract: contract,
      handsRemaining: hands,
      currentTrick: cloneTrick(state.currentTrick),
      completedTricks: state.completedTricks.map(cloneTrick),
      toPlay: state.toPlay,
      tricksWon: { NS: state.tricksWon.NS, EW: state.tricksWon.EW }
    };
  }

  // ---------------------------------------------------------------- public functions

  // The dummy is declarer's partner.
  function dummySeat(contract) {
    if (!contract || typeof contract !== 'object') fail('dummySeat: expected a contract object');
    return partnerSeat(contract.declarer);
  }

  // A new Game state. The player to declarer's left makes the opening lead.
  function newGame(deal, contract) {
    var hands = checkDeal(deal);
    var checked = checkContract(contract);
    var dealCopy = {};
    var remaining = {};
    SEATS.forEach(function (seat) {
      dealCopy[seat] = hands[seat].slice();
      remaining[seat] = hands[seat].slice();
    });
    return {
      deal: dealCopy,
      contract: checked,
      handsRemaining: remaining,
      currentTrick: [],
      completedTricks: [],
      toPlay: nextSeat(checked.declarer),
      tricksWon: { NS: 0, EW: 0 }
    };
  }

  function isFinished(state) {
    requireState(state, 'isFinished');
    return state.completedTricks.length === 13;
  }

  // The cards (strings) the seat to play may play: follow suit if able, otherwise anything; any card may be led.
  function legalPlays(state) {
    requireState(state, 'legalPlays');
    if (isFinished(state)) return [];
    var hand = state.handsRemaining[state.toPlay];
    if (state.currentTrick.length === 0) return hand.slice();
    var led = suitOf(state.currentTrick[0].card);
    var following = hand.filter(function (c) { return suitOf(c) === led; });
    return following.length > 0 ? following : hand.slice();
  }

  // The seat that wins the trick. Highest trump if any trump was played, else highest card of the suit led.
  // In notrump (strain 'NT') there is no trump. The trick is in play order, so its first card is the lead.
  function trickWinner(trick, strain) {
    if (!isStrain(strain)) {
      fail('trickWinner: strain must be C, D, H, S or NT, got ' + JSON.stringify(strain));
    }
    if (!Array.isArray(trick) || trick.length < 1 || trick.length > 4) {
      fail('trickWinner: a trick needs 1 to 4 plays, got ' + (Array.isArray(trick) ? trick.length : JSON.stringify(trick)));
    }
    var plays = trick.map(function (play) {
      if (!play || typeof play !== 'object') fail('trickWinner: each play must be {seat, card}');
      seatIndex(play.seat, 'trickWinner: a play\'s seat');
      return { seat: play.seat, card: asCardString(play.card) };
    });
    var led = suitOf(plays[0].card);
    var bestKey = -1;
    var winner = null;
    plays.forEach(function (play) {
      var suit = suitOf(play.card);
      var tier = suit === strain ? 2 : (suit === led ? 1 : 0); // a trump beats the led suit, which beats any discard
      var key = tier * 100 + rankValue(play.card);
      if (key > bestKey) {
        bestKey = key;
        winner = play.seat;
      }
    });
    return winner;
  }

  // Plays the card (a string like "SA" or a {suit, rank} object) for the seat to play and returns a new state.
  // Throws an Error for an illegal play; the state passed in is never changed.
  function playCard(state, card) {
    requireState(state, 'playCard');
    var c = asCardString(card);
    if (isFinished(state)) {
      fail('Illegal play: the game is finished (all 13 tricks have been played), so ' + c + ' cannot be played');
    }
    var seat = state.toPlay;
    var hand = state.handsRemaining[seat];
    if (hand.indexOf(c) < 0) {
      fail('Illegal play: ' + seat + ' is to play but does not hold ' + c);
    }
    if (legalPlays(state).indexOf(c) < 0) {
      fail('Illegal play: ' + seat + ' must follow suit (' + suitOf(state.currentTrick[0].card) +
        ' was led) but played ' + c);
    }

    var next = cloneState(state);
    var nextHand = next.handsRemaining[seat];
    nextHand.splice(nextHand.indexOf(c), 1);
    next.currentTrick.push({ seat: seat, card: c });

    if (next.currentTrick.length < 4) {
      next.toPlay = nextSeat(seat);
      return next;
    }

    var trick = next.currentTrick;
    var winner = trickWinner(trick, next.contract.strain);
    next.completedTricks.push(trick);
    next.currentTrick = [];
    next.tricksWon[sideOf(winner)] += 1;
    next.toPlay = winner;
    return next;
  }

  // {tricksTaken (declarer's side), tricksNeeded (6 + level), made}. Throws if the game is not finished.
  function getResult(state) {
    requireState(state, 'getResult');
    if (!isFinished(state)) {
      fail('getResult: the game is not finished (' + state.completedTricks.length + ' of 13 tricks played)');
    }
    var taken = state.tricksWon[sideOf(state.contract.declarer)];
    var needed = 6 + state.contract.level;
    return { tricksTaken: taken, tricksNeeded: needed, made: taken >= needed };
  }

  // True when declarer or dummy is to play (the user plays both); false when a defender is.
  function isUserTurn(state) {
    requireState(state, 'isUserTurn');
    return state.toPlay === state.contract.declarer || state.toPlay === dummySeat(state.contract);
  }

  // ---------------------------------------------------------------- exports

  Bridge.newGame = newGame;
  Bridge.dummySeat = dummySeat;
  Bridge.legalPlays = legalPlays;
  Bridge.trickWinner = trickWinner;
  Bridge.playCard = playCard;
  Bridge.isFinished = isFinished;
  Bridge.getResult = getResult;
  Bridge.isUserTurn = isUserTurn;
})();
