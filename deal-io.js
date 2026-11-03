// Exports a stored deal as code, link, JSON or PBN, and reads any of those (or several PBN deals) back (no DOM, no clipboard).
(function () {
  'use strict';

  var Bridge = window.Bridge;
  var NEEDED = ['SEATS', 'sortHand', 'dealId', 'normaliseLead', 'validateContract', 'validateDeal', 'normaliseCall',
    'checkAuction', 'formatPBNRecord', 'encodeShare', 'decodeShare', 'shareUrl', 'importPBN', 'addLibraryHands'];
  NEEDED.forEach(function (name) {
    if (!Bridge || !Bridge[name]) {
      throw new Error('Bridge.' + name + ' is missing: check that cards.js, share.js and library.js load before deal-io.js');
    }
  });

  var FORMATS = Object.freeze(['code', 'link', 'json', 'pbn']);
  var EXTENSION = { code: '.txt', link: '.txt', json: '.json', pbn: '.pbn' };
  var MIME = {
    code: 'text/plain;charset=utf-8',
    link: 'text/plain;charset=utf-8',
    json: 'application/json;charset=utf-8',
    pbn: 'text/plain;charset=utf-8'
  };

  function fail(message) { throw new Error(message); }
  function isPlain(o) { return o !== null && typeof o === 'object' && !Array.isArray(o); }
  function isSeat(s) { return Bridge.SEATS.indexOf(s) >= 0; }

  function sortedDeal(deal) {
    var out = {};
    Bridge.SEATS.forEach(function (seat) { out[seat] = Bridge.sortHand(deal[seat]); });
    return out;
  }

  function shortHash(text) {
    var h = 5381;
    for (var i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  // Validates a stored deal and returns a clean copy in the same key order as the entries of the library export.
  function cleanStored(stored) {
    if (!isPlain(stored) || !isPlain(stored.deal) || !isPlain(stored.contract)) fail('no deal was given');
    var lead = Bridge.normaliseLead(stored.lead);
    var id = Bridge.dealId(stored.deal, stored.contract, lead);
    if (!isSeat(stored.dealer)) fail('the dealer must be N, E, S or W');
    var v = stored.vulnerability;
    if (!isPlain(v) || typeof v.NS !== 'boolean' || typeof v.EW !== 'boolean') {
      fail('vulnerability must be {NS: true/false, EW: true/false}');
    }
    var auction = stored.auction === undefined ? [] : stored.auction;
    if (!Array.isArray(auction)) fail('the auction must be a list of calls');
    auction = auction.map(function (c) { return Bridge.normaliseCall(c); });
    var contract = {
      level: stored.contract.level,
      strain: stored.contract.strain,
      doubled: stored.contract.doubled || 0,
      declarer: stored.contract.declarer
    };
    Bridge.checkAuction(auction, stored.dealer, contract);
    var entry = {
      id: id,
      deal: sortedDeal(stored.deal),
      dealer: stored.dealer,
      vulnerability: { NS: v.NS, EW: v.EW },
      auction: auction,
      contract: contract,
      source: stored.source
    };
    if (lead) entry.lead = lead;
    return entry;
  }

  function fileName(entry, format) {
    var c = entry.contract;
    var x = c.doubled === 2 ? 'XX' : (c.doubled === 1 ? 'X' : '');
    return 'bridge-' + c.level + c.strain + x + '-' + c.declarer + '-' + shortHash(entry.id) + EXTENSION[format];
  }

  // format: 'code' | 'link' | 'json' | 'pbn'. baseUrl is only used for 'link' (default: this page's address).
  // Returns {text, filename, mime, format}. Throws Error('Cannot export: ...'). Does not change its input.
  function exportDealText(stored, format, baseUrl) {
    if (FORMATS.indexOf(format) < 0) fail('Cannot export: unknown format "' + String(format).slice(0, 12) + '"');
    var entry, text;
    try {
      entry = cleanStored(stored);
      if (format === 'code') text = Bridge.encodeShare(entry);
      else if (format === 'link') text = Bridge.shareUrl(entry, baseUrl === undefined ? window.location.href : baseUrl);
      else if (format === 'json') text = JSON.stringify(entry, null, 2);
      else text = Bridge.formatPBNRecord(entry);
    } catch (e) {
      throw new Error('Cannot export: ' + e.message);
    }
    return { text: text, filename: fileName(entry, format), mime: MIME[format], format: format };
  }

  // Reads the JSON of one deal (an entry like those in the library export). The id and source in the text are ignored.
  // dealer defaults to N, vulnerability to nobody, auction to none. Returns a stored deal without `source`.
  function dealFromJSON(text) {
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return fail('That text is not valid JSON.');
    }
    if (Array.isArray(data)) fail('Expected one deal, but this JSON is a list.');
    if (!isPlain(data)) fail('Expected one deal, but this JSON is not an object.');
    if (Object.prototype.hasOwnProperty.call(data, 'deals') || Object.prototype.hasOwnProperty.call(data, 'playRecords')) {
      fail('This looks like a whole-library export, not a single deal.');
    }
    if (!isPlain(data.deal)) fail('The JSON has no "deal" (the four hands).');
    if (!isPlain(data.contract)) fail('The JSON has no "contract".');
    var handsOk = Bridge.SEATS.every(function (seat) {
      return Array.isArray(data.deal[seat]) && data.deal[seat].every(function (c) { return typeof c === 'string'; });
    });
    if (!handsOk) fail('Every hand in the JSON must be a list of card strings such as "SA".');

    try {
      var dealer = data.dealer === undefined ? 'N' : data.dealer;
      if (!isSeat(dealer)) fail('the dealer must be N, E, S or W');
      var v = data.vulnerability === undefined ? { NS: false, EW: false } : data.vulnerability;
      if (!isPlain(v) || typeof v.NS !== 'boolean' || typeof v.EW !== 'boolean') {
        fail('vulnerability must be {"NS": true/false, "EW": true/false}');
      }
      var auction = data.auction === undefined ? [] : data.auction;
      if (!Array.isArray(auction) || !auction.every(function (c) { return typeof c === 'string'; })) {
        fail('the auction must be a list of calls');
      }
      auction = auction.map(function (c) { return Bridge.normaliseCall(c); });
      var contract = {
        level: data.contract.level,
        strain: data.contract.strain,
        doubled: data.contract.doubled === undefined ? 0 : data.contract.doubled,
        declarer: data.contract.declarer
      };
      Bridge.validateContract(contract);
      Bridge.validateDeal(data.deal);
      var lead = Bridge.normaliseLead(data.lead);
      Bridge.checkAuction(auction, dealer, contract);
      var out = {
        id: Bridge.dealId(data.deal, contract, lead),
        deal: sortedDeal(data.deal),
        dealer: dealer,
        vulnerability: { NS: v.NS, EW: v.EW },
        auction: auction,
        contract: contract
      };
      if (lead) out.lead = lead;
      return out;
    } catch (e) {
      return fail('This JSON is not a valid deal: ' + e.message);
    }
  }

  // Reads pasted text: a share code, a share link, one PBN record, one deal as JSON, or several PBN deals.
  // Returns {kind:'deal', format, stored} (stored has no `source`),
  // or {kind:'many', format:'pbn', count, okCount, errorCount, duplicateCount}. Throws Error with a message fit to show.
  function readDealText(text) {
    if (typeof text !== 'string') fail('Nothing to open: paste a code, link, PBN or JSON.');
    var t = text.replace(/^\uFEFF/, '').trim();
    if (t === '') fail('Nothing to open: paste a code, link, PBN or JSON.');

    var looksPBN = /\[\s*[A-Za-z][A-Za-z0-9_]*\s+"/.test(t);
    if (t.charAt(0) === '{') return { kind: 'deal', format: 'json', stored: dealFromJSON(t) };
    if (t.charAt(0) === '[' && !looksPBN) fail('Expected one deal, but this looks like a JSON list.');

    if (looksPBN) {
      var res = Bridge.importPBN(t);
      if (res.problem) fail(res.problem);
      if (res.total === 0) fail('No deal was found in that PBN text.');
      if (res.total === 1) {
        var only = res.results[0];
        if (only.status === 'ok') return { kind: 'deal', format: 'pbn', stored: only.stored };
        return fail(only.error || 'That PBN deal could not be read.');
      }
      if (res.okCount === 0) {
        var first = res.results.filter(function (r) { return r.error; })[0];
        fail('None of the ' + res.total + ' deals in that text could be read.' + (first ? ' First problem: ' + first.error : ''));
      }
      return {
        kind: 'many', format: 'pbn', count: res.total,
        okCount: res.okCount, errorCount: res.errorCount, duplicateCount: res.duplicateCount
      };
    }

    var format = (/^[a-z][a-z0-9+.\-]*:\/\//i.test(t) || t.indexOf('#') >= 0) ? 'link' : 'code';
    return { kind: 'deal', format: format, stored: Bridge.decodeShare(t) };
  }

  // Adds every readable deal in a PBN text to the library, with source 'shared', using the existing importPBN / addLibraryHands path.
  // Returns the addLibraryHands result plus {total, unreadable, duplicatesInText, errors:[{number, error}]}. Throws on a whole-text problem.
  function addManyFromText(store, text) {
    if (typeof text !== 'string') fail('Nothing to add: paste some PBN text.');
    var res = Bridge.importPBN(text.replace(/^\uFEFF/, ''));
    if (res.problem) fail(res.problem);
    var hands = res.results.filter(function (r) { return r.status === 'ok'; }).map(function (r) {
      return { number: r.number, title: '', note: '', id: r.id, stored: r.stored, onDevice: false };
    });
    // addLibraryHands saves with source 'library'; this wrapper changes that to 'shared' without touching library.js.
    var proxy = {
      listDeals: function () { return store.listDeals(); },
      saveDeal: function (deal) {
        var copy = {};
        Object.keys(deal).forEach(function (k) { copy[k] = deal[k]; });
        copy.source = 'shared';
        return store.saveDeal(copy);
      },
      canSave: function () { return typeof store.canSave === 'function' ? store.canSave() : true; },
      getNotice: function () { return typeof store.getNotice === 'function' ? store.getNotice() : ''; }
    };
    var out = Bridge.addLibraryHands(proxy, hands);
    out.total = res.total;
    out.unreadable = res.errorCount;
    out.duplicatesInText = res.duplicateCount;
    out.errors = res.results.filter(function (r) { return r.status === 'error'; }).map(function (r) {
      return { number: r.number, error: r.error };
    });
    return out;
  }

  Bridge.DEAL_FORMATS = FORMATS;
  Bridge.exportDealText = exportDealText;
  Bridge.dealFromJSON = dealFromJSON;
  Bridge.readDealText = readDealText;
  Bridge.addManyFromText = addManyFromText;
})();
