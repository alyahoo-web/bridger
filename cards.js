// cards.js: cards, deck, dealing, PBN import/export and deal ids for the Bridge practice app, all on window.Bridge.
(function () {
  'use strict';

  var Bridge = window.Bridge = window.Bridge || {};

  // ---------------------------------------------------------------- constants

  var SUITS = Object.freeze(['S', 'H', 'D', 'C']);
  var RANKS = Object.freeze(['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']);
  var SEATS = Object.freeze(['N', 'E', 'S', 'W']);
  var STRAINS = ['C', 'D', 'H', 'S', 'NT'];

  function fail(message) {
    throw new Error(message);
  }

  // ---------------------------------------------------------------- cards

  function isCardString(s) {
    return typeof s === 'string' && s.length === 2 &&
      SUITS.indexOf(s.charAt(0)) >= 0 && RANKS.indexOf(s.charAt(1)) >= 0;
  }

  // "SA" -> {suit: 'S', rank: 'A'}
  function stringToCard(str) {
    if (!isCardString(str)) {
      fail('Invalid card ' + JSON.stringify(str) +
        ': expected a suit (S, H, D, C) then a rank (2-9, T, J, Q, K, A), e.g. "SA"');
    }
    return { suit: str.charAt(0), rank: str.charAt(1) };
  }

  // {suit: 'S', rank: 'A'} -> "SA"
  function cardToString(card) {
    if (!card || SUITS.indexOf(card.suit) < 0 || RANKS.indexOf(card.rank) < 0) {
      fail('Invalid card object ' + JSON.stringify(card) +
        ': expected {suit, rank} with suit S, H, D or C and rank 2-9, T, J, Q, K or A');
    }
    return card.suit + card.rank;
  }

  // Accepts a card string or a {suit, rank} object and returns the card string.
  function asCardString(card) {
    if (typeof card === 'string') {
      stringToCard(card);
      return card;
    }
    return cardToString(card);
  }

  // ---------------------------------------------------------------- deck, shuffle, deal

  // The 52 cards as strings, in suit order S, H, D, C and rank order 2 to A.
  function makeDeck() {
    var deck = [];
    for (var s = 0; s < SUITS.length; s++) {
      for (var r = 0; r < RANKS.length; r++) {
        deck.push(SUITS[s] + RANKS[r]);
      }
    }
    return deck;
  }

  // Fisher-Yates shuffle. Returns a new array. rng() must return a number in [0, 1); defaults to Math.random.
  function shuffle(cards, rng) {
    var random = rng === undefined ? Math.random : rng;
    if (typeof random !== 'function') {
      fail('shuffle: rng must be a function returning a number from 0 up to (not including) 1');
    }
    var a = cards.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var x = random();
      if (typeof x !== 'number' || !(x >= 0 && x < 1)) {
        fail('shuffle: rng must return a number from 0 up to (not including) 1, got ' + x);
      }
      var j = Math.floor(x * (i + 1));
      var tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }

  // Suit order S, H, D, C; high to low within a suit. Returns a new array of card strings.
  function sortHand(hand) {
    return hand.map(asCardString).sort(function (a, b) {
      var bySuit = SUITS.indexOf(a.charAt(0)) - SUITS.indexOf(b.charAt(0));
      if (bySuit !== 0) return bySuit;
      return RANKS.indexOf(b.charAt(1)) - RANKS.indexOf(a.charAt(1));
    });
  }

  // Returns a Deal {N, E, S, W}, each a sorted array of 13 card strings.
  function dealRandom(rng) {
    var deck = shuffle(makeDeck(), rng);
    var deal = {};
    for (var i = 0; i < SEATS.length; i++) {
      deal[SEATS[i]] = sortHand(deck.slice(i * 13, i * 13 + 13));
    }
    return deal;
  }

  // Throws a clear error unless the deal has four hands of 13 cards, 52 distinct cards in all.
  function validateDeal(deal) {
    if (!deal || typeof deal !== 'object') {
      fail('A deal must be an object with hands N, E, S and W');
    }
    var seen = {};
    var count = 0;
    SEATS.forEach(function (seat) {
      var hand = deal[seat];
      if (!Array.isArray(hand)) fail('The deal has no ' + seat + ' hand');
      if (hand.length !== 13) {
        fail('The ' + seat + ' hand has ' + hand.length + ' cards, expected 13');
      }
      hand.forEach(function (card) {
        var c = asCardString(card);
        if (seen[c]) {
          fail(seen[c] === seat
            ? 'Card ' + c + ' appears twice in the ' + seat + ' hand'
            : 'Card ' + c + ' appears in both the ' + seen[c] + ' and ' + seat + ' hands');
        }
        seen[c] = seat;
        count++;
      });
    });
    if (count !== 52) fail('The deal has ' + count + ' distinct cards, expected 52');
  }

  // ---------------------------------------------------------------- PBN deal

  function requireSeat(value, label) {
    var u = typeof value === 'string' ? value.trim().toUpperCase() : value;
    if (SEATS.indexOf(u) < 0) {
      fail(label + ' must be one of N, E, S, W, got ' + JSON.stringify(value));
    }
    return u;
  }

  function formatHand(hand) {
    var sorted = sortHand(hand);
    return SUITS.map(function (suit) {
      var ranks = sorted.filter(function (c) { return c.charAt(0) === suit; })
        .map(function (c) { return c.charAt(1); }).join('');
      return ranks === '' ? '-' : ranks;
    }).join('.');
  }

  // Deal -> "N:AK84.Q73.KJ5.A92 QJ7...". The first hand written is firstSeat (default N), the rest follow clockwise.
  function formatPBNDeal(deal, firstSeat) {
    var first = requireSeat(firstSeat === undefined ? 'N' : firstSeat, 'The first seat');
    validateDeal(deal);
    var start = SEATS.indexOf(first);
    var parts = [];
    for (var i = 0; i < 4; i++) {
      parts.push(formatHand(deal[SEATS[(start + i) % 4]]));
    }
    return first + ':' + parts.join(' ');
  }

  // "E:QJ7.AJ95.Q84.KJ3 ..." -> Deal. The first seat may be N, E, S or W.
  function parsePBNDeal(text) {
    if (typeof text !== 'string') fail('A PBN deal must be a string');
    var match = /^([NESW]):(.*)$/.exec(text.trim().toUpperCase());
    if (!match) {
      fail('A PBN deal must start with a seat letter and a colon, e.g. "N:AKQ.J.T9.8765 ...", got ' +
        JSON.stringify(text.trim()));
    }
    var body = match[2].trim();
    var hands = body === '' ? [] : body.split(/\s+/);
    if (hands.length !== 4) {
      fail('A PBN deal needs 4 hands separated by spaces, found ' + hands.length);
    }
    var start = SEATS.indexOf(match[1]);
    var deal = {};
    for (var i = 0; i < 4; i++) {
      var seat = SEATS[(start + i) % 4];
      var suits = hands[i].split('.');
      if (suits.length !== 4) {
        fail('The ' + seat + ' hand ' + JSON.stringify(hands[i]) +
          ' needs 4 suits (spades.hearts.diamonds.clubs) separated by dots, found ' + suits.length);
      }
      var cards = [];
      for (var s = 0; s < 4; s++) {
        var ranks = suits[s];
        if (ranks === '') {
          fail('The ' + seat + ' hand has an empty ' + SUITS[s] + ' suit; write - for a void');
        }
        if (ranks === '-') continue;
        for (var k = 0; k < ranks.length; k++) {
          var ch = ranks.charAt(k);
          if (RANKS.indexOf(ch) < 0) {
            fail('The ' + seat + ' hand has an invalid rank character ' + JSON.stringify(ch) +
              ' (use 2-9, T, J, Q, K, A, or - for a void; ten is T)');
          }
          cards.push(SUITS[s] + ch);
        }
      }
      deal[seat] = cards;
    }
    var result = {};
    SEATS.forEach(function (seat) { result[seat] = deal[seat]; });
    validateDeal(result);
    SEATS.forEach(function (seat) { result[seat] = sortHand(result[seat]); });
    return result;
  }

  // ---------------------------------------------------------------- calls, contract, auction

  var VULNERABILITY_BY_TAG = {
    none: { NS: false, EW: false },
    ns: { NS: true, EW: false },
    ew: { NS: false, EW: true },
    all: { NS: true, EW: true }
  };

  function vulnFromString(text) {
    var v = VULNERABILITY_BY_TAG[String(text).trim().toLowerCase()];
    if (!v) fail('Invalid Vulnerable value ' + JSON.stringify(text) + ': expected None, NS, EW or All');
    return { NS: v.NS, EW: v.EW };
  }

  function vulnToString(v) {
    if (!v || typeof v.NS !== 'boolean' || typeof v.EW !== 'boolean') {
      fail('vulnerability must be {NS: true/false, EW: true/false}');
    }
    if (v.NS) return v.EW ? 'All' : 'NS';
    return v.EW ? 'EW' : 'None';
  }

  // Accepts P or Pass (any case), X, XX, or a bid like 1C / 3NT. Returns the internal form (P, X, XX, 3NT).
  function normaliseCall(token) {
    var u = String(token).trim().toUpperCase();
    if (u === 'P' || u === 'PASS') return 'P';
    if (u === 'X' || u === 'XX') return u;
    if (/^[1-7](C|D|H|S|NT)$/.test(u)) return u;
    return fail('Unrecognised call ' + JSON.stringify(token) + ' in the auction');
  }

  function validateContract(c) {
    if (!c || typeof c !== 'object') fail('contract must be {level, strain, doubled, declarer}');
    if (typeof c.level !== 'number' || Math.floor(c.level) !== c.level || c.level < 1 || c.level > 7) {
      fail('Contract level must be a whole number from 1 to 7, got ' + c.level);
    }
    if (STRAINS.indexOf(c.strain) < 0) {
      fail('Contract strain must be C, D, H, S or NT, got ' + JSON.stringify(c.strain));
    }
    if (c.doubled !== 0 && c.doubled !== 1 && c.doubled !== 2) {
      fail('Contract doubled must be 0, 1 or 2, got ' + c.doubled);
    }
    requireSeat(c.declarer, 'Contract declarer');
    return c;
  }

  function contractToString(c) {
    return c.level + c.strain + (c.doubled === 2 ? 'XX' : c.doubled === 1 ? 'X' : '');
  }

  function describeContract(c) {
    return contractToString(c) + ' by ' + c.declarer;
  }

  var PASSED_OUT_MESSAGE =
    'This deal was passed out (Contract is Pass), so there is no contract to play. Passed-out deals cannot be imported.';

  // "4S" / "3NTX" / "6HXX" -> {level, strain, doubled, declarer: null}. The declarer comes from the Declarer tag.
  function parseContractString(text) {
    var u = String(text).trim().toUpperCase();
    if (u === 'PASS') fail(PASSED_OUT_MESSAGE);
    var m = /^([1-7])(NT|C|D|H|S)(X{0,2})$/.exec(u);
    if (!m) {
      fail('Invalid Contract ' + JSON.stringify(text) +
        ': expected a level 1-7, a strain (C, D, H, S, NT) and optionally X or XX, e.g. 4S, 3NTX, 6HXX');
    }
    return { level: Number(m[1]), strain: m[2], doubled: m[3].length, declarer: null };
  }

  // When the auction is not empty it must be complete and must lead to the given contract.
  function checkAuction(auction, dealer, contract) {
    if (auction.length === 0) return;
    var start = SEATS.indexOf(dealer);
    var last = null;
    var doubled = 0;
    var firstToBid = {};
    for (var i = 0; i < auction.length; i++) {
      var call = auction[i];
      var seat = SEATS[(start + i) % 4];
      var side = SEATS.indexOf(seat) % 2;
      if (call === 'P') continue;
      if (call === 'X' || call === 'XX') {
        if (!last) fail('The auction has ' + call + ' before any bid');
        doubled = call === 'X' ? 1 : 2;
        continue;
      }
      last = { level: Number(call.charAt(0)), strain: call.slice(1), side: side };
      doubled = 0;
      var key = side + last.strain;
      if (!(key in firstToBid)) firstToBid[key] = seat;
    }
    if (!last) {
      fail('The auction is passed out, so it does not lead to the contract ' + describeContract(contract));
    }
    var tail = auction.slice(-3);
    if (auction.length < 4 || tail.some(function (c) { return c !== 'P'; })) {
      fail('The auction is incomplete: after the last bid it must end with three passes');
    }
    var derived = {
      level: last.level,
      strain: last.strain,
      doubled: doubled,
      declarer: firstToBid[last.side + last.strain]
    };
    if (derived.level !== contract.level || derived.strain !== contract.strain ||
        derived.doubled !== contract.doubled || derived.declarer !== contract.declarer) {
      fail('The auction ends in ' + describeContract(derived) + ' but the contract is ' + describeContract(contract));
    }
  }

  // ---------------------------------------------------------------- stored deal id

  // A stable id from the cards and the contract only (not dealer, vulnerability, auction or source).
  // The cards are written as a PBN deal starting at North, so the first seat used on import does not matter.
  function dealId(deal, contract) {
    validateDeal(deal);
    validateContract(contract);
    return formatPBNDeal(deal, 'N').replace(/ /g, '_') + '|' + contractToString(contract) + '|' + contract.declarer;
  }

  // ---------------------------------------------------------------- PBN record

  var TAG_LINE = /^\[\s*([A-Za-z0-9_]+)\s+"([^"]*)"\s*\]$/;
  var WANTED_TAGS = ['deal', 'dealer', 'vulnerable', 'auction', 'contract', 'declarer'];

  // PBN text with Deal, Contract and Declarer tags (and optionally Dealer, Vulnerable, Auction) -> Stored deal.
  // Deal, Contract and Declarer are required; Dealer defaults to N and Vulnerable to None.
  // The returned object has no `source` (PBN cannot carry it); the caller adds it.
  function parsePBNRecord(text) {
    if (typeof text !== 'string') fail('A PBN record must be a string');
    var lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
    var tags = {};
    var auctionTokens = [];
    var inAuction = false;

    lines.forEach(function (line) {
      var trimmed = line.trim();
      if (trimmed === '') { inAuction = false; return; }
      if (trimmed.charAt(0) === '%') return;
      if (trimmed.charAt(0) === '[') {
        var m = TAG_LINE.exec(trimmed);
        if (!m) fail('Malformed PBN tag line: ' + trimmed);
        var name = m[1].toLowerCase();
        inAuction = false;
        if (WANTED_TAGS.indexOf(name) >= 0) {
          if (name in tags) {
            fail('The tag ' + m[1] + ' appears more than once; parsePBNRecord reads one deal at a time');
          }
          tags[name] = m[2];
          if (name === 'auction') inAuction = true;
        }
        return;
      }
      if (inAuction) {
        var cleaned = trimmed
          .replace(/\{[^}]*\}/g, ' ')
          .replace(/;.*$/, '')
          .replace(/=\d+=/g, ' ')
          .replace(/\$\d+/g, ' ')
          .replace(/[!?]+/g, '');
        cleaned.split(/\s+/).forEach(function (tok) {
          if (tok !== '') auctionTokens.push(normaliseCall(tok));
        });
      }
    });

    if (tags.deal === undefined) fail('Missing required tag: Deal');
    var deal = parsePBNDeal(tags.deal);

    if (tags.contract === undefined) fail('Missing required tag: Contract');
    var contract = parseContractString(tags.contract);

    if (tags.declarer === undefined) fail('Missing required tag: Declarer');
    contract.declarer = requireSeat(tags.declarer, 'Declarer');

    var dealer = tags.dealer === undefined ? 'N' : requireSeat(tags.dealer, 'Dealer');
    var vulnerability = tags.vulnerable === undefined ? { NS: false, EW: false } : vulnFromString(tags.vulnerable);

    if (auctionTokens.length > 0) {
      var caller = requireSeat(tags.auction, 'The Auction tag value (first caller)');
      if (caller !== dealer) {
        fail('The Auction tag names ' + caller + ' as first caller but the dealer is ' + dealer +
          (tags.dealer === undefined ? ' (there is no Dealer tag, so N is assumed)' : ''));
      }
    }
    checkAuction(auctionTokens, dealer, contract);

    return {
      id: dealId(deal, contract),
      deal: deal,
      dealer: dealer,
      vulnerability: vulnerability,
      auction: auctionTokens,
      contract: contract
    };
  }

  // Stored deal -> PBN text. The Deal tag starts at North. A pass is written "Pass". `id` and `source` are not written.
  // An empty auction is written with no Auction tag.
  function formatPBNRecord(stored) {
    if (!stored || typeof stored !== 'object') fail('formatPBNRecord needs a Stored deal object');
    validateDeal(stored.deal);
    var dealer = requireSeat(stored.dealer, 'Dealer');
    var vulnerable = vulnToString(stored.vulnerability);
    if (!Array.isArray(stored.auction)) fail('auction must be an array of calls (use [] for none)');
    var auction = stored.auction.map(function (c) { return normaliseCall(c); });
    var contract = validateContract(stored.contract);
    checkAuction(auction, dealer, contract);

    var lines = [
      '[Dealer "' + dealer + '"]',
      '[Vulnerable "' + vulnerable + '"]',
      '[Deal "' + formatPBNDeal(stored.deal, 'N') + '"]'
    ];
    if (auction.length > 0) {
      lines.push('[Auction "' + dealer + '"]');
      for (var i = 0; i < auction.length; i += 4) {
        lines.push(auction.slice(i, i + 4).map(function (c) { return c === 'P' ? 'Pass' : c; }).join(' '));
      }
    }
    lines.push('[Contract "' + contractToString(contract) + '"]');
    lines.push('[Declarer "' + contract.declarer + '"]');
    return lines.join('\n') + '\n';
  }

  // ---------------------------------------------------------------- exports

  Bridge.SUITS = SUITS;
  Bridge.RANKS = RANKS;
  Bridge.SEATS = SEATS;
  Bridge.cardToString = cardToString;
  Bridge.stringToCard = stringToCard;
  Bridge.makeDeck = makeDeck;
  Bridge.shuffle = shuffle;
  Bridge.dealRandom = dealRandom;
  Bridge.sortHand = sortHand;
  Bridge.parsePBNDeal = parsePBNDeal;
  Bridge.formatPBNDeal = formatPBNDeal;
  Bridge.parsePBNRecord = parsePBNRecord;
  Bridge.formatPBNRecord = formatPBNRecord;
  Bridge.dealId = dealId;
})();
