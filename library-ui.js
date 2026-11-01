/*
 * library-ui.js - the Library screen (bundled and online hands).
 * Attached to window.Bridge; depends on library.js. Exports:
 *   Bridge.renderLibraryScreen({ store, onBack }) -> root node (does not append itself)
 *   Bridge.resetLibraryScreen()   forget the last visit; call before opening the screen
 * The screen keeps its own state and repaints its own root when the online
 * library arrives or a hand is added, so it never needs ui.js's render().
 */
(function () {
  'use strict';

  var B = window.Bridge = window.Bridge || {};
  var SEAT_NAME = { N: 'North', E: 'East', S: 'South', W: 'West' };
  var SUIT_SYMBOL = { S: '\u2660', H: '\u2665', D: '\u2666', C: '\u2663', NT: 'NT' };
  var session = null;

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) { n.className = className; }
    if (text !== undefined && text !== null) { n.textContent = text; }
    return n;
  }

  function button(className, text, onClick) {
    var b = el('button', className, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : (many || one + 's'));
  }

  function contractText(c) {
    var s = c.level + (SUIT_SYMBOL[c.strain] || c.strain);
    if (c.doubled === 1) { s += ' X'; }
    if (c.doubled === 2) { s += ' XX'; }
    return s + ' by ' + (SEAT_NAME[c.declarer] || c.declarer);
  }

  function allHands(lib) {
    var out = [];
    var i, j;
    for (i = 0; i < lib.groups.length; i++) {
      for (j = 0; j < lib.groups[i].hands.length; j++) { out.push(lib.groups[i].hands[j]); }
    }
    return out;
  }

  function notOnDevice(hands) {
    var out = [];
    var i;
    for (i = 0; i < hands.length; i++) { if (!hands[i].onDevice) { out.push(hands[i]); } }
    return out;
  }

  /* ------------------------------------------------------------- actions */

  function describeAdd(r) {
    var parts = [];
    var kind = 'ok';
    if (r.blocked) {
      return { kind: 'error', text: 'Nothing was added. ' + r.blocked };
    }
    if (r.added) {
      parts.push('Added ' + plural(r.added, 'hand') + ' to this device. ' + (r.added === 1 ? 'It is' : 'They are') + ' on Home now and work offline.');
    }
    if (r.already) { parts.push(plural(r.already, 'hand was', 'hands were') + ' already on this device.'); }
    if (r.failed.length) {
      kind = 'error';
      parts.push(plural(r.failed.length, 'hand') + ' could not be saved (' + r.failed[0].error + ').');
    }
    if (r.stopped) {
      kind = 'error';
      parts.push('Saving stopped because the device could not store more: ' + r.stopped + ' ' + plural(r.notSaved, 'hand was', 'hands were') +
        ' not saved. Hands already on the device are unaffected. Free up browser storage and try again.');
    }
    if (!parts.length) { parts.push('Nothing to add.'); }
    return { kind: kind, text: parts.join(' ') };
  }

  function doAdd(s, hands) {
    var r, d;
    if (s.busy) { return; }
    s.busy = true;
    try {
      r = B.addLibraryHands(s.store, hands);
    } catch (e) {
      r = { added: 0, already: 0, failed: [], blocked: 'Unexpected problem: ' + (e && e.message ? e.message : e), stopped: '', notSaved: hands.length };
    }
    s.busy = false;
    d = describeAdd(r);
    s.message = d.text;
    s.messageKind = d.kind;
    paint(s);
  }

  function startRemote(s) {
    s.remote = { state: 'loading', library: null };
    B.loadRemoteLibrary().then(function (lib) {
      if (session !== s) { return; }
      s.remote = { state: 'done', library: lib };
      paint(s);
    });
  }

  /* -------------------------------------------------------------- paint */

  function paintRow(s, parent, h, verb) {
    var row = el('div', 'lb-row');
    var info = el('div', 'lb-info');
    var name = h.title || ('Hand ' + h.number);
    info.appendChild(el('div', 'lb-title', name));
    info.appendChild(el('div', 'lb-contract', contractText(h.stored.contract)));
    if (h.note) { info.appendChild(el('div', 'lb-note', h.note)); }
    row.appendChild(info);
    if (h.onDevice) {
      row.appendChild(el('span', 'lb-badge', '\u2713 On this device'));
    } else {
      var b = button('lb-btn lb-primary', verb, function () { doAdd(s, [h]); });
      b.setAttribute('aria-label', verb + ' ' + name);
      row.appendChild(b);
    }
    parent.appendChild(row);
  }

  function paintSection(s, parent, lib, heading, verb) {
    var sec = el('div', 'lb-section');
    var hands = allHands(lib);
    var missing = notOnDevice(hands);
    var bar, i, g, d, ul, j;

    sec.appendChild(el('h2', 'lb-h', heading));
    if (lib.title) { sec.appendChild(el('div', 'lb-sub', lib.title)); }
    if (lib.error) {
      sec.appendChild(el('p', lib.unavailable ? 'lb-sub' : 'lb-error', lib.error));
      if (!lib.unavailable && lib.source === 'remote') {
        sec.appendChild(button('lb-btn', 'Try again', function () { startRemote(s); paint(s); }));
      }
      parent.appendChild(sec);
      return;
    }
    for (i = 0; i < lib.warnings.length; i++) { sec.appendChild(el('p', 'lb-sub', lib.warnings[i])); }

    bar = el('div', 'lb-bar');
    bar.appendChild(el('div', 'lb-count', (hands.length - missing.length) + ' of ' + hands.length + ' on this device'));
    if (missing.length) {
      bar.appendChild(button('lb-btn', verb + ' all (' + missing.length + ')', function () { doAdd(s, missing); }));
    }
    sec.appendChild(bar);

    for (i = 0; i < lib.groups.length; i++) {
      g = lib.groups[i];
      if (lib.groups.length > 1 || g.error || g.skipped.length) { sec.appendChild(el('h3', 'lb-group', g.title)); }
      if (g.error) {
        sec.appendChild(el('p', 'lb-error', 'This file could not be used: ' + g.error));
        continue;
      }
      for (j = 0; j < g.hands.length; j++) { paintRow(s, sec, g.hands[j], verb); }
      if (g.skipped.length) {
        d = el('details', 'lb-skipped');
        d.appendChild(el('summary', null, plural(g.skipped.length, 'deal was', 'deals were') + ' skipped'));
        ul = el('ul');
        for (j = 0; j < g.skipped.length; j++) {
          ul.appendChild(el('li', null, 'Deal ' + g.skipped[j].number + ': ' + g.skipped[j].reason));
        }
        d.appendChild(ul);
        sec.appendChild(d);
      }
    }
    if (!hands.length && !lib.groups.length) { sec.appendChild(el('p', 'lb-sub', 'No hands.')); }
    parent.appendChild(sec);
  }

  function paint(s) {
    var root = s.root;
    var notice, msg, top, rem;
    if (!root) { return; }
    while (root.firstChild) { root.removeChild(root.firstChild); }

    top = el('div', 'lb-top');
    top.appendChild(button('lb-btn', 'Home', function () { s.onBack(); }));
    root.appendChild(top);
    root.appendChild(el('div', 'hometitle', 'Hand library'));
    root.appendChild(el('div', 'homesub', 'Add practice hands to this device. Once added, they work offline.'));

    notice = s.store && s.store.getNotice ? s.store.getNotice() : '';
    if (notice) { root.appendChild(el('div', 'notice', notice)); }
    if (s.message) {
      msg = el('div', 'lb-msg ' + (s.messageKind === 'error' ? 'lb-msg-error' : 'lb-msg-ok'), s.message);
      msg.setAttribute('role', 'status');
      root.appendChild(msg);
    }

    B.markLibraryOnDevice(s.store, s.bundled);
    paintSection(s, root, s.bundled, 'Built-in starter hands', 'Add');

    rem = s.remote;
    if (rem.state === 'loading') {
      root.appendChild(el('h2', 'lb-h', 'Online library'));
      root.appendChild(el('p', 'lb-sub', 'Looking for the online library\u2026'));
    } else if (rem.state === 'done') {
      B.markLibraryOnDevice(s.store, rem.library);
      paintSection(s, root, rem.library, 'Online library', 'Download');
    } else {
      root.appendChild(el('h2', 'lb-h', 'Online library'));
      root.appendChild(el('p', 'lb-sub', rem.message));
    }
  }

  /* ------------------------------------------------------------- exports */

  function resetLibraryScreen() {
    session = null;
  }

  function renderLibraryScreen(opts) {
    var st, bundled;
    if (!session) {
      try { bundled = B.loadBundledLibrary(); }
      catch (e) { bundled = { source: 'bundled', title: '', warnings: [], groups: [], error: 'The built-in hands could not be read.', unavailable: false }; }
      session = { store: null, onBack: function () {}, bundled: bundled, remote: null, message: '', messageKind: 'ok', busy: false, root: null };
      st = B.libraryRemoteStatus();
      if (st.available) { startRemote(session); }
      else { session.remote = { state: 'unavailable', library: null, message: st.message }; }
    }
    session.store = opts.store;
    session.onBack = opts.onBack;
    session.root = el('div', 'screen home lb-screen');
    paint(session);
    return session.root;
  }

  B.renderLibraryScreen = renderLibraryScreen;
  B.resetLibraryScreen = resetLibraryScreen;
})();
