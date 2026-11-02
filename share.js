/* share.js
 * Encode and decode a deal + contract as one short text string, for sharing.
 * Classic script; attaches to window.Bridge. Load it after cards.js.
 * Uses Bridge.formatPBNDeal, Bridge.parsePBNDeal, Bridge.dealId and Bridge.SEATS.
 * No DOM, no storage. Errors are plain Error objects with a message that is
 * fit to show to the user.
 *
 * Format, version 1: six fields separated by ':'
 *
 *   BP1:<deal>:<contract>:<declarer>:<dealer>:<vul>
 *
 *   <deal>      four hands, North East South West, separated by ','.
 *               Each hand is spades.hearts.diamonds.clubs, ranks high to low,
 *               '-' for a void. This is the PBN deal text from cards.js without
 *               the "N:" and with ',' in place of ' '.
 *   <contract>  level 1-7, strain C D H S NT, then X or XX if doubled (4S, 3NTX)
 *   <declarer>  N E S W
 *   <dealer>    N E S W
 *   <vul>       -  (nobody), NS, EW or ALL
 *
 * Example:
 *   BP1:AK42.A53.K63.874,976.T86.T872.QT9,Q53.KQ4.AQ4.A652,JT8.J972.J95.KJ3:3NT:S:S:-
 *
 * Only these characters are used: A-Z 0-9 . , : -   so the string survives a
 * URL hash, chat apps and e-mail. The auction and the play so far are NOT
 * encoded (a decoded deal has an empty auction).
 *
 * Exports:
 *   Bridge.SHARE_VERSION                 'BP1'
 *   Bridge.encodeShare(stored)           -> string   (throws Error if invalid)
 *   Bridge.decodeShare(text)             -> { id, deal, dealer, vulnerability, auction: [], contract }
 *                                           (a StoredDeal without `source`; throws Error if invalid)
 *   Bridge.shareUrl(stored, baseUrl)     -> baseUrl without its hash + '#' + code
 *
 * decodeShare accepts the bare code, '#code', or a whole URL ending in '#code'.
 * It ignores white space (so a code wrapped over several lines still works)
 * and undoes %-escapes that a chat app may have added. Anything else that is
 * not exactly a version 1 code is rejected.
 */
