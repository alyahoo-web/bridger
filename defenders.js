// defenders.js: double-dummy defenders (via dds.js) with a fixed tie-break; falls back to random defenders if DDS is unavailable.
/*
 * TIE-BREAK RULE (fixed and deterministic: the same position always gives the same card)
 *
 * DDS returns only cards that reach the best achievable number of tricks. Among those:
 *   1. Equivalent cards form a group (same suit, no unplayed card of that suit, and no card
 *      in the current trick, ranks between them). Only the LOWEST card of each group stays.
 *      (Groups are worked out here from the cards in play, not from DDS's "eq" flag.)
 *   2. Cover an honour: as second hand, if the card led is a J, Q or K, play the lowest
 *      remaining card of that suit that is a higher honour (Q, K or A), if there is one.
 *   3. Third hand high: as third hand, if any remaining card follows suit, play the highest.
 *   4. Otherwise play the lowest card (this covers leads, second hand without a cover,
 *      fourth hand and discards or ruffs).
 *   5. Any remaining tie (same rank in two suits) goes to the fixed suit order S, H, D, C.
 * The opening lead uses the same rule unless the deal has a valid `lead` (see checkLead).
 *
 * Declarer and dummy are never played from here: chooseDefenderCard throws on their turn.
 * Results are cached per position, so replaying or undoing never changes the defence.
 * If dds.js is missing or fails, random defenders (ai.js) are used and getDefenderNote()
 * returns a short message for the UI to show.
 *
 * Needs (loaded first): dds.js (optional), cards.js, rules.js, ai.js.
 * TODO Session G (service worker): add dds.js and defenders.js to the cache list.
 * DDS licence: see DDS-LICENSE.txt.
 *
 * Exports on window.Bridge:
 *   chooseDefenderCard(state, seat, options?)  -> card string; options = { lead } (opening lead only)
 *   defendersReady                             -> Promise resolving to 'dds' or 'random'
 *   defenderEngine()                           -> 'pending' | 'dds' | 'random'
 *   getDefenderNote()                          -> '' or a short user-facing message
 *   checkLead(deal, contract, lead)            -> { present, ok, card, reason }
 *   clearDefenderCache()
 *   setDefenderEngine(fnOrNull)                -> test hook: a bestCards-style function, or null for "DDS missing"
 */
