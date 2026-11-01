/*
 * library.js - PBN library: multi-deal splitter and importer, library menu
 * (manifest) parser, bundled and remote loaders, and "add to this device".
 * Attached to window.Bridge. Depends on cards.js (Bridge.parsePBNRecord).
 * No DOM here; the Library screen is in library-ui.js.
 *
 * ---------------------------------------------------------------------------
 * LIBRARY MENU FORMAT  (hosted as  library/library.json  next to index.html)
 * ---------------------------------------------------------------------------
 * {
 *   "format": "bridge-practice-library",     required, exactly this text
 *   "version": 1,                            required, the number 1
 *   "title": "Starter hands",                optional
 *   "files": [                               required, 1 to 50 entries
 *     {
 *       "path": "starter-hands.pbn",         the PBN file, relative to this
 *                                            menu. Only letters, digits and
 *                                            - _ . / allowed; no "..", no
 *                                            leading "/", no "http:". Same
 *                                            server only.
 *       "title": "Four starter hands",       optional
 *       "hands": [                           optional. hands[0] describes the
 *         { "title": "Starter hand 1",       1st deal record in the file,
 *           "note": "nine top tricks" }      hands[1] the 2nd, and so on
 *       ]                                    (counting records that turn out
 *     }                                      to be bad, too)
 *   ]
 * }
 * Instead of "path" an entry may hold the PBN text inline as "pbn": "...".
 * The bundled hands (library-data.js) use that form, because a page opened
 * from disk cannot fetch files.
 *
 * PBN files: one or more deals. Each deal needs [Deal], [Contract] and
 * [Declarer]; [Dealer], [Vulnerable] and [Auction] are optional (see
 * Bridge.parsePBNRecord). Deals are separated by a blank line, and also
 * wherever a Dealer/Vulnerable/Deal/Auction/Contract/Declarer tag repeats
 * (so Bridge.formatPBNRecord output can simply be concatenated).
 * Known limit: a {...} comment containing a blank line is not supported.
 * Keep each file modest (a few hundred deals; 1,000,000 characters at most).
 * Serve .json and .pbn as any text-like type; HTML or media types are refused.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  var B = window.Bridge = window.Bridge || {};

  var FORMAT = 'bridge-practice-library';
  var MANIFEST_URL = 'library/library.json';
  var TIMEOUT_MS = 10000;
  var MAX_FILES = 50;
  var MAX_HANDS_META = 2000;
  var MAX_TEXT = 1000000;
  var MAX_TITLE = 80;
  var MAX_NOTE = 200;
  var UNIQUE_TAGS = { dealer: 1, vulnerable: 1, deal: 1, auction: 1, contract: 1, declarer: 1 };

  function has(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function errorText(e) {
    var t = (e && e.message) ? String(e.message) : String(e);
    return t.length > 200 ? t.slice(0, 197) + '...' : t;
  }

  function cleanText(v, max) {
    if (typeof v !== 'string') { return ''; }
    v = v.replace(/\s+/g, ' ').replace(/^ | $/g, '');
    return v.length > max ? v.slice(0, max) : v;
  }

  /* ---------------------------------------------------------------- split */

  // Splits PBN text into single-deal records: [{ number, text }], number from 1.
  // Chunks with no [Tag ...] line are ignored and not counted.
  function splitPBN(text) {
    var out = [];
    if (typeof text !== 'string') { return out; }
    var lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
    var cur = [];
    var seen = {};
    var hasTag = false;
    var i, line, m, name;

    function flush() {
      if (hasTag) { out.push({ number: out.length + 1, text: cur.join('\n') + '\n' }); }
      cur = [];
      seen = {};
      hasTag = false;
    }

    for (i = 0; i < lines.length; i++) {
      line = lines[i];
      if (/^\s*$/.test(line)) { flush(); continue; }
      if (line.charAt(0) === '%') { continue; }
      m = /^\s*\[\s*([A-Za-z0-9_]+)/.exec(line);
      if (m) {
        name = m[1].toLowerCase();
        if (has(UNIQUE_TAGS, name)) {
          if (has(seen, name)) { flush(); }
          seen[name] = true;
        }
        hasTag = true;
      }
      cur.push(line);
    }
    flush();
    return out;
  }

  /* --------------------------------------------------------------- import */

  // Reads every deal in a PBN text. Never throws.
  // Returns { total, okCount, errorCount, duplicateCount, problem, results }
  //   problem: '' or a whole-file message (empty file, no deals, too large)
  //   results[i]: { number, status: 'ok'|'error'|'duplicate', id, stored, error }
  //     stored is the parsePBNRecord result (no source) for 'ok' only.
  //     'duplicate' = same id as an earlier deal in this file.
  function importPBN(text) {
    var res = { total: 0, okCount: 0, errorCount: 0, duplicateCount: 0, problem: '', results: [] };
    if (typeof text !== 'string') { res.problem = 'There is no PBN text to import.'; return res; }
    if (typeof B.parsePBNRecord !== 'function') {
      res.problem = 'The PBN reader is not available (cards.js is not loaded).';
      return res;
    }
    if (text.length > MAX_TEXT) { res.problem = 'That file is too large to import (limit 1,000,000 characters).'; return res; }
    var records = splitPBN(text);
    if (!records.length) {
      res.problem = /\S/.test(text)
        ? 'No PBN deals found. Each deal needs lines like [Deal "N:..."], [Contract "4S"] and [Declarer "S"].'
        : 'The file is empty.';
      return res;
    }
    var firstSeen = {};
    var i, rec, item, stored;
    for (i = 0; i < records.length; i++) {
      rec = records[i];
      item = { number: rec.number, status: 'ok', id: '', stored: null, error: '' };
      try {
        stored = B.parsePBNRecord(rec.text);
        if (!stored || typeof stored.id !== 'string' || !stored.id) { throw new Error('The deal could not be read.'); }
        item.id = stored.id;
        if (has(firstSeen, stored.id)) {
          item.status = 'duplicate';
          item.error = 'Same deal as number ' + firstSeen[stored.id] + '.';
        } else {
          firstSeen[stored.id] = rec.number;
          item.stored = stored;
        }
      } catch (e) {
        item.status = 'error';
        item.error = errorText(e);
      }
      if (item.status === 'ok') { res.okCount++; }
      else if (item.status === 'duplicate') { res.duplicateCount++; }
      else { res.errorCount++; }
      res.results.push(item);
    }
    res.total = records.length;
    return res;
  }

  /* ------------------------------------------------------------- manifest */

  function validPath(p) {
    return typeof p === 'string' && p.length > 0 && p.length <= 200 &&
      /^[A-Za-z0-9_.\-]+(\/[A-Za-z0-9_.\-]+)*$/.test(p) &&
      !/(^|\/)\.\.?(\/|$)/.test(p);
  }

  function cleanHands(list) {
    var out = [];
    var i, h;
    if (!Array.isArray(list)) { return out; }
    for (i = 0; i < list.length && i < MAX_HANDS_META; i++) {
      h = list[i];
      if (h && typeof h === 'object') {
        out.push({ title: cleanText(h.title, MAX_TITLE), note: cleanText(h.note, MAX_NOTE) });
      } else {
        out.push({ title: '', note: '' });
      }
    }
    return out;
  }

  // Accepts the JSON text or an already-parsed object (the bundled data).
  // Returns { ok:true, manifest:{title, files:[{title, path, pbn, hands}]}, warnings:[] }
  //      or { ok:false, error }. Unusable file entries are skipped with a warning.
  function parseLibraryManifest(input) {
    var data = input;
    var warnings = [];
    var files = [];
    var paths = {};
    var i, f, label, title, hasPath, hasPbn;

    if (typeof input === 'string') {
      if (!/\S/.test(input)) { return { ok: false, error: 'The library menu file is empty.' }; }
      try { data = JSON.parse(input.replace(/^\uFEFF/, '')); }
      catch (e) { return { ok: false, error: 'The library menu is not valid JSON. Check for a missing comma, quote or bracket.' }; }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, error: 'The library menu must be a JSON object.' };
    }
    if (data.format !== FORMAT) {
      return { ok: false, error: 'This is not a Bridge practice library menu (its "format" must be "' + FORMAT + '").' };
    }
    if (data.version !== 1) {
      return { ok: false, error: (typeof data.version === 'number' && data.version > 1)
        ? 'This library needs a newer version of the app.'
        : 'The library menu has an unsupported "version" (expected 1).' };
    }
    if (!Array.isArray(data.files)) { return { ok: false, error: 'The library menu has no "files" list.' }; }
    if (!data.files.length) { return { ok: false, error: 'The library menu lists no files.' }; }
    if (data.files.length > MAX_FILES) {
      warnings.push('Only the first ' + MAX_FILES + ' files are used.');
    }

    for (i = 0; i < data.files.length && i < MAX_FILES; i++) {
      f = data.files[i];
      label = 'File ' + (i + 1);
      if (!f || typeof f !== 'object' || Array.isArray(f)) { warnings.push(label + ' skipped: not an object.'); continue; }
      hasPath = f.path !== undefined;
      hasPbn = f.pbn !== undefined;
      if (hasPath === hasPbn) { warnings.push(label + ' skipped: it needs exactly one of "path" or "pbn".'); continue; }
      if (hasPath) {
        if (!validPath(f.path)) {
          warnings.push(label + ' skipped: "path" must be a plain relative path (letters, digits, - _ . and / only).');
          continue;
        }
        if (has(paths, f.path)) { warnings.push(label + ' skipped: "' + f.path + '" is listed twice.'); continue; }
        paths[f.path] = true;
      } else if (typeof f.pbn !== 'string' || !/\S/.test(f.pbn)) {
        warnings.push(label + ' skipped: "pbn" must be non-empty text.');
        continue;
      }
      title = cleanText(f.title, MAX_TITLE) || (hasPath ? f.path.split('/').pop() : 'Hands ' + (i + 1));
      files.push({ title: title, path: hasPath ? f.path : '', pbn: hasPbn ? f.pbn : '', hands: cleanHands(f.hands) });
    }
    if (!files.length) {
      return { ok: false, error: 'None of the files in the library menu can be used. ' + (warnings[0] || '') };
    }
    return { ok: true, manifest: { title: cleanText(data.title, MAX_TITLE), files: files }, warnings: warnings };
  }

  /* -------------------------------------------------------------- library */

  // Library: { source:'bundled'|'remote', title, warnings:[], error:'', unavailable:false,
  //            groups:[{ title, path, error, hands:[Hand], skipped:[{number, reason}] }] }
  // Hand: { number, title, note, id, stored, onDevice }   (number = position in its file)
  function makeLibrary(source, manifest, warnings, texts) {
    var lib = { source: source, title: manifest.title || '', warnings: warnings || [], error: '', unavailable: false, groups: [] };
    var i, j, f, t, g, imp, r, meta;
    for (i = 0; i < manifest.files.length; i++) {
      f = manifest.files[i];
      t = texts[i] || { error: 'No data for this file.' };
      g = { title: f.title, path: f.path, error: '', hands: [], skipped: [] };
      if (t.error) {
        g.error = t.error;
      } else {
        imp = importPBN(t.text);
        if (imp.problem) {
          g.error = imp.problem;
        } else {
          for (j = 0; j < imp.results.length; j++) {
            r = imp.results[j];
            if (r.status === 'ok') {
              meta = f.hands[r.number - 1] || {};
              g.hands.push({ number: r.number, title: meta.title || '', note: meta.note || '', id: r.id, stored: r.stored, onDevice: false });
            } else {
              g.skipped.push({ number: r.number, reason: r.error });
            }
          }
        }
      }
      lib.groups.push(g);
    }
    return lib;
  }

  function loadBundledLibrary() {
    var data = window.BridgeLibraryData;
    var lib = { source: 'bundled', title: '', warnings: [], error: '', unavailable: false, groups: [] };
    var m, texts, i;
    try {
      if (!data) { lib.error = 'The built-in hands file (library-data.js) did not load.'; return lib; }
      m = parseLibraryManifest(data);
      if (!m.ok) { lib.error = m.error; return lib; }
      texts = [];
      for (i = 0; i < m.manifest.files.length; i++) {
        texts.push(m.manifest.files[i].pbn ? { text: m.manifest.files[i].pbn } : { error: 'Built-in hands must hold their PBN text inline ("pbn").' });
      }
      return makeLibrary('bundled', m.manifest, m.warnings, texts);
    } catch (e) {
      lib.error = 'The built-in hands could not be read: ' + errorText(e);
      return lib;
    }
  }

  /* --------------------------------------------------------------- remote */

  function remoteStatus(protocol) {
    var p = protocol || (window.location && window.location.protocol);
    if (p === 'http:' || p === 'https:') { return { available: true, message: '' }; }
    return {
      available: false,
      message: 'The online library is not available when the app is opened directly from a file. Open the app from a web server to use it. The built-in hands work anywhere.'
    };
  }

  function contentTypeProblem(ct) {
    if (!ct) { return ''; }
    var t = String(ct).toLowerCase().split(';')[0].replace(/\s/g, '');
    if (t === 'text/html' || t === 'application/xhtml+xml') {
      return 'The server sent a web page instead of a hands file. The file may be missing or the address wrong.';
    }
    if (/^(image|audio|video|font)\//.test(t)) {
      return 'The server sent the wrong kind of file (' + t + ').';
    }
    return '';
  }

  // Same-origin text fetch with timeout. Rejects with Error(message); err.notFound for 404.
  function fetchText(url, ms, fetchFn) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var ctl = (typeof AbortController === 'function') ? new AbortController() : null;
      var timer;
      var opts = { cache: 'no-cache', credentials: 'same-origin' };
      var p;

      function fail(msg, notFound) {
        if (done) { return; }
        done = true;
        clearTimeout(timer);
        var err = new Error(msg);
        err.notFound = !!notFound;
        reject(err);
      }
      function succeed(t) {
        if (done) { return; }
        done = true;
        clearTimeout(timer);
        resolve(t);
      }

      timer = setTimeout(function () {
        fail('The server took too long to answer.');
        if (ctl) { try { ctl.abort(); } catch (e) { /* ignore */ } }
      }, ms);
      if (ctl) { opts.signal = ctl.signal; }
      try {
        p = fetchFn ? fetchFn(url, opts) : window.fetch(url, opts);
      } catch (e) {
        fail('This browser could not start the download.');
        return;
      }
      p.then(function (resp) {
        var typeMsg;
        if (!resp.ok) {
          fail(resp.status === 404 ? 'File not found on the server (' + url + ').' : 'The server answered with an error (' + resp.status + ').', resp.status === 404);
          return null;
        }
        typeMsg = contentTypeProblem(resp.headers && resp.headers.get ? resp.headers.get('Content-Type') : '');
        if (typeMsg) { fail(typeMsg); return null; }
        return resp.text().then(function (t) {
          if (t.length > MAX_TEXT) { fail('That file is too large (limit 1,000,000 characters).'); }
          else { succeed(t); }
        });
      }).catch(function () {
        fail('Could not reach the server. Check the connection and try again.');
      });
    });
  }

  // Always resolves with a Library (never rejects). options (all optional, mainly for tests):
  //   manifestUrl, timeoutMs, fetch, protocol
  function loadRemoteLibrary(options) {
    options = options || {};
    var lib = { source: 'remote', title: '', warnings: [], error: '', unavailable: false, groups: [] };
    var st = remoteStatus(options.protocol);
    var url = options.manifestUrl || MANIFEST_URL;
    var ms = options.timeoutMs || TIMEOUT_MS;
    var fetchFn = options.fetch || null;
    var dir = url.slice(0, url.lastIndexOf('/') + 1);

    if (!st.available) {
      lib.unavailable = true;
      lib.error = st.message;
      return Promise.resolve(lib);
    }
    return fetchText(url, ms, fetchFn).then(function (text) {
      var m = parseLibraryManifest(text);
      var jobs = [];
      var i, f;
      if (!m.ok) { lib.error = m.error; return lib; }
      for (i = 0; i < m.manifest.files.length; i++) {
        f = m.manifest.files[i];
        if (f.pbn) {
          jobs.push(Promise.resolve({ text: f.pbn }));
        } else {
          jobs.push(fetchText(dir + f.path, ms, fetchFn).then(
            function (t) { return { text: t }; },
            function (e) { return { error: e.message }; }
          ));
        }
      }
      return Promise.all(jobs).then(function (texts) {
        return makeLibrary('remote', m.manifest, m.warnings, texts);
      });
    }, function (e) {
      lib.error = e.notFound
        ? 'This server has no online library (' + url + ' was not found).'
        : 'Could not load the online library. ' + e.message;
      return lib;
    }).catch(function (e) {
      lib.error = 'Could not read the online library: ' + errorText(e);
      lib.groups = [];
      return lib;
    });
  }

  /* ------------------------------------------------------- device / store */

  // Sets hand.onDevice for every hand in lib, from what the store holds now.
  function markLibraryOnDevice(store, lib) {
    var have = {};
    var list = [];
    var i, j, k, hands;
    try { list = store.listDeals(); } catch (e) { list = []; }
    for (i = 0; i < list.length; i++) { have[list[i].id] = true; }
    for (j = 0; j < lib.groups.length; j++) {
      hands = lib.groups[j].hands;
      for (k = 0; k < hands.length; k++) { hands[k].onDevice = has(have, hands[k].id); }
    }
    return lib;
  }

  // Saves library hands with store.saveDeal (source 'library'). Already-stored ids are
  // left untouched. Never throws. Returns
  //   { added, already, failed:[{number, error}], blocked, stopped, notSaved }
  //   blocked: store cannot save at all (nothing attempted)  - message
  //   stopped: a write failed part-way (store notice changed) - message; the rest were not attempted
  function addLibraryHands(store, hands) {
    var out = { added: 0, already: 0, failed: [], blocked: '', stopped: '', notSaved: 0 };
    var before, now, i, h, r, copy;
    if (!store || typeof store.saveDeal !== 'function') { out.blocked = 'Storage is not available.'; out.notSaved = hands.length; return out; }
    if (typeof store.canSave === 'function' && !store.canSave()) {
      out.blocked = (typeof store.getNotice === 'function' && store.getNotice()) || 'This device cannot save hands right now.';
      out.notSaved = hands.length;
      return out;
    }
    before = typeof store.getNotice === 'function' ? store.getNotice() : '';
    for (i = 0; i < hands.length; i++) {
      h = hands[i];
      r = null;
      try {
        copy = JSON.parse(JSON.stringify(h.stored));
        delete copy.id;
        copy.source = 'library';
        r = store.saveDeal(copy);
      } catch (e) {
        out.failed.push({ number: h.number, error: errorText(e) });
        continue;
      }
      if (r && r.added) { out.added++; } else { out.already++; }
      now = typeof store.getNotice === 'function' ? store.getNotice() : '';
      if (now && now !== before) {
        // A failed write does not throw; it sets the store notice. Stop here.
        out.stopped = now;
        if (r && r.added) { out.added--; }
        break;
      }
    }
    out.notSaved = hands.length - out.added - out.already - out.failed.length;
    return out;
  }

  B.splitPBN = splitPBN;
  B.importPBN = importPBN;
  B.parseLibraryManifest = parseLibraryManifest;
  B.loadBundledLibrary = loadBundledLibrary;
  B.loadRemoteLibrary = loadRemoteLibrary;
  B.libraryRemoteStatus = remoteStatus;
  B.markLibraryOnDevice = markLibraryOnDevice;
  B.addLibraryHands = addLibraryHands;
})();
