// Editor model for authoring a deal: card assignment, lead choice, validation and save planning (no DOM, no storage of its own).
(function () {
  'use strict';

  var Bridge = window.Bridge;
  var NEEDED = ['SEATS', 'SUITS', 'RANKS', 'makeDeck', 'sortHand', 'dealRandom', 'validateDeal',
    'validateContract', 'normaliseCall', 'checkAuction', 'normaliseLead', 'dealId'];
  NEEDED.forEach(function (name) {
    if (!Bridge || !Bridge[name]) {
      throw new Error('Bridge.' + name + ' is missing: check that cards.js loads before deal-draft.js');
    }
  });

  var SEAT_NAME = { N: 'North', E: 'East', S: 'South', W: 'West' };
  var ALL = Bridge.makeDeck();

  function fail(message) { throw new Error(message); }
  function isCard(c) { return typeof c === 'string' && ALL.indexOf(c) >= 0; }
  function isSeat(s) { return Bridge.SEATS.indexOf(s) >= 0; }

  function countsOf(draft) {
    var n = { N: 0, E: 0, S: 0, W: 0, unassigned: 0 };
    ALL.forEach(function (c) {
      var o = draft.owner[c];
      if (o === null || o === undefined) n.unassigned++; else n[o]++;
    });
    return n;
  }

  function newDraft() {
    var owner = {};
    ALL.forEach(function (c) { owner[c] = null; });
    return {
      owner: owner,
      dealer: 'S',
      vulnerability: { NS: false, EW: false },
      contract: { level: 3, strain: 'NT', doubled: 0, declarer: 'S' },
      auctionText: '',
      lead: undefined
    };
  }

  // A draft with no cards assigned, 3NT by South, dealer South, nobody vulnerable.
  function draftBlank() { return newDraft(); }

  // A draft holding a random deal (same defaults as draftBlank).
  function draftRandom(rng) {
    var d = newDraft();
    var deal = Bridge.dealRandom(rng);
    Bridge.SEATS.forEach(function (seat) {
      deal[seat].forEach(function (c) { d.owner[c] = seat; });
    });
    return d;
  }

  // A draft copied from a stored deal (the stored deal is not changed).
  function draftFromStored(stored) {
    if (!stored || typeof stored !== 'object' || !stored.deal || !stored.contract) {
      fail('Cannot edit: that is not a stored deal');
    }
    var d = newDraft();
    Bridge.SEATS.forEach(function (seat) {
      var hand = stored.deal[seat];
      if (!Array.isArray(hand)) fail('Cannot edit: the ' + seat + ' hand is missing');
      hand.forEach(function (c) {
        if (!isCard(c)) fail('Cannot edit: "' + String(c).slice(0, 12) + '" is not a card');
        d.owner[c] = seat;
      });
    });
    if (isSeat(stored.dealer)) d.dealer = stored.dealer;
    if (stored.vulnerability) {
      d.vulnerability = { NS: !!stored.vulnerability.NS, EW: !!stored.vulnerability.EW };
    }
    d.contract = {
      level: stored.contract.level,
      strain: stored.contract.strain,
      doubled: stored.contract.doubled || 0,
      declarer: stored.contract.declarer
    };
    d.auctionText = Array.isArray(stored.auction) ? stored.auction.join(' ') : '';
    var lead = Bridge.normaliseLead(stored.lead);
    d.lead = lead;
    return d;
  }

  function leaderSeat(contract) {
    if (!contract || !isSeat(contract.declarer)) return null;
    return Bridge.SEATS[(Bridge.SEATS.indexOf(contract.declarer) + 1) % 4];
  }

  // The seat to declarer's left, who makes the opening lead.
  function draftOpeningLeader(draft) { return leaderSeat(draft.contract); }

  // Hands as sorted card arrays (only assigned cards).
  function draftHands(draft) {
    var h = { N: [], E: [], S: [], W: [] };
    ALL.forEach(function (c) { if (draft.owner[c]) h[draft.owner[c]].push(c); });
    Bridge.SEATS.forEach(function (seat) { h[seat] = Bridge.sortHand(h[seat]); });
    return h;
  }

  function draftCounts(draft) { return countsOf(draft); }

  // Cards the opening leader holds, sorted; the only legal choices for a lead.
  function draftLeadChoices(draft) {
    var leader = leaderSeat(draft.contract);
    if (!leader) return [];
    return draftHands(draft)[leader];
  }

  // Clears the lead if it is no longer in the leader's hand. Returns a message, or '' if nothing changed.
  function syncLead(draft) {
    if (!draft.lead) return '';
    var leader = leaderSeat(draft.contract);
    if (leader && draft.owner[draft.lead] === leader) return '';
    var gone = draft.lead;
    draft.lead = undefined;
    return 'The opening lead ' + gone + ' is no longer in the opening leader\'s hand, so it was cleared.';
  }

  // Puts a card in a seat's hand (moving it from wherever it was), or takes it out of play with seat = null.
  function draftSetCard(draft, card, seat) {
    if (!isCard(card)) return { ok: false, message: '"' + String(card).slice(0, 12) + '" is not a card.' };
    if (seat === undefined) seat = null;
    if (seat !== null && !isSeat(seat)) return { ok: false, message: 'The seat must be N, E, S or W.' };
    if (seat !== null && draft.owner[card] !== seat && countsOf(draft)[seat] >= 13) {
      return { ok: false, message: SEAT_NAME[seat] + ' already has 13 cards. Remove one first.' };
    }
    draft.owner[card] = seat;
    return { ok: true, message: syncLead(draft) };
  }

  // Changes any of level, strain, doubled, declarer. Refuses an invalid contract.
  function draftSetContract(draft, patch) {
    var c = {
      level: draft.contract.level,
      strain: draft.contract.strain,
      doubled: draft.contract.doubled,
      declarer: draft.contract.declarer
    };
    ['level', 'strain', 'doubled', 'declarer'].forEach(function (k) {
      if (patch && patch[k] !== undefined) c[k] = patch[k];
    });
    try {
      Bridge.validateContract(c);
    } catch (e) {
      return { ok: false, message: e.message };
    }
    draft.contract = c;
    return { ok: true, message: syncLead(draft) };
  }

  // Sets the opening lead (null, undefined or '' clears it). The card must be in the opening leader's hand.
  function draftSetLead(draft, card) {
    var l;
    try {
      l = Bridge.normaliseLead(card);
    } catch (e) {
      return { ok: false, message: e.message };
    }
    if (l === undefined) { draft.lead = undefined; return { ok: true, message: '' }; }
    var leader = leaderSeat(draft.contract);
    if (!leader || draft.owner[l] !== leader) {
      return { ok: false, message: 'The lead must be a card in ' + (leader ? SEAT_NAME[leader] : 'the opening leader') + '\'s hand.' };
    }
    draft.lead = l;
    return { ok: true, message: '' };
  }

  // "1S P 3S Pass 4S P P P" -> ['1S','P','3S','P','4S','P','P','P']; '' -> []. Throws Error with a message fit to show.
  function parseAuctionText(text) {
    var t = String(text === undefined || text === null ? '' : text).replace(/[,;]/g, ' ').trim();
    if (t === '') return [];
    return t.split(/\s+/).map(function (tok) {
      try {
        return Bridge.normaliseCall(tok);
      } catch (e) {
        return fail('"' + tok.slice(0, 12) + '" is not a call. ' + e.message);
      }
    });
  }

  // Validates the draft with the existing validators. {ok:true, stored} (source 'authored', no lead key when none) or {ok:false, errors:[...]}.
  function draftToStored(draft) {
    var errors = [];
    var n = countsOf(draft);
    var countsOk = true;
    Bridge.SEATS.forEach(function (seat) {
      if (n[seat] !== 13) {
        countsOk = false;
        errors.push(SEAT_NAME[seat] + ' has ' + n[seat] + ' card' + (n[seat] === 1 ? '' : 's') + '; each hand needs 13.');
      }
    });

    var deal = draftHands(draft);
    if (countsOk) {
      try { Bridge.validateDeal(deal); } catch (e) { errors.push(e.message); countsOk = false; }
    }

    var contract = {
      level: draft.contract.level,
      strain: draft.contract.strain,
      doubled: draft.contract.doubled || 0,
      declarer: draft.contract.declarer
    };
    var contractOk = true;
    try { Bridge.validateContract(contract); } catch (e) { errors.push(e.message); contractOk = false; }

    var dealerOk = isSeat(draft.dealer);
    if (!dealerOk) errors.push('The dealer must be N, E, S or W.');

    var auction = [];
    var auctionOk = true;
    try {
      auction = parseAuctionText(draft.auctionText);
    } catch (e) {
      errors.push(e.message);
      auctionOk = false;
    }
    if (auctionOk && contractOk && dealerOk) {
      try { Bridge.checkAuction(auction, draft.dealer, contract); } catch (e) { errors.push(e.message); }
    }

    var lead;
    var leadOk = true;
    try { lead = Bridge.normaliseLead(draft.lead); } catch (e) { errors.push(e.message); leadOk = false; }
    if (leadOk && lead && contractOk) {
      if (draft.owner[lead] !== leaderSeat(contract)) {
        errors.push('The opening lead ' + lead + ' is not in the opening leader\'s hand.');
        leadOk = false;
      }
    }

    var id;
    if (errors.length === 0) {
      try { id = Bridge.dealId(deal, contract, lead); } catch (e) { errors.push(e.message); }
    }
    if (errors.length > 0) return { ok: false, errors: errors };

    var stored = {
      id: id,
      deal: deal,
      dealer: draft.dealer,
      vulnerability: { NS: !!draft.vulnerability.NS, EW: !!draft.vulnerability.EW },
      auction: auction,
      contract: contract,
      source: 'authored'
    };
    if (lead) stored.lead = lead;
    return { ok: true, stored: stored };
  }

  // What saving would do. 'new': not in the library. 'same': already there, identical. 'meta': already there (same cards,
  // contract and lead) but dealer, vulnerability or auction differ, so it can only be updated in place.
  function draftPlanSave(store, stored) {
    var existing = store.loadDeal(stored.id);
    if (!existing) return { action: 'new', id: stored.id };
    var same = existing.dealer === stored.dealer &&
      !!existing.vulnerability.NS === !!stored.vulnerability.NS &&
      !!existing.vulnerability.EW === !!stored.vulnerability.EW &&
      (existing.auction || []).join(' ') === stored.auction.join(' ');
    return { action: same ? 'same' : 'meta', id: stored.id, existing: existing };
  }

  // Carries out the plan. outcome: 'added' | 'unchanged' | 'updated' | 'blocked' (a 'meta' plan without options.updateMeta).
  // Never changes cards, contract, lead or play records of an existing deal.
  function draftCommit(store, stored, options) {
    var plan = draftPlanSave(store, stored);
    if (plan.action === 'new') {
      var r = store.saveDeal(stored);
      return { id: r.id, outcome: r.added ? 'added' : 'unchanged', plan: plan };
    }
    if (plan.action === 'same') return { id: plan.id, outcome: 'unchanged', plan: plan };
    if (!options || !options.updateMeta) return { id: plan.id, outcome: 'blocked', plan: plan };
    store.updateDealMeta(plan.id, {
      dealer: stored.dealer,
      vulnerability: stored.vulnerability,
      auction: stored.auction
    });
    return { id: plan.id, outcome: 'updated', plan: plan };
  }

  Bridge.draftBlank = draftBlank;
  Bridge.draftRandom = draftRandom;
  Bridge.draftFromStored = draftFromStored;
  Bridge.draftSetCard = draftSetCard;
  Bridge.draftSetContract = draftSetContract;
  Bridge.draftSetLead = draftSetLead;
  Bridge.draftCounts = draftCounts;
  Bridge.draftHands = draftHands;
  Bridge.draftOpeningLeader = draftOpeningLeader;
  Bridge.draftLeadChoices = draftLeadChoices;
  Bridge.parseAuctionText = parseAuctionText;
  Bridge.draftToStored = draftToStored;
  Bridge.draftPlanSave = draftPlanSave;
  Bridge.draftCommit = draftCommit;
})();