(function () {
  'use strict';

  var Bridge = window.Bridge;
  ['formatPBNDeal', 'parsePBNDeal', 'dealId', 'SEATS'].forEach(function (name) {
    if (!Bridge || Bridge[name] === undefined) {
      throw new Error('Bridge.' + name + ' is missing: check that cards.js loads before share.js');
    }
  });

  var VERSION = 'BP1';
  var MAX_INPUT = 2000;   // longest text we will even look at (a pasted URL included)
  var MAX_CODE = 200;     // a real code is about 80 characters
  var STRAINS = ['C', 'D', 'H', 'S', 'NT'];
  var VUL_CODES = ['-', 'NS', 'EW', 'ALL'];   // index = (NS ? 1 : 0) + (EW ? 2 : 0)
  var SEAT_NAMES = { N: 'North', E: 'East', S: 'South', W: 'West' };

  var SUIT_PART = '(?:-|[2-9TJQKA]+)';
  var HAND_RE = new RegExp('^' + SUIT_PART + '(?:\\.' + SUIT_PART + '){3}$');
  var CONTRACT_RE = /^([1-7])(NT|[CDHS])(XX|X)?$/;

  function isSeat(s) {
    return typeof s === 'string' && Bridge.SEATS.indexOf(s) !== -1;
  }

  // Keep user text out of messages at full length.
  function shown(s) {
    s = String(s);
    return s.length > 12 ? s.slice(0, 12) + '...' : s;
  }

  function checkContract(c) {
    var ok = c && typeof c === 'object' &&
      typeof c.level === 'number' && c.level % 1 === 0 && c.level >= 1 && c.level <= 7 &&
      STRAINS.indexOf(c.strain) !== -1 &&
      (c.doubled === 0 || c.doubled === 1 || c.doubled === 2) &&
      isSeat(c.declarer);
    if (!ok) throw new Error('Cannot share: the contract is not valid.');
    return { level: c.level, strain: c.strain, doubled: c.doubled, declarer: c.declarer };
  }

  function encodeShare(stored) {
    if (!stored || typeof stored !== 'object') throw new Error('Cannot share: no deal was given.');
    var c = checkContract(stored.contract);
    var lead;
    try { lead = Bridge.normaliseLead(stored.lead); } catch (e) { throw new Error('Cannot share: ' + e.message); }
    if (!isSeat(stored.dealer)) throw new Error('Cannot share: the dealer is not valid.');
    var v = stored.vulnerability;
    if (!v || typeof v.NS !== 'boolean' || typeof v.EW !== 'boolean') {
      throw new Error('Cannot share: the vulnerability is not valid.');
    }
    var pbn;
    try {
      pbn = Bridge.formatPBNDeal(stored.deal, 'N');
    } catch (e) {
      throw new Error('Cannot share: ' + e.message);
    }
    var hands = pbn.replace(/^N:/, '').split(' ');
    var contractText = c.level + c.strain + ['', 'X', 'XX'][c.doubled];
    return [VERSION, hands.join(','), contractText, c.declarer, stored.dealer,
    VUL_CODES[(v.NS ? 1 : 0) + (v.EW ? 2 : 0)]].concat(lead ? [lead] : []).join(':');
  }

  // Pull the bare code out of whatever was pasted or found in the URL hash.
  function extractCode(input) {
    if (typeof input !== 'string') throw new Error('Nothing to open: no text was given.');
    var s = input.trim();
    if (!s) throw new Error('Nothing to open: the text is empty.');
    if (s.length > MAX_INPUT) throw new Error('This text is too long to be a shared deal.');
    var hash = s.indexOf('#');
    if (hash !== -1) s = s.slice(hash + 1);
    if (s.indexOf('%') !== -1) {
      try {
        s = decodeURIComponent(s);
      } catch (e) {
        throw new Error('The link is damaged: it contains a broken % escape.');
      }
    }
    s = s.replace(/\s+/g, '');
    if (!s) throw new Error('Nothing to open: the text is empty.');
    if (s.length > MAX_CODE) throw new Error('This code is too long to be a shared deal.');
    return s;
  }

  function decodeShare(input) {
    var d = decodeShareBase(input);
    if (d.lead === undefined) delete d.lead;
    return d;
  }

  function decodeShareBase(input) {
    var code = extractCode(input);
    var parts = code.split(':');

    if (!/^BP\d+$/.test(parts[0])) {
      throw new Error('This does not look like a shared deal. A shared deal starts with "' + VERSION + ':".');
    }
    if (parts[0] !== VERSION) {
      throw new Error('This shared deal is version ' + parts[0].slice(2) +
                      ', which this version of the app cannot read.');
    }
    if (parts.length !== 6 && parts.length !== 7) {
      throw new Error('The shared deal is damaged: expected 6 parts but found ' + parts.length + '.');
    }

    // Cards
    var handTexts = parts[1].split(',');
    if (handTexts.length !== 4) {
      throw new Error('The shared deal is damaged: it needs four hands (North, East, South, West) but has ' +
                      handTexts.length + '.');
    }
    for (var i = 0; i < 4; i++) {
      if (!HAND_RE.test(handTexts[i])) {
        throw new Error('The ' + SEAT_NAMES[Bridge.SEATS[i]] + ' hand is not written correctly. ' +
                        'A hand is four suits (spades.hearts.diamonds.clubs) using 2-9, T, J, Q, K, A, or - for a void.');
      }
    }
    var deal;
    try {
      deal = Bridge.parsePBNDeal('N:' + handTexts.join(' '));
    } catch (e) {
      throw new Error('The cards are not a valid deal: ' + e.message);
    }

    // Contract
    var m = CONTRACT_RE.exec(parts[2]);
    if (!m) {
      throw new Error('The contract "' + shown(parts[2]) + '" is not valid. ' +
                      'Use a level 1-7 and a suit or NT, then X or XX if doubled, for example 4S or 3NTX.');
    }
    if (!isSeat(parts[3])) {
      throw new Error('The declarer "' + shown(parts[3]) + '" is not valid. Use N, E, S or W.');
    }
    if (!isSeat(parts[4])) {
      throw new Error('The dealer "' + shown(parts[4]) + '" is not valid. Use N, E, S or W.');
    }
    var vulIndex = VUL_CODES.indexOf(parts[5]);
    if (vulIndex === -1) {
      throw new Error('The vulnerability "' + shown(parts[5]) + '" is not valid. Use -, NS, EW or ALL.');
    }

    var lead;
    if (parts.length === 7) {
      lead = parts[6];
      if (!/^[SHDC][2-9TJQKA]$/.test(lead)) {
        throw new Error('The opening lead "' + shown(lead) + '" is not valid. Use a card such as SA or H2.');
      }
    }
    var contract = {
      level: parseInt(m[1], 10),
      strain: m[2],
      doubled: m[3] === 'XX' ? 2 : (m[3] === 'X' ? 1 : 0),
      declarer: parts[3]
    };
    var id;
    try {
      id = Bridge.dealId(deal, contract, lead);
    } catch (e) {
      throw new Error('The shared deal could not be checked: ' + e.message);
    }
    return {
      id: id,
      deal: deal,
      dealer: parts[4],
      vulnerability: { NS: vulIndex === 1 || vulIndex === 3, EW: vulIndex === 2 || vulIndex === 3 },
      auction: [],
      lead: lead,
      contract: contract
    };
  }

  function shareUrl(stored, baseUrl) {
    var code = encodeShare(stored);
    var base = typeof baseUrl === 'string' ? baseUrl.split('#')[0] : '';
    return base + '#' + code;
  }

  Bridge.SHARE_VERSION = VERSION;
  Bridge.encodeShare = encodeShare;
  Bridge.decodeShare = decodeShare;
  Bridge.shareUrl = shareUrl;
})();
