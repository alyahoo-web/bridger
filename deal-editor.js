// The deal editor: a full-screen overlay to create or edit a deal by touch and save it to the library with source "authored".
(function () {
  'use strict';

  var B = window.Bridge;
  ['dealUi', 'draftBlank', 'draftRandom', 'draftFromStored', 'draftSetCard', 'draftSetContract', 'draftSetLead',
    'draftCounts', 'draftLeadChoices', 'draftOpeningLeader', 'draftToStored', 'draftPlanSave', 'draftCommit'].forEach(function (n) {
    if (!B || !B[n]) throw new Error('Bridge.' + n + ' is missing: check that deal-draft.js and deal-export-ui.js load before deal-editor.js');
  });

  var el = B.dealUi.el;
  var button = B.dealUi.button;
  var NAME = { N: 'North', E: 'East', S: 'South', W: 'West' };
  var SYM = { S: '\u2660', H: '\u2665', D: '\u2666', C: '\u2663' };
  var RANK_ORDER = 'AKQJT98765432'.split('');
  var VULN = [
    { text: 'None', NS: false, EW: false }, { text: 'N\u2013S', NS: true, EW: false },
    { text: 'E\u2013W', NS: false, EW: true }, { text: 'Both', NS: true, EW: true }
  ];

  function cardText(card) { return card.charAt(1) + SYM[card.charAt(0)]; }
  function isRed(suit) { return suit === 'H' || suit === 'D'; }

  // options: {store, mode: 'random' | 'blank' | 'edit', stored (for 'edit'), onSaved(id, outcome, {mode, originalId}), onCancel()}
  // outcome is 'added', 'updated' or 'unchanged'. Returns the overlay handle.
  function openDealEditor(opts) {
    var store = opts.store;
    var mode = opts.mode || 'random';
    var draft = mode === 'edit' ? B.draftFromStored(opts.stored) : (mode === 'blank' ? B.draftBlank() : B.draftRandom());
    var originalId = mode === 'edit' ? opts.stored.id : null;
    var active = 'N';
    var dirty = false;
    var msg = { errors: [], info: '', panel: null };

    var h = B.dealUi.openOverlay(mode === 'edit' ? 'Edit deal' : 'New deal',
      { className: 'de-overlay', closeOnBackdrop: false, onRequestClose: requestClose });
    var body = el('div', 'de-body');
    h.box.appendChild(body);

    function requestClose() {
      if (dirty && !window.confirm('Discard your changes?')) return;
      h.close();
      if (opts.onCancel) opts.onCancel();
    }
    function touch(result) {
      dirty = true;
      msg = { errors: [], info: '', panel: null };
      if (result && result.ok === false) msg.errors = [result.message];
      else if (result && result.message) msg.info = result.message;
    }
    function advance() {
      var c = B.draftCounts(draft);
      if (c[active] < 13) return;
      var i = B.SEATS.indexOf(active);
      for (var k = 1; k <= 4; k++) {
        var s = B.SEATS[(i + k) % 4];
        if (c[s] < 13) { active = s; return; }
      }
    }

    // a labelled row of toggle buttons: items [{text, on, tap, red, label}]
    function group(label, items) {
      var g = el('div', 'de-group');
      g.appendChild(el('div', 'de-label', label));
      var row = el('div', 'de-row');
      items.forEach(function (it) {
        var b = button(it.text, 'de-chip' + (it.on ? ' on' : '') + (it.red ? ' red' : ''), it.tap);
        b.setAttribute('aria-pressed', it.on ? 'true' : 'false');
        if (it.label) b.setAttribute('aria-label', it.label);
        row.appendChild(b);
      });
      g.appendChild(row);
      return g;
    }

    function renderCards() {
      var counts = B.draftCounts(draft);
      var sec = el('div', 'de-section');
      var tabs = el('div', 'de-row de-tabs');
      B.SEATS.forEach(function (seat) {
        var b = button(seat + ' ' + counts[seat] + '/13', 'de-chip' + (seat === active ? ' on' : '') + (counts[seat] === 13 ? ' full' : ''), function () {
          active = seat; render();
        });
        b.setAttribute('aria-pressed', seat === active ? 'true' : 'false');
        b.setAttribute('aria-label', NAME[seat] + ', ' + counts[seat] + ' of 13 cards');
        tabs.appendChild(b);
      });
      sec.appendChild(tabs);
      sec.appendChild(el('div', 'de-hint', counts.unassigned > 0
        ? 'Tap a card to give it to ' + NAME[active] + '; tap it again to take it back. ' + counts.unassigned + ' cards not dealt yet.'
        : 'All 52 cards are dealt. Tap a card to give it to ' + NAME[active] + ' (a full hand must give one up first).'));

      var grid = el('div', 'de-grid');
      B.SUITS.forEach(function (suit) {
        grid.appendChild(el('div', 'de-suit' + (isRed(suit) ? ' red' : ''), SYM[suit]));
        RANK_ORDER.forEach(function (rank) {
          var card = suit + rank;
          var owner = draft.owner[card];
          var cls = 'de-cell' + (isRed(suit) ? ' red' : '') + (owner === active ? ' mine' : (owner ? ' theirs' : ''));
          var b = button('', cls, function () {
            var r = B.draftSetCard(draft, card, owner === active ? null : active);
            touch(r);
            if (r.ok) advance();
            render();
          });
          b.appendChild(el('span', 'de-rank', rank));
          b.appendChild(el('span', 'de-own', owner || '\u00a0'));
          b.setAttribute('aria-label', cardText(card) + (owner ? ', ' + NAME[owner] : ', not dealt'));
          grid.appendChild(b);
        });
      });
      sec.appendChild(grid);

      var tools = el('div', 'de-row');
      tools.appendChild(button('Random deal', 'de-btn', function () {
        draft.owner = B.draftRandom().owner;
        draft.lead = undefined;
        touch({ ok: true, message: 'Dealt a new random deal (the opening lead was cleared).' });
        render();
      }));
      tools.appendChild(button('Clear all cards', 'de-btn', function () {
        draft.owner = B.draftBlank().owner;
        draft.lead = undefined;
        active = 'N';
        touch({ ok: true, message: 'All cards cleared.' });
        render();
      }));
      sec.appendChild(tools);
      return sec;
    }

    function renderDetails() {
      var sec = el('div', 'de-section');
      var c = draft.contract;
      sec.appendChild(group('Level', [1, 2, 3, 4, 5, 6, 7].map(function (n) {
        return { text: String(n), on: c.level === n, tap: function () { touch(B.draftSetContract(draft, { level: n })); render(); } };
      })));
      sec.appendChild(group('Strain', ['C', 'D', 'H', 'S', 'NT'].map(function (s) {
        return {
          text: s === 'NT' ? 'NT' : SYM[s], red: isRed(s), on: c.strain === s, label: s === 'NT' ? 'No trumps' : s,
          tap: function () { touch(B.draftSetContract(draft, { strain: s })); render(); }
        };
      })));
      sec.appendChild(group('Doubled', [{ v: 0, t: 'No' }, { v: 1, t: 'X' }, { v: 2, t: 'XX' }].map(function (d) {
        return { text: d.t, on: (c.doubled || 0) === d.v, tap: function () { touch(B.draftSetContract(draft, { doubled: d.v })); render(); } };
      })));
      sec.appendChild(group('Declarer', B.SEATS.map(function (s) {
        return { text: s, label: NAME[s], on: c.declarer === s, tap: function () { touch(B.draftSetContract(draft, { declarer: s })); render(); } };
      })));
      sec.appendChild(group('Dealer', B.SEATS.map(function (s) {
        return { text: s, label: NAME[s], on: draft.dealer === s, tap: function () { draft.dealer = s; touch(); render(); } };
      })));
      sec.appendChild(group('Vulnerable', VULN.map(function (v) {
        return {
          text: v.text, on: !!draft.vulnerability.NS === v.NS && !!draft.vulnerability.EW === v.EW,
          tap: function () { draft.vulnerability = { NS: v.NS, EW: v.EW }; touch(); render(); }
        };
      })));

      var leader = B.draftOpeningLeader(draft);
      var choices = B.draftLeadChoices(draft);
      var leadItems = [{ text: 'None', on: !draft.lead, tap: function () { touch(B.draftSetLead(draft, null)); render(); } }];
      choices.forEach(function (card) {
        leadItems.push({
          text: cardText(card), red: isRed(card.charAt(0)), on: draft.lead === card, label: cardText(card),
          tap: function () { touch(B.draftSetLead(draft, card)); render(); }
        });
      });
      sec.appendChild(group('Opening lead (' + NAME[leader] + ' leads, optional)', leadItems));
      if (choices.length === 0) sec.appendChild(el('div', 'de-hint', 'Deal some cards to ' + NAME[leader] + ' to choose a lead.'));

      var lab = el('label', 'de-label', 'Auction (optional, starts with the dealer)');
      lab.setAttribute('for', 'de-auction');
      var ta = el('textarea', 'de-auction');
      ta.id = 'de-auction';
      ta.rows = 2;
      ta.value = draft.auctionText;
      ta.placeholder = 'e.g. 1S P 3S P 4S P P P';
      ta.setAttribute('spellcheck', 'false');
      ta.setAttribute('autocapitalize', 'characters');
      ta.setAttribute('autocorrect', 'off');
      ta.addEventListener('input', function () { draft.auctionText = ta.value; dirty = true; });
      sec.appendChild(lab);
      sec.appendChild(ta);
      return sec;
    }

    function renderMessages() {
      var m = el('div', 'de-messages');
      if (msg.errors.length) {
        var box = el('div', 'de-errors');
        box.setAttribute('role', 'alert');
        msg.errors.forEach(function (e) { box.appendChild(el('div', '', e)); });
        m.appendChild(box);
      }
      if (msg.info) m.appendChild(el('div', 'de-info', msg.info));
      if (msg.panel) {
        var p = el('div', 'de-panel');
        p.setAttribute('role', 'alert');
        var row = el('div', 'de-row');
        if (msg.panel.type === 'meta') {
          p.appendChild(el('div', '', 'A deal with these cards, contract and lead is already in the library, but with a different dealer, vulnerability or auction. Update it in place? Its results are kept.'));
          row.appendChild(button('Update it', 'de-btn primary', function () { commit(msg.panel.stored, true); }));
        } else {
          p.appendChild(el('div', '', 'This deal is already in the library exactly as it is, so nothing was saved.'));
          row.appendChild(button('Close editor', 'de-btn primary', function () { finish('unchanged', msg.panel.id); }));
        }
        row.appendChild(button('Keep editing', 'de-btn', function () { msg.panel = null; render(); }));
        p.appendChild(row);
        m.appendChild(p);
      }
      return m;
    }

    function finish(outcome, id) {
      h.close();
      if (opts.onSaved) opts.onSaved(id, outcome, { mode: mode, originalId: originalId });
    }

    function commit(stored, updateMeta) {
      var res;
      try {
        res = B.draftCommit(store, stored, { updateMeta: !!updateMeta });
      } catch (e) {
        msg = { errors: ['Could not save: ' + e.message], info: '', panel: null };
        render();
        return;
      }
      if (res.outcome === 'blocked') { msg.panel = { type: 'meta', stored: stored }; render(); return; }
      finish(res.outcome, res.id);
    }

    function save() {
      var r = B.draftToStored(draft);
      if (!r.ok) { msg = { errors: r.errors, info: '', panel: null }; render(); return; }
      var plan;
      try { plan = B.draftPlanSave(store, r.stored); } catch (e) { plan = { action: 'new' }; }
      if (plan.action === 'same') { msg = { errors: [], info: '', panel: { type: 'same', id: plan.id } }; render(); return; }
      if (plan.action === 'meta') { msg = { errors: [], info: '', panel: { type: 'meta', stored: r.stored } }; render(); return; }
      commit(r.stored, false);
    }

    function render() {
      var top = h.overlay.scrollTop;
      body.innerHTML = '';
      if (mode === 'edit') {
        body.appendChild(el('div', 'de-hint', 'Saving makes a new deal; the original stays in the library with its results. (If only the dealer, vulnerability or auction change, you can update the original instead.)'));
      }
      body.appendChild(renderCards());
      body.appendChild(renderDetails());
      body.appendChild(renderMessages());
      var actions = el('div', 'de-row de-actions');
      actions.appendChild(button('Save to library', 'de-btn primary', save));
      actions.appendChild(button('Cancel', 'de-btn', requestClose));
      body.appendChild(actions);
      h.overlay.scrollTop = top;
    }

    render();
    return h;
  }

  B.openDealEditor = openDealEditor;
})();
