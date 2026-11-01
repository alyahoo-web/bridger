// storage.js: stored deals, play records, bundled seed deals and JSON export for the Bridge practice app, kept in localStorage with a safe in-memory fallback, on window.Bridge.
(function () {
  'use strict';

  var Bridge = window.Bridge = window.Bridge || {};

  var DEFAULT_PREFIX = 'bridge-practice:';
  var FORMAT_VERSION = 1;
  var SOURCES = ['random', 'library', 'authored', 'shared'];

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function has(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
  function isInt(n, min, max) { return typeof n === 'number' && Math.floor(n) === n && n >= min && n <= max; }
  function isPlainObject(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }

  // ---------------------------------------------------------------- checks (each returns a problem text, or null if fine)

  function checkResult(r) {
    if (!isPlainObject(r)) return 'a result must be {tricksTaken, tricksNeeded, made}';
    if (!isInt(r.tricksTaken, 0, 13)) return 'tricksTaken must be a whole number from 0 to 13';
    if (!isInt(r.tricksNeeded, 7, 13)) return 'tricksNeeded must be a whole number from 7 to 13';
    if (typeof r.made !== 'boolean') return 'made must be true or false';
    return null;
  }

  // Stored deal without regard to its id (the id is always derived from the cards and contract).
  function checkStoredDeal(d) {
    if (!isPlainObject(d)) return 'a stored deal must be an object';
    if (!isPlainObject(d.deal) || !isPlainObject(d.contract)) return 'a stored deal needs a deal and a contract';
    var stringsOnly = Bridge.SEATS.every(function (seat) {
      return Array.isArray(d.deal[seat]) && d.deal[seat].every(function (c) { return typeof c === 'string'; });
    });
    if (!stringsOnly) return 'every hand must be an array of card strings such as "SA"';
    try { Bridge.dealId(d.deal, d.contract); } catch (e) { return e.message; }
    if (Bridge.SEATS.indexOf(d.contract.declarer) < 0) return 'the declarer must be N, E, S or W';
    if (Bridge.SEATS.indexOf(d.dealer) < 0) return 'the dealer must be N, E, S or W';
    var v = d.vulnerability;
    if (!isPlainObject(v) || typeof v.NS !== 'boolean' || typeof v.EW !== 'boolean') {
      return 'vulnerability must be {NS: true/false, EW: true/false}';
    }
    if (!Array.isArray(d.auction) || !d.auction.every(function (c) { return typeof c === 'string'; })) {
      return 'the auction must be an array of calls (empty if none)';
    }
    if (SOURCES.indexOf(d.source) < 0) return 'source must be one of ' + SOURCES.join(', ');
    return null;
  }

  function checkRecord(r, id) {
    if (!isPlainObject(r)) return 'a play record must be an object';
    if (r.dealId !== id) return 'a play record is filed under the wrong deal id';
    if (!isInt(r.attempts, 0, 1e9)) return 'attempts must be a whole number';
    if (r.lastResult !== null && checkResult(r.lastResult)) return 'lastResult is not a valid result';
    if (r.bestResult !== null && checkResult(r.bestResult)) return 'bestResult is not a valid result';
    if (r.lastPlayed !== null && typeof r.lastPlayed !== 'string') return 'lastPlayed must be a text date';
    return null;
  }

  function checkSaved(saved) {
    if (!isPlainObject(saved) || saved.version !== FORMAT_VERSION) return 'unknown format';
    if (!isPlainObject(saved.deals) || !isPlainObject(saved.records)) return 'missing deals or records';
    var problem = null;
    Object.keys(saved.deals).forEach(function (id) {
      if (problem) return;
      var d = saved.deals[id];
      problem = checkStoredDeal(d);
      if (!problem && (d.id !== id || Bridge.dealId(d.deal, d.contract) !== id)) problem = 'a deal id does not match its cards';
    });
    Object.keys(saved.records).forEach(function (id) {
      if (!problem) problem = checkRecord(saved.records[id], id);
    });
    return problem;
  }

  // ---------------------------------------------------------------- result ranking

  // True if result a is strictly better than result b (b may be null). A made result beats any failure;
  // otherwise more tricks is better. Equal results are not "better".
  function isBetterResult(a, b) {
    if (!b) return true;
    if (a.made !== b.made) return a.made;
    return a.tricksTaken > b.tricksTaken;
  }

  // ---------------------------------------------------------------- storage backends

  // A stand-in for localStorage that lives in memory; used by the tests.
  function memoryBackend() {
    var items = {};
    return {
      getItem: function (k) { return has(items, k) ? items[k] : null; },
      setItem: function (k, v) { items[k] = String(v); },
      removeItem: function (k) { delete items[k]; }
    };
  }

  // options: {prefix} changes the localStorage key; {memory: true} uses an in-memory store;
  // {backend: object with getItem/setItem} supplies any store; {backend: null} means no storage at all.
  function createStore(options) {
    options = options || {};
    var key = (options.prefix === undefined ? DEFAULT_PREFIX : options.prefix) + 'data';
    var backend = null;
    var notice = '';
    var canWrite = true;
    var deals = {};    // id -> stored deal
    var records = {};  // id -> play record

    if (has(options, 'backend')) {
      backend = options.backend || null;
    } else if (options.memory) {
      backend = memoryBackend();
    } else {
      try { backend = window.localStorage || null; } catch (e) { backend = null; }
    }

    function load() {
      if (!backend) {
        canWrite = false;
        notice = 'Saving is not available in this browser, so nothing will be saved.';
        return;
      }
      var raw;
      try {
        raw = backend.getItem(key);
      } catch (e) {
        canWrite = false;
        notice = 'Saving is not available in this browser, so nothing will be saved.';
        return;
      }
      if (raw === null || raw === undefined) return; // nothing saved yet
      try {
        var saved = JSON.parse(raw);
        var problem = checkSaved(saved);
        if (problem) throw new Error(problem);
        deals = saved.deals;
        records = saved.records;
      } catch (e) {
        deals = {};
        records = {};
        canWrite = false; // leave the unreadable data alone rather than overwrite it
        notice = 'Saved data could not be read, so nothing will be saved this session. The old data has been left untouched.';
      }
    }

    function persist() {
      if (!canWrite) return false;
      try {
        backend.setItem(key, JSON.stringify({ version: FORMAT_VERSION, deals: deals, records: records }));
        return true;
      } catch (e) {
        notice = 'Could not save your data (storage may be full or blocked). Progress is lost when you close the page.';
        return false;
      }
    }

    load();

    // Adds a stored deal. The id is always derived with Bridge.dealId; any id passed in is ignored.
    // A deal that is already stored (same id) is left as it is. Returns {id, added}.
    function saveDeal(stored) {
      var problem = checkStoredDeal(stored);
      if (problem) throw new Error('Cannot save deal: ' + problem);
      var id = Bridge.dealId(stored.deal, stored.contract);
      if (has(deals, id)) return { id: id, added: false };
      var hands = {};
      Bridge.SEATS.forEach(function (seat) { hands[seat] = Bridge.sortHand(stored.deal[seat]); });
      deals[id] = clone({
        id: id,
        deal: hands,
        dealer: stored.dealer,
        vulnerability: { NS: stored.vulnerability.NS, EW: stored.vulnerability.EW },
        auction: stored.auction,
        contract: {
          level: stored.contract.level,
          strain: stored.contract.strain,
          doubled: stored.contract.doubled,
          declarer: stored.contract.declarer
        },
        source: stored.source
      });
      persist();
      return { id: id, added: true };
    }

    function loadDeal(id) { return has(deals, id) ? clone(deals[id]) : null; }

    function listDeals() { return Object.keys(deals).map(function (id) { return clone(deals[id]); }); }

    function getRecord(id) { return has(records, id) ? clone(records[id]) : null; }

    // 'unplayed' with no record, otherwise 'made' if the best result made the contract, else 'failed'.
    function getStatus(id) {
      if (!has(records, id)) return 'unplayed';
      var best = records[id].bestResult;
      return best && best.made ? 'made' : 'failed';
    }

    // Records a finished hand: attempts + 1, lastResult, bestResult (by isBetterResult), lastPlayed (ISO time).
    // Returns the updated play record.
    function saveResult(id, result) {
      if (!has(deals, id)) throw new Error('Cannot save result: unknown deal ' + id);
      var problem = checkResult(result);
      if (problem) throw new Error('Cannot save result: ' + problem);
      var r = { tricksTaken: result.tricksTaken, tricksNeeded: result.tricksNeeded, made: result.made };
      var old = has(records, id) ? records[id] : null;
      records[id] = {
        dealId: id,
        attempts: (old ? old.attempts : 0) + 1,
        lastResult: clone(r),
        bestResult: (!old || isBetterResult(r, old.bestResult)) ? clone(r) : old.bestResult,
        lastPlayed: new Date().toISOString()
      };
      persist();
      return clone(records[id]);
    }

    // Everything as one JSON string: {version, deals: [...], playRecords: [...]}.
    function exportAll() {
      return JSON.stringify({
        version: FORMAT_VERSION,
        deals: listDeals(),
        playRecords: Object.keys(records).map(function (id) { return clone(records[id]); })
      }, null, 2);
    }

    // On first run only (no stored deals at all): stores each deal in the list. Returns how many were added.
    function seedIfEmpty(list) {
      if (Object.keys(deals).length > 0) return 0;
      var added = 0;
      list.forEach(function (d) { if (saveDeal(d).added) added++; });
      return added;
    }

    return {
      saveDeal: saveDeal,
      loadDeal: loadDeal,
      listDeals: listDeals,
      getRecord: getRecord,
      getStatus: getStatus,
      saveResult: saveResult,
      exportAll: exportAll,
      seedIfEmpty: seedIfEmpty,
      getNotice: function () { return notice; },
      canSave: function () { return canWrite; }
    };
  }

  // ---------------------------------------------------------------- bundled deals

  var SEED_SOURCE = [
    {
      // 3NT by South, the original deal: nine top tricks plus the club ace, crossing between the hands with low cards.
      pbn: 'N:AK42.A53.K63.874 976.T86.T872.QT9 Q53.KQ4.AQ4.A652 JT8.J972.J95.KJ3',
      dealer: 'N',
      vulnerability: { NS: false, EW: false },
      auction: [],
      contract: { level: 3, strain: 'NT', doubled: 0, declarer: 'S' }
    },
    {
      // 4 spades by South: nine trumps, spades and hearts break kindly; straightforward, with ten or eleven tricks.
      pbn: 'N:Q973.A64.K54.K43 T6.JT8.QJ9.QJT98 AKJ84.KQ5.A32.76 52.9732.T876.A52',
      dealer: 'S',
      vulnerability: { NS: false, EW: true },
      auction: ['1S', 'P', '3S', 'P', '4S', 'P', 'P', 'P'],
      contract: { level: 4, strain: 'S', doubled: 0, declarer: 'S' }
    },
    {
      // 6NT by North, HARD: eleven tricks are solid (five spades, three hearts, two clubs, the diamond ace), so the
      // twelfth needs the diamond finesse (low from dummy towards North's A-Q), and the king is offside with East.
      pbn: 'N:AKQJ2.AK3.AQ5.A5 T98.JT98.KT8.QT7 543.Q42.432.K643 76.765.J976.J982',
      dealer: 'N',
      vulnerability: { NS: true, EW: false },
      auction: [],
      contract: { level: 6, strain: 'NT', doubled: 0, declarer: 'N' }
    },
    {
      // 4 hearts by East, declarer in a different seat: ten tricks from hearts, two aces, a club king and a diamond or spade trick.
      pbn: 'N:AJ87.T6.K94.Q972 K52.AKJ85.Q63.A4 QT9.93.JT87.JT85 643.Q742.A52.K63',
      dealer: 'E',
      vulnerability: { NS: true, EW: true },
      auction: ['1H', 'P', '3H', 'P', '4H', 'P', 'P', 'P'],
      contract: { level: 4, strain: 'H', doubled: 0, declarer: 'E' }
    }
  ];

  // Returns the four bundled deals as stored deals (source "library"). Throws if a bundled PBN string is invalid.
  function buildSeedDeals() {
    return SEED_SOURCE.map(function (s) {
      var deal = Bridge.parsePBNDeal(s.pbn);
      return {
        id: Bridge.dealId(deal, s.contract),
        deal: deal,
        dealer: s.dealer,
        vulnerability: clone(s.vulnerability),
        auction: s.auction.slice(),
        contract: clone(s.contract),
        source: 'library'
      };
    });
  }

  // ---------------------------------------------------------------- exports

  var defaultStore = null;
  // The one store the app uses (created on first use, so tests that never call this never read the real data).
  function getStore() {
    if (!defaultStore) defaultStore = createStore();
    return defaultStore;
  }

  Bridge.createStore = createStore;
  Bridge.getStore = getStore;
  Bridge.memoryBackend = memoryBackend;
  Bridge.isBetterResult = isBetterResult;
  Bridge.buildSeedDeals = buildSeedDeals;
})();