(function () {
  'use strict';

  var Bridge = window.Bridge = window.Bridge || {};
  ['legalPlays', 'isUserTurn', 'isFinished', 'randomDefenderCard'].forEach(function (name) {
    if (!Bridge[name]) {
      throw new Error('Bridge.' + name + ' is missing: check that cards.js, rules.js and ai.js load before defenders.js');
    }
  });

  var SEATS = ['N', 'E', 'S', 'W'];
  var SEAT_NAME = { N: 'North', E: 'East', S: 'South', W: 'West' };
  var SUIT_ORDER = ['S', 'H', 'D', 'C'];
  var RANKS = '23456789TJQKA';
  var JACK = RANKS.indexOf('J');
  var ACE = RANKS.indexOf('A');
  var TRUMP_INDEX = { S: 0, H: 1, D: 2, C: 3, NT: 4 };
  var LEAD_PATTERN = /^[SHDC][2-9TJQKA]$/;
  var CACHE_LIMIT = 5000;
  var LOAD_TIMEOUT = 5000; // ms to wait for the WASM module before giving up
  var UNAVAILABLE = 'Double-dummy defence is unavailable, so the defenders are playing at random.';

  var engine = null;        // function (hands, trump, leader, trick) -> { rc, cards: [...] }
  var status = 'pending';   // 'pending' | 'dds' | 'random'
  var settled = false;
  var engineNote = '';
  var leadNote = '';
  var cache = {};
  var cacheSize = 0;
  var resolveReady;

  Bridge.defendersReady = new Promise(function (resolve) { resolveReady = resolve; });

  // ---------- card helpers ----------

  function cardStr(c) {
    return typeof c === 'string' ? c : c.suit + c.rank;
  }
  function suitOf(c) { return c.charAt(0); }
  function rankOf(c) { return RANKS.indexOf(c.charAt(1)); }

  // Fixed order: lower rank first, then suit order S, H, D, C.
  function compare(a, b) {
    var d = rankOf(a) - rankOf(b);
    return d !== 0 ? d : SUIT_ORDER.indexOf(suitOf(a)) - SUIT_ORDER.indexOf(suitOf(b));
  }
  function lowestOf(cards) {
    var best = cards[0];
    for (var i = 1; i < cards.length; i++) { if (compare(cards[i], best) < 0) best = cards[i]; }
    return best;
  }
  function highestOf(cards) {
    var best = cards[0];
    for (var i = 1; i < cards.length; i++) {
      var d = rankOf(cards[i]) - rankOf(best);
      if (d > 0 || (d === 0 && SUIT_ORDER.indexOf(suitOf(cards[i])) < SUIT_ORDER.indexOf(suitOf(best)))) best = cards[i];
    }
    return best;
  }

  // "S.H.D.C" with ranks high to low; a void is an empty segment.
  function handString(cards) {
    return SUIT_ORDER.map(function (s) {
      return cards.filter(function (c) { return suitOf(c) === s; })
        .sort(function (a, b) { return rankOf(b) - rankOf(a); })
        .map(function (c) { return c.charAt(1); }).join('');
    }).join('.');
  }

  // ---------- engine set-up ----------

  function settle(kind, why) {
    if (settled) { return; }
    settled = true;
    status = kind;
    if (kind === 'random') {
      engineNote = UNAVAILABLE;
      if (why && window.console) { console.warn('defenders.js: ' + why); }
    }
    resolveReady(kind);
  }

  function initDDS() {
    if (typeof window.DDSModule !== 'function') { settle('random', 'dds.js did not load (DDSModule is undefined)'); return; }
    setTimeout(function () { settle('random', 'DDS did not start within ' + LOAD_TIMEOUT + ' ms'); }, LOAD_TIMEOUT);
    try {
      window.DDSModule().then(function (M) {
        try {
          M.cwrap('dds_init', null, [])();
          var raw = M.cwrap('best_cards', 'string', ['string', 'number', 'number', 'string']);
          engine = function (hands, trump, leader, trick) {
            return JSON.parse(raw(hands, trump, leader, trick || ''));
          };
          settle('dds');
        } catch (e) { settle('random', 'DDS set-up failed: ' + e.message); }
      }, function (e) { settle('random', 'DDS failed to load: ' + (e && e.message ? e.message : e)); });
    } catch (e) { settle('random', 'DDS failed to start: ' + e.message); }
  }

  // Test hook. A function replaces DDS; null simulates DDS being missing.
  function setDefenderEngine(fn) {
    if (fn !== null && typeof fn !== 'function') {
      throw new Error('setDefenderEngine: pass a function or null');
    }
    settled = true;
    cache = {}; cacheSize = 0; leadNote = '';
    if (fn === null) { engine = null; status = 'random'; engineNote = UNAVAILABLE; }
    else { engine = fn; status = 'dds'; engineNote = ''; }
    resolveReady(status);
  }

  // ---------- opening-lead override ----------

  function checkLead(deal, contract, lead) {
    if (lead === undefined || lead === null || lead === '') {
      return { present: false, ok: false, card: null, reason: '' };
    }
    var text = typeof lead === 'string' ? lead.trim().toUpperCase() : '';
    if (!LEAD_PATTERN.test(text)) {
      return { present: true, ok: false, card: null,
        reason: 'The opening lead "' + String(lead).slice(0, 12) + '" is not a valid card, so it was ignored.' };
    }
    var i = contract ? SEATS.indexOf(contract.declarer) : -1;
    if (i < 0) {
      return { present: true, ok: false, card: null, reason: 'The opening lead ' + text + ' was ignored because the declarer is not valid.' };
    }
    var leader = SEATS[(i + 1) % 4];
    var hand = deal && deal[leader];
    var held = false;
    if (hand) { for (var k = 0; k < hand.length; k++) { if (cardStr(hand[k]) === text) { held = true; break; } } }
    if (!held) {
      return { present: true, ok: false, card: null,
        reason: 'The opening lead ' + text + ' is not in ' + SEAT_NAME[leader] + "'s hand, so it was ignored." };
    }
    return { present: true, ok: true, card: text, reason: '' };
  }

  // ---------- position description and tie-break ----------

  function describe(state) {
    var trick = state.currentTrick.map(function (p) { return { seat: p.seat, card: cardStr(p.card) }; });
    var inTrick = {};
    trick.forEach(function (p) { inTrick[p.card] = true; });
    var hands = {};
    var universe = { S: [], H: [], D: [], C: [] }; // ranks still in play (hands + current trick), per suit
    SEATS.forEach(function (s) {
      hands[s] = [];
      state.handsRemaining[s].forEach(function (raw) {
        var c = cardStr(raw);
        if (!inTrick[c]) { hands[s].push(c); universe[suitOf(c)].push(rankOf(c)); }
      });
    });
    trick.forEach(function (p) { universe[suitOf(p.card)].push(rankOf(p.card)); });
    var trump = TRUMP_INDEX[state.contract.strain];
    if (trump === undefined) { throw new Error('unknown strain ' + state.contract.strain); }
    var handText = SEATS.map(function (s) { return handString(hands[s]); }).join(' ');
    var trickText = trick.map(function (p) { return p.card; }).join(' ');
    var leader = trick.length ? trick[0].seat : state.toPlay;
    return {
      key: handText + '|' + trump + '|' + state.toPlay + '|' + trickText,
      handText: handText, trump: trump, leaderIndex: SEATS.indexOf(leader), trickText: trickText,
      trick: trick, universe: universe, pos: trick.length
    };
  }

  function between(universe, suit, lo, hi) {
    var ranks = universe[suit];
    for (var i = 0; i < ranks.length; i++) { if (ranks[i] > lo && ranks[i] < hi) { return true; } }
    return false;
  }

  // Keep the lowest card of each group of equivalent cards.
  function lowestOfGroups(cards, universe) {
    var out = [];
    SUIT_ORDER.forEach(function (s) {
      var mine = cards.filter(function (c) { return suitOf(c) === s; })
        .sort(function (a, b) { return rankOf(a) - rankOf(b); });
      for (var i = 0; i < mine.length; i++) {
        var startsGroup = i === 0 || between(universe, s, rankOf(mine[i - 1]), rankOf(mine[i]));
        if (startsGroup) { out.push(mine[i]); }
      }
    });
    return out;
  }

  function pick(cards, info) {
    var lows = lowestOfGroups(cards, info.universe);
    var ledSuit = info.pos > 0 ? suitOf(info.trick[0].card) : null;
    if (info.pos === 1) {
      var ledRank = rankOf(info.trick[0].card);
      if (ledRank >= JACK && ledRank < ACE) {
        var covers = lows.filter(function (c) { return suitOf(c) === ledSuit && rankOf(c) > ledRank && rankOf(c) >= JACK; });
        if (covers.length) { return lowestOf(covers); }
      }
    }
    if (info.pos === 2) {
      var followers = lows.filter(function (c) { return suitOf(c) === ledSuit; });
      if (followers.length) { return highestOf(followers); }
    }
    return lowestOf(lows);
  }

  function solve(state, info) {
    var r = engine(info.handText, info.trump, info.leaderIndex, info.trickText);
    if (!r || typeof r.rc !== 'number' || r.rc < 0 || !r.cards || !r.cards.length) {
      throw new Error('DDS error: ' + (r && r.err ? r.err : 'no cards returned'));
    }
    var legal = {};
    Bridge.legalPlays(state).forEach(function (c) { legal[c] = true; });
    var cards = r.cards.map(function (x) { return String(x.c).toUpperCase(); })
      .filter(function (c) { return legal[c]; });
    if (!cards.length) { throw new Error('DDS returned no legal card'); }
    var card = pick(cards, info);
    if (!legal[card]) { throw new Error('chosen card ' + card + ' is not legal'); }
    return card;
  }

  // ---------- public entry point ----------

  function chooseDefenderCard(state, seat, options) {
    if (Bridge.isFinished(state)) {
      throw new Error('chooseDefenderCard: the game is finished, so there is nothing to play');
    }
    if (Bridge.isUserTurn(state)) {
      throw new Error('chooseDefenderCard: it is ' + state.toPlay + ' to play, who is declarer or dummy, not a defender');
    }
    if (seat !== state.toPlay) {
      throw new Error('chooseDefenderCard: it is ' + state.toPlay + ' to play, not ' + seat);
    }

    var opening = state.completedTricks.length === 0 && state.currentTrick.length === 0;
    if (opening) {
      leadNote = '';
      var chk = checkLead(state.deal, state.contract, options && options.lead);
      if (chk.ok && Bridge.legalPlays(state).indexOf(chk.card) >= 0) { return chk.card; }
      if (chk.present) { leadNote = chk.reason; }
    }

    if (status === 'pending') {
      throw new Error('chooseDefenderCard: DDS is still loading; wait for Bridge.defendersReady first');
    }
    if (engine === null) { return Bridge.randomDefenderCard(state); }

    try {
      var info = describe(state);
      var hit = cache[info.key];
      if (hit !== undefined) { return hit; }
      var card = solve(state, info);
      if (cacheSize >= CACHE_LIMIT) { cache = {}; cacheSize = 0; }
      cache[info.key] = card;
      cacheSize++;
      return card;
    } catch (e) {
      if (window.console) { console.warn('defenders.js: ' + e.message); }
      engineNote = UNAVAILABLE;
      return Bridge.randomDefenderCard(state);
    }
  }

  function getDefenderNote() {
    return [engineNote, leadNote].filter(function (s) { return s; }).join(' ');
  }

  Bridge.chooseDefenderCard = chooseDefenderCard;
  Bridge.defenderEngine = function () { return status; };
  Bridge.getDefenderNote = getDefenderNote;
  Bridge.checkLead = checkLead;
  Bridge.clearDefenderCache = function () { cache = {}; cacheSize = 0; };
  Bridge.setDefenderEngine = setDefenderEngine;

  initDDS();
})();
