// ui.js: the Home, Play, Result, Export and Library screens for the Bridge declarer practice app.
(function () {
  'use strict';

  var Bridge = window.Bridge;
  var app = document.getElementById('app');

  var DEFENDER_DELAY = 600;  // ms between a defender's automatic plays
  var RESULT_DELAY = 1200;   // ms to look at the last trick before the Result screen

  var SEAT_NAME = { N: 'North', E: 'East', S: 'South', W: 'West' };
  var SUIT_SYMBOL = { S: '\u2660', H: '\u2665', D: '\u2666', C: '\u2663' };
  var SUIT_NAME = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
  var RANK_NAME = { A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack', T: 'Ten' };
  var STATUS_LABEL = { unplayed: '\u25cb Unplayed', made: '\u2713 Made', failed: '\u2717 Failed' };

  var store = null;
  var current = null;        // the stored deal being played
  var deal = null;
  var contract = null;
  var game = null;
  var saved = null;          // {result, record} once the finished hand has been saved
  var screen = 'home';       // home, play, result, export or library
  var lastScreen = null;
  var confirmLeave = false;  // the "leave this hand?" dialog is showing
  var failedOnly = false;    // Home filter
  var homeMessage = '';      // one-off message on Home (e.g. a deal that could not be opened)
  var exportText = '';
  var timer = null;
  var pos = null; // seat on screen: {bottom, left, top, right}

  // ---------------------------------------------------------------- small helpers

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(className, text, onClick) {
    var b = el('button', className, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function isRed(suit) { return suit === 'H' || suit === 'D'; }
  function rankLabel(card) { return card.charAt(1) === 'T' ? '10' : card.charAt(1); }
  function cardName(card) {
    var r = card.charAt(1);
    return (RANK_NAME[r] || r) + ' of ' + SUIT_NAME[card.charAt(0)];
  }
  function sideOf(seat) { return Bridge.SEATS.indexOf(seat) % 2 === 0 ? 'NS' : 'EW'; }

  function strainText(strain) {
    return strain === 'NT' ? 'NT' : SUIT_SYMBOL[strain];
  }

  // Level, strain (red for red suits) and any double, e.g. "4 heart X", added to a parent node.
  function appendContract(parent, c) {
    parent.appendChild(document.createTextNode(c.level));
    parent.appendChild(el('span', isRed(c.strain) ? 'redsuit' : '', strainText(c.strain)));
    if (c.doubled) parent.appendChild(document.createTextNode(c.doubled === 2 ? 'XX' : 'X'));
  }

  // A card face; a <button> when it can be tapped, otherwise a plain <div> shown in the trick.
  function cardFace(card, tag) {
    var suit = card.charAt(0);
    var node = el(tag, 'card' + (isRed(suit) ? ' red' : ''));
    node.appendChild(el('span', 'rank', rankLabel(card)));
    node.appendChild(el('span', 'suit', SUIT_SYMBOL[suit]));
    node.setAttribute('aria-label', cardName(card));
    return node;
  }

  function setPositions() {
    var d = Bridge.SEATS.indexOf(contract.declarer);
    pos = {
      bottom: Bridge.SEATS[d],
      left: Bridge.SEATS[(d + 1) % 4],
      top: Bridge.SEATS[(d + 2) % 4],
      right: Bridge.SEATS[(d + 3) % 4]
    };
  }

  // ---------------------------------------------------------------- navigation and game flow

  // True once a card has been played in a hand that is not yet finished.
  function handInProgress() {
    return !!game && !Bridge.isFinished(game) && (game.completedTricks.length > 0 || game.currentTrick.length > 0);
  }

  function goHome() {
    clearTimeout(timer);
    timer = null;
    game = null;
    saved = null;
    confirmLeave = false;
    screen = 'home';
    render();
  }

   function openLibrary() {
     clearTimeout(timer);
     Bridge.resetLibraryScreen();
     screen = 'library';
     render();
   }
   function renderLibrary() {
     return Bridge.renderLibraryScreen({ store: store, onBack: goHome });
   }

  function onHomeTap() {
    if (handInProgress()) {
      confirmLeave = true;
      render();
    } else {
      goHome();
    }
  }

  function openDeal(id) {
    var stored = store.loadDeal(id);
    if (!stored) { homeMessage = 'That deal could not be found.'; goHome(); return; }
    current = stored;
    try {
      startGame();
    } catch (e) {
      console.error(e);
      homeMessage = 'Could not open that deal: ' + e.message;
      goHome();
    }
  }

  function startGame() {
    clearTimeout(timer);
    timer = null;
    deal = JSON.parse(JSON.stringify(current.deal));
    contract = JSON.parse(JSON.stringify(current.contract));
    setPositions();
    game = Bridge.newGame(deal, contract);
    saved = null;
    confirmLeave = false;
    screen = 'play';
    render();
    advance();
  }

  // Saves the finished hand against the deal (once). Abandoned hands never reach this.
  function saveFinished() {
    var result = Bridge.getResult(game);
    var record = null;
    try {
      record = store.saveResult(current.id, result);
    } catch (e) {
      console.error(e);
    }
    saved = { result: result, record: record };
  }

  // Plays defenders' cards (after a short delay) until it is the user's turn or the game is over.
  function advance() {
    clearTimeout(timer);
    timer = null;
    if (Bridge.isFinished(game)) {
      if (!saved) saveFinished();
      timer = setTimeout(function () { confirmLeave = false; screen = 'result'; render(); }, RESULT_DELAY);
      return;
    }
    if (Bridge.isUserTurn(game)) return;
    timer = setTimeout(function () {
      game = Bridge.playCard(game, Bridge.randomDefenderCard(game));
      render();
      advance();
    }, DEFENDER_DELAY);
  }

  function onCardTap(card) {
    if (screen !== 'play' || confirmLeave || Bridge.isFinished(game) || !Bridge.isUserTurn(game)) return;
    try {
      game = Bridge.playCard(game, card);
    } catch (e) {
      console.error(e);
      render();
      return;
    }
    render();
    advance();
  }

  // ---------------------------------------------------------------- rendering

  function render() {
    app.textContent = '';
    if (screen === 'home') {
      app.appendChild(renderHome());
    } else if (screen === 'export') {
      app.appendChild(renderExport());
    } else if (screen === 'result') {
      app.appendChild(renderResult());
    } else if (screen === 'library') {
      app.appendChild(renderLibrary());
    } else {
      app.appendChild(renderPlay());
      if (confirmLeave) app.appendChild(renderConfirm());
    }
    if (screen !== lastScreen) {
      lastScreen = screen;
      window.scrollTo(0, 0);
    }
  }

  // ---- Home

  function renderHome() {
    var root = el('div', 'screen home');
    root.appendChild(el('div', 'hometitle', 'Bridge declarer practice'));

    var notice = store.getNotice();
    if (notice) root.appendChild(el('div', 'notice', notice));
    if (homeMessage) {
      root.appendChild(el('div', 'message', homeMessage));
      homeMessage = '';
    }

    appendDealTools(root);

    var rows = store.listDeals().map(function (d) {
      return { deal: d, status: store.getStatus(d.id), record: store.getRecord(d.id) };
    });
    var shown = failedOnly ? rows.filter(function (r) { return r.status === 'failed'; }) : rows;

    var bar = el('div', 'filterbar');
    var toggle = button('toggle', 'Failed only: ' + (failedOnly ? 'On' : 'Off'), function () {
      failedOnly = !failedOnly;
      render();
    });
    toggle.setAttribute('aria-pressed', failedOnly ? 'true' : 'false');
    bar.appendChild(toggle);
    bar.appendChild(el('div', 'count', shown.length + ' of ' + rows.length + ' deals'));
    root.appendChild(bar);

    if (shown.length === 0) {
      root.appendChild(el('div', 'emptylist', failedOnly ? 'No failed deals. Switch the filter off to see them all.' : 'No deals stored.'));
    } else {
      var list = el('div', 'deallist');
      shown.forEach(function (r) { list.appendChild(renderRow(r)); });
      root.appendChild(list);
    }
    root.appendChild(button('again secondary', 'Hand library', openLibrary));
    root.appendChild(button('again secondary', 'Export data', function () {
      try {
        exportText = store.exportAll();
      } catch (e) {
        console.error(e);
        homeMessage = 'Could not prepare the export: ' + e.message;
        render();
        return;
      }
      screen = 'export';
      render();
    }));
    return root;
  }

  function renderRow(r) {
    var c = r.deal.contract;
    var row = button('dealrow', '', function () { openDeal(r.deal.id); });

    var left = el('div', 'dealcontract');
    appendContract(left, c);
    left.appendChild(el('small', '', SEAT_NAME[c.declarer] + ' declares'));
    row.appendChild(left);

    var stats = el('div', 'dealstats');
    var attempts = r.record ? r.record.attempts : 0;
    stats.appendChild(el('div', '', 'Attempts: ' + attempts));
    var best = r.record && r.record.bestResult;
    stats.appendChild(el('div', '', best ? 'Best: ' + best.tricksTaken + ' / ' + best.tricksNeeded + ' tricks' : 'Best: none yet'));
    row.appendChild(stats);

    row.appendChild(el('span', 'badge ' + r.status, STATUS_LABEL[r.status]));
    return row;
  }

  // ---- Export

  function renderExport() {
    var root = el('div', 'screen home');
    root.appendChild(el('div', 'hometitle', 'Export data'));
    root.appendChild(el('div', 'homesub', 'All stored deals and play records as JSON. Tap Copy, or touch and hold the text to select it yourself.'));

    var area = el('textarea', 'exporttext');
    area.readOnly = true;
    area.value = exportText;
    area.setAttribute('aria-label', 'Exported data');
    root.appendChild(area);

    var msg = el('div', 'exportmsg');
    var row = el('div', 'btnrow');
    row.appendChild(button('again', 'Copy', function () { copyText(area, msg); }));
    row.appendChild(button('again secondary', 'Download', function () { downloadText(exportText, msg); }));
    row.appendChild(button('again secondary', 'Back', function () { screen = 'home'; render(); }));
    root.appendChild(row);
    root.appendChild(msg);
    return root;
  }

  function copyText(area, msg) {
    function fallback() {
      try {
        area.focus();
        area.select();
        area.setSelectionRange(0, area.value.length);
        msg.textContent = document.execCommand('copy') ? 'Copied.' : 'Could not copy automatically. Touch and hold the text to select and copy it.';
      } catch (e) {
        msg.textContent = 'Could not copy automatically. Touch and hold the text to select and copy it.';
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(area.value).then(function () { msg.textContent = 'Copied.'; }, fallback);
    } else {
      fallback();
    }
  }

  function downloadText(text, msg) {
    try {
      var blob = new Blob([text], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = 'bridge-practice-export.json';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      msg.textContent = 'Download started. If nothing happens, use Copy instead.';
    } catch (e) {
      msg.textContent = 'Download is not available here. Use Copy instead.';
    }
  }

  // ---- Play

  function renderPlay() {
    var root = el('div', 'screen');
    root.appendChild(renderHeader());
    root.appendChild(renderHand(pos.top));
    root.appendChild(renderMiddle());
    root.appendChild(renderStatus());
    root.appendChild(renderHand(pos.bottom));
    var shareBar = el('div', 'sd-sharebar');
    shareBar.appendChild(makeShareButton());
    root.appendChild(shareBar);
    return root;
  }

  function renderConfirm() {
    var overlay = el('div', 'overlay');
    var box = el('div', 'dialog');
    box.setAttribute('role', 'dialog');
    box.appendChild(el('h2', '', 'Leave this hand?'));
    box.appendChild(el('p', '', 'The hand is not finished. It will not count as an attempt.'));
    box.appendChild(button('again', 'Keep playing', function () { confirmLeave = false; render(); }));
    box.appendChild(button('again secondary', 'Leave hand', goHome));
    overlay.appendChild(box);
    return overlay;
  }

  function renderHeader() {
    var needed = 6 + contract.level;
    var side = sideOf(contract.declarer);
    var other = side === 'NS' ? 'EW' : 'NS';
    var header = el('div', 'header');

    header.appendChild(button('homebtn', '\u2039 Home', onHomeTap));

    var left = el('div', 'contract');
    appendContract(left, contract);
    left.appendChild(el('small', '', SEAT_NAME[contract.declarer] + ' declares'));
    header.appendChild(left);

    var right = el('div', 'score');
    var line = el('div');
    line.appendChild(document.createTextNode('Tricks '));
    line.appendChild(el('b', '', String(game.tricksWon[side])));
    line.appendChild(document.createTextNode(' / ' + needed + ' needed'));
    right.appendChild(line);
    right.appendChild(el('small', '', 'Defence has ' + game.tricksWon[other]));
    header.appendChild(right);
    return header;
  }

  function renderHand(seat) {
    var finished = Bridge.isFinished(game);
    var onTurn = !finished && Bridge.isUserTurn(game) && game.toPlay === seat;
    var legal = onTurn ? Bridge.legalPlays(game) : [];
    var role = seat === contract.declarer ? 'declarer (you)' : 'dummy';

    var hand = el('div', 'hand' + (onTurn ? ' active' : ''));
    hand.appendChild(el('div', 'caption', SEAT_NAME[seat] + ' \u00b7 ' + role + (onTurn ? ' \u00b7 your turn' : '')));
    var cards = el('div', 'cards');
    var sorted = Bridge.sortHand(game.handsRemaining[seat]);
    Bridge.SUITS.forEach(function (suit) {
      var inSuit = sorted.filter(function (c) { return c.charAt(0) === suit; });
      if (inSuit.length === 0) return;
      var group = el('div', 'group');
      inSuit.forEach(function (card) {
        var btn = cardFace(card, 'button');
        btn.type = 'button';
        var ok = legal.indexOf(card) >= 0;
        btn.disabled = !ok;
        if (onTurn && !ok) btn.className += ' illegal';
        if (ok) btn.addEventListener('click', function () { onCardTap(card); });
        group.appendChild(btn);
      });
      cards.appendChild(group);
    });
    hand.appendChild(cards);
    return hand;
  }

  function renderDefender(seat) {
    var thinking = !Bridge.isFinished(game) && game.toPlay === seat;
    var box = el('div', 'defender' + (thinking ? ' thinking' : ''));
    box.appendChild(el('div', 'caption', SEAT_NAME[seat]));
    var back = el('div', 'card back', String(game.handsRemaining[seat].length));
    back.setAttribute('aria-label', SEAT_NAME[seat] + ' has ' + game.handsRemaining[seat].length + ' cards');
    box.appendChild(back);
    return box;
  }

  function renderMiddle() {
    var row = el('div', 'middle');
    row.appendChild(renderDefender(pos.left));
    row.appendChild(renderTrick());
    row.appendChild(renderDefender(pos.right));
    return row;
  }

  // Shows the trick in play, or the last completed trick (with its winner marked) until the next card is played.
  function renderTrick() {
    var wrap = el('div', 'trickwrap');
    var trick = game.currentTrick;
    var done = false;
    if (trick.length === 0 && game.completedTricks.length > 0) {
      trick = game.completedTricks[game.completedTricks.length - 1];
      done = true;
    }
    var winner = done ? Bridge.trickWinner(trick, contract.strain) : null;
    var grid = el('div', 'trick' + (done ? ' done' : ''));
    var posOfSeat = {};
    Object.keys(pos).forEach(function (p) { posOfSeat[pos[p]] = p; });
    trick.forEach(function (play) {
      var face = cardFace(play.card, 'div');
      face.className += ' slot-' + posOfSeat[play.seat] + (play.seat === winner ? ' winner' : '');
      grid.appendChild(face);
    });
    wrap.appendChild(grid);
    wrap.appendChild(el('div', 'trickinfo', done ? 'Last trick won by ' + SEAT_NAME[winner] : ''));
    return wrap;
  }

  function renderStatus() {
    var text;
    var go = false;
    if (Bridge.isFinished(game)) {
      text = 'All 13 tricks played';
    } else if (Bridge.isUserTurn(game)) {
      var seat = game.toPlay;
      text = (game.currentTrick.length === 0 ? 'Lead from ' : 'Play from ') + SEAT_NAME[seat] +
        (seat === contract.declarer ? ' (your hand)' : ' (dummy)');
      go = true;
    } else {
      text = SEAT_NAME[game.toPlay] + ' is playing\u2026';
    }
    return el('div', 'status' + (go ? ' go' : ''), text);
  }

  // ---- Result

  function renderResult() {
    var result = saved ? saved.result : Bridge.getResult(game);
    var root = el('div', 'screen result');
    root.appendChild(el('div', 'verdict ' + (result.made ? 'made' : 'failed'),
      result.made ? 'Contract made' : 'Contract failed'));
    var tally = el('div', 'tally');
    tally.appendChild(document.createTextNode(result.tricksTaken + ' tricks taken, ' + result.tricksNeeded + ' needed'));
    var diff = result.tricksTaken - result.tricksNeeded;
    tally.appendChild(el('small', '', contract.level + strainText(contract.strain) + ' by ' +
      SEAT_NAME[contract.declarer] + (diff > 0 ? ' made with ' + diff + ' overtrick' + (diff > 1 ? 's' : '')
        : diff === 0 ? ' made exactly' : ' went down ' + (-diff))));
    root.appendChild(tally);

    var record = saved && saved.record;
    if (record) {
      var best = record.bestResult;
      var stats = el('div', 'stats');
      stats.appendChild(document.createTextNode('Attempts on this deal: ' + record.attempts));
      stats.appendChild(el('small', '', 'Best result: ' + best.tricksTaken + ' / ' + best.tricksNeeded + ' tricks (' +
        (best.made ? 'made' : 'failed') + ')'));
      root.appendChild(stats);
    }
    var notice = store.getNotice();
    if (notice) root.appendChild(el('div', 'notice', notice));

    var buttons = el('div', 'btncol');
    buttons.appendChild(button('again', 'Play again', startGame));
    buttons.appendChild(button('again secondary', 'Home', goHome));
    root.appendChild(buttons);
    return root;
  }

  // --------------------------------------------------------------

  // ===== Session E: random deals and shared hands ============================
  // PASTE INTO ui.js, inside the IIFE, ABOVE the init try-block.
  // Uses these ui.js closure names: store, current, homeMessage, startGame(), goHome().
  // Uses Bridge.dealRandom (cards.js) and Bridge.encodeShare / decodeShare / shareUrl (share.js).
  // Everything new is prefixed "sd" so it cannot clash with existing names.

  var SD_LEVELS = [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6'], [7, '7']];
  var SD_STRAINS = [['C', '\u2663 Clubs'], ['D', '\u2666 Diamonds'], ['H', '\u2665 Hearts'],
                    ['S', '\u2660 Spades'], ['NT', 'No trump']];
  var SD_DOUBLES = [[0, 'Not doubled'], [1, 'Doubled (X)'], [2, 'Redoubled (XX)']];
  var SD_SEATS = [['N', 'North'], ['E', 'East'], ['S', 'South'], ['W', 'West']];
  var sdDialog = null;   // the open overlay element, or null

  function sdEl(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function sdButton(label, className, onClick) {
    var b = sdEl('button', className, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function sdOnKey(e) {
    if (e.key === 'Escape') sdCloseDialog();
  }

  function sdCloseDialog() {
    if (sdDialog && sdDialog.parentNode) sdDialog.parentNode.removeChild(sdDialog);
    sdDialog = null;
    document.removeEventListener('keydown', sdOnKey);
  }

  // Opens a modal overlay on document.body (so render() does not wipe it) and returns its box.
  function sdOpenDialog(title) {
    sdCloseDialog();
    var overlay = sdEl('div', 'sd-overlay');
    var box = sdEl('div', 'sd-dialog');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', title);
    box.appendChild(sdEl('h2', 'sd-title', title));
    overlay.appendChild(box);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) sdCloseDialog();
    });
    document.body.appendChild(overlay);
    document.addEventListener('keydown', sdOnKey);
    sdDialog = overlay;
    return box;
  }

  function sdSelectRow(parent, label, options, value) {
    var id = 'sd-' + label.toLowerCase();
    var row = sdEl('div', 'sd-row');
    var lab = sdEl('label', 'sd-label', label);
    lab.setAttribute('for', id);
    var sel = sdEl('select', 'sd-field');
    sel.id = id;
    options.forEach(function (o) {
      var opt = sdEl('option', '', o[1]);
      opt.value = String(o[0]);
      sel.appendChild(opt);
    });
    sel.value = String(value);
    row.appendChild(lab);
    row.appendChild(sel);
    parent.appendChild(row);
    return sel;
  }

  // Saves the deal (unplayed: no result is recorded) and starts playing it.
  // saveDeal derives the id and leaves an already-stored deal untouched.
  function sdStart(stored, source) {
    try {
      var toSave = {
        deal: stored.deal,
        dealer: stored.dealer,
        vulnerability: stored.vulnerability,
        auction: stored.auction || [],
        contract: stored.contract,
        source: source
      };
      var res = store.saveDeal(toSave);
      current = store.loadDeal(res.id);
      if (!current) {            // storage unavailable: still playable, just not remembered
        toSave.id = res.id;
        current = toSave;
      }
      startGame();
    } catch (e) {
      console.error(e);
      homeMessage = 'Could not open that hand: ' + e.message;
      goHome();
    }
  }

  // ---- New random deal: deal four hands, then pick the contract ----

  function onNewRandomDeal() {
    var dealt = Bridge.dealRandom();
    var box = sdOpenDialog('New random deal');
    box.appendChild(sdEl('p', 'sd-note', 'Dealer South, nobody vulnerable. Choose the contract for this deal.'));
    var level = sdSelectRow(box, 'Level', SD_LEVELS, 3);
    var strain = sdSelectRow(box, 'Suit', SD_STRAINS, 'NT');
    var dbl = sdSelectRow(box, 'Double', SD_DOUBLES, 0);
    var decl = sdSelectRow(box, 'Declarer', SD_SEATS, 'S');
    var actions = sdEl('div', 'sd-actions');
    actions.appendChild(sdButton('Cancel', 'sd-btn', function () { sdCloseDialog(); }));
    actions.appendChild(sdButton('Start play', 'sd-btn sd-primary', function () {
      var stored = {
        deal: dealt,
        dealer: 'S',
        vulnerability: { NS: false, EW: false },
        auction: [],
        contract: {
          level: parseInt(level.value, 10),
          strain: strain.value,
          doubled: parseInt(dbl.value, 10),
          declarer: decl.value
        }
      };
      sdCloseDialog();
      sdStart(stored, 'random');
    }));
    box.appendChild(actions);
  }

  // ---- Share: link and code, each with a Copy button ----

  // navigator.clipboard first; otherwise select the text and use execCommand('copy').
  // If both fail the text is left selected so the user can copy it by hand.
  function sdCopy(field, status) {
    var text = field.value;
    function fallback() {
      var ok = false;
      try {
        field.focus();
        field.select();
        field.setSelectionRange(0, text.length);   // iOS needs this
        ok = document.execCommand('copy');
      } catch (e) {
        ok = false;
      }
      status.textContent = ok ? 'Copied.'
        : 'Could not copy automatically. The text is selected: tap it and choose Copy.';
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { status.textContent = 'Copied.'; }, fallback);
    } else {
      fallback();
    }
  }

  function sdCopyBlock(parent, label, text, buttonLabel, status) {
    var id = 'sd-share-' + label.toLowerCase();
    var lab = sdEl('label', 'sd-label', label);
    lab.setAttribute('for', id);
    var ta = sdEl('textarea', 'sd-field');
    ta.id = id;
    ta.rows = 3;
    ta.readOnly = true;
    ta.value = text;
    ta.setAttribute('spellcheck', 'false');
    ta.addEventListener('focus', function () { ta.select(); });
    parent.appendChild(lab);
    parent.appendChild(ta);
    parent.appendChild(sdButton(buttonLabel, 'sd-btn', function () { sdCopy(ta, status); }));
  }

  function onShareTap() {
    var code, url;
    try {
      code = Bridge.encodeShare(current);
      url = Bridge.shareUrl(current, window.location.href);
    } catch (e) {
      console.error(e);
      var errBox = sdOpenDialog('Share this hand');
      errBox.appendChild(sdEl('p', 'sd-error', 'Could not share this hand: ' + e.message));
      errBox.appendChild(sdButton('Close', 'sd-btn', function () { sdCloseDialog(); }));
      return;
    }
    var box = sdOpenDialog('Share this hand');
    box.appendChild(sdEl('p', 'sd-note', 'Shares the cards and the contract, not the play so far.'));
    var status = sdEl('p', 'sd-status', '');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    sdCopyBlock(box, 'Link', url, 'Copy link', status);
    if (window.location.protocol === 'file:') {
      box.appendChild(sdEl('p', 'sd-note',
        'This app is open from a file, so the link only works on this device. Send the code instead.'));
    }
    sdCopyBlock(box, 'Code', code, 'Copy code', status);
    box.appendChild(status);
    var actions = sdEl('div', 'sd-actions');
    actions.appendChild(sdButton('Close', 'sd-btn', function () { sdCloseDialog(); }));
    box.appendChild(actions);
  }

  // The Share button. Append it to the Play screen's toolbar (see the edit list).
  function makeShareButton() {
    return sdButton('Share', 'sd-btn', onShareTap);
  }

  // ---- Home: "New random deal" button and the paste box ----

  function appendDealTools(parent) {
    var sec = sdEl('section', 'sd-tools');
    sec.appendChild(sdButton('New random deal', 'sd-btn sd-primary', onNewRandomDeal));

    var lab = sdEl('label', 'sd-label', 'Open a shared hand');
    lab.setAttribute('for', 'sd-paste');
    var paste = sdEl('textarea', 'sd-field');
    paste.id = 'sd-paste';
    paste.rows = 3;
    paste.placeholder = 'Paste a shared code or link here';
    paste.setAttribute('spellcheck', 'false');
    paste.setAttribute('autocapitalize', 'off');
    paste.setAttribute('autocorrect', 'off');
    paste.setAttribute('autocomplete', 'off');
    var err = sdEl('p', 'sd-error', '');
    err.setAttribute('role', 'alert');
    var open = sdButton('Open shared hand', 'sd-btn', function () {
      err.textContent = '';
      var shared;
      try {
        shared = Bridge.decodeShare(paste.value);
      } catch (e) {
        err.textContent = e.message;
        return;
      }
      sdStart(shared, 'shared');
    });
    sec.appendChild(lab);
    sec.appendChild(paste);
    sec.appendChild(open);
    sec.appendChild(err);
    parent.appendChild(sec);
  }

  // ---- Page load: open a hand from the URL hash ----

  function sdClearHash() {
    try {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch (e) { /* some browsers refuse this on file: URLs; the hash then simply stays */ }
  }

  function openFromHash() {
    var raw = window.location.hash || '';
    if (raw.indexOf('#BP') !== 0) return;     // no hash, or not ours: leave it alone
    var shared;
    try {
      shared = Bridge.decodeShare(raw);
    } catch (e) {
      homeMessage = 'That shared link could not be opened. ' + e.message;
      sdClearHash();
      render();
      return;
    }
    sdClearHash();
    sdStart(shared, 'shared');
  }
  // ===== end Session E ========================================================
// start

  try {
    ['parsePBNDeal', 'sortHand', 'SEATS', 'SUITS', 'newGame', 'legalPlays', 'playCard', 'isFinished',
      'getResult', 'isUserTurn', 'trickWinner', 'randomDefenderCard', 'dealId', 'getStore', 'buildSeedDeals', 'encodeShare', 'decodeShare', 'shareUrl','renderLibraryScreen', 'resetLibraryScreen', 'loadBundledLibrary', 'loadRemoteLibrary', 'addLibraryHands'].forEach(function (name) {
      if (!Bridge || !Bridge[name]) throw new Error('Bridge.' + name + ' is missing: check that cards.js, rules.js, ai.js and storage.js load before ui.js');
    });
    store = Bridge.getStore();
    store.seedIfEmpty(Bridge.buildSeedDeals()); // first run only: the store is empty
    render();
    openFromHash();
  } catch (e) {
    app.textContent = '';
    app.appendChild(el('div', 'fatal', 'Could not start: ' + e.message));
    throw e;
  }
})();
