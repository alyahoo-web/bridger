// The "Share or export this hand" dialog (code, link, JSON, PBN; copy, download, share sheet) and the small DOM helpers the deal editor reuses.
(function () {
  'use strict';

  var Bridge = window.Bridge;
  if (!Bridge || !Bridge.exportDealText) {
    throw new Error('Bridge.exportDealText is missing: check that deal-io.js loads before deal-export-ui.js');
  }

  var LABELS = { code: 'Code', link: 'Link', json: 'JSON', pbn: 'PBN' };
  var NOTES = {
    code: 'A short code for messages. It carries the cards, dealer, vulnerability, contract and opening lead, not the auction or the play so far.',
    link: 'A link that opens this hand in the app. It carries the cards, dealer, vulnerability, contract and opening lead, not the auction or the play so far.',
    json: 'This one deal in the same form as an entry of Export data. It includes the auction.',
    pbn: 'Standard PBN text, with the opening lead in a [Lead] tag. It includes the auction.'
  };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function button(text, cls, onClick) {
    var b = el('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  // ---------------------------------------------------------------- overlays (a stack, so a dialog can sit on a dialog)
  var stack = [];

  function onKey(e) {
    if (e.key === 'Escape' && stack.length) stack[stack.length - 1].requestClose();
  }

  // Opens a modal overlay on document.body (so a re-render of the page does not wipe it).
  // options: className (extra class on the overlay), closeOnBackdrop (default true),
  // onRequestClose (called instead of closing for Escape and backdrop taps), onClose.
  // Returns {box, overlay, close(), requestClose()}.
  function openOverlay(title, options) {
    options = options || {};
    var previous = document.activeElement;
    var overlay = el('div', 'sd-overlay' + (options.className ? ' ' + options.className : ''));
    var box = el('div', 'sd-dialog');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', title);
    box.tabIndex = -1;
    box.appendChild(el('h2', 'sd-title', title));
    overlay.appendChild(box);

    var handle = {
      box: box,
      overlay: overlay,
      close: function () {
        if (!overlay.parentNode) return;
        overlay.parentNode.removeChild(overlay);
        var i = stack.indexOf(handle);
        if (i >= 0) stack.splice(i, 1);
        if (stack.length === 0) document.removeEventListener('keydown', onKey);
        if (options.onClose) options.onClose();
        try { if (previous && previous.focus && document.body.contains(previous)) previous.focus(); } catch (e) { /* ignore */ }
      },
      requestClose: function () {
        if (options.onRequestClose) options.onRequestClose(); else handle.close();
      }
    };
    if (options.closeOnBackdrop !== false) {
      overlay.addEventListener('click', function (e) { if (e.target === overlay) handle.requestClose(); });
    }
    document.body.appendChild(overlay);
    if (stack.length === 0) document.addEventListener('keydown', onKey);
    stack.push(handle);
    try { box.focus(); } catch (e) { /* ignore */ }
    return handle;
  }

  function closeAll() {
    while (stack.length) stack[stack.length - 1].close();
  }

  // ---------------------------------------------------------------- copy, download, share
  // navigator.clipboard first; otherwise select the text and use execCommand('copy').
  // If both fail the text stays selected so the person can copy it by hand.
  function copyField(field, status) {
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
      status.textContent = ok ? 'Copied.' : 'Could not copy automatically. The text is selected: tap it and choose Copy.';
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        navigator.clipboard.writeText(text).then(function () { status.textContent = 'Copied.'; }, fallback);
      } catch (e) {
        fallback();
      }
    } else {
      fallback();
    }
  }

  function downloadFile(text, filename, mime, status) {
    try {
      var blob = new Blob([text], { type: mime });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      status.textContent = 'Download started. If nothing happens, use Copy instead.';
    } catch (e) {
      status.textContent = 'Download is not available here. Use Copy instead.';
    }
  }

  function canShare() {
    return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  }

  // Opens the system share sheet for an export {text, filename, mime, format}. Code and link are shared as text;
  // JSON and PBN as a file when the browser can share files, otherwise as text. Must be called from a tap.
  function shareExport(exported, status) {
    var title = 'Bridge deal';
    var data;
    try {
      var asFile = false;
      if ((exported.format === 'json' || exported.format === 'pbn') &&
          typeof File === 'function' && typeof navigator.canShare === 'function') {
        var file = new File([exported.text], exported.filename, { type: exported.mime.split(';')[0] });
        if (navigator.canShare({ files: [file] })) { data = { files: [file], title: title }; asFile = true; }
      }
      if (!asFile) {
        data = (exported.format === 'link' && /^https?:\/\//i.test(exported.text))
          ? { title: title, url: exported.text }
          : { title: title, text: exported.text };
      }
      var p = navigator.share(data);
      if (p && p.then) {
        p.then(function () { status.textContent = 'Shared.'; }, function (e) {
          if (e && e.name === 'AbortError') { status.textContent = ''; return; }
          status.textContent = 'Could not open the share sheet. Use Copy or Download instead.';
        });
      }
    } catch (e) {
      status.textContent = 'Could not open the share sheet. Use Copy or Download instead.';
    }
  }

  // ---------------------------------------------------------------- the export dialog
  // Opens the dialog for a stored deal. options.baseUrl: address the link points at (default: this page).
  // Returns the overlay handle.
  function openDealExport(stored, options) {
    options = options || {};
    var h = openOverlay('Share or export this hand');
    var box = h.box;
    var current = 'code';
    var exported = null;

    var seg = el('div', 'dx-seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Format');
    var segButtons = {};
    Bridge.DEAL_FORMATS.forEach(function (format) {
      var b = button(LABELS[format], 'dx-segbtn', function () { show(format); });
      b.setAttribute('data-format', format);
      segButtons[format] = b;
      seg.appendChild(b);
    });
    box.appendChild(seg);

    var note = el('p', 'sd-note', '');
    box.appendChild(note);

    var field = el('textarea', 'sd-field dx-field');
    field.readOnly = true;
    field.setAttribute('spellcheck', 'false');
    field.setAttribute('aria-label', 'Text to copy');
    field.addEventListener('focus', function () { field.select(); });
    box.appendChild(field);

    var status = el('p', 'sd-status', '');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    var actions = el('div', 'sd-actions');
    var copyBtn = button('Copy', 'sd-btn sd-primary', function () { copyField(field, status); });
    var downloadBtn = button('Download', 'sd-btn', function () {
      if (exported) downloadFile(exported.text, exported.filename, exported.mime, status);
    });
    var shareBtn = null;
    actions.appendChild(copyBtn);
    actions.appendChild(downloadBtn);
    if (canShare()) {
      shareBtn = button('Share…', 'sd-btn', function () { if (exported) shareExport(exported, status); });
      actions.appendChild(shareBtn);
    }
    actions.appendChild(button('Close', 'sd-btn', function () { h.close(); }));
    box.appendChild(status);
    box.appendChild(actions);

    function show(format) {
      current = format;
      status.textContent = '';
      Bridge.DEAL_FORMATS.forEach(function (f) {
        segButtons[f].setAttribute('aria-pressed', f === format ? 'true' : 'false');
      });
      try {
        exported = Bridge.exportDealText(stored, format, options.baseUrl);
        var text = NOTES[format];
        if (format === 'link' && window.location.protocol === 'file:') {
          text += ' This app is open from a file, so the link only works on this device. Send the code instead.';
        }
        note.className = 'sd-note';
        note.textContent = text;
        field.value = exported.text;
        field.rows = (format === 'json' || format === 'pbn') ? 10 : 4;
        copyBtn.disabled = downloadBtn.disabled = false;
        if (shareBtn) shareBtn.disabled = false;
      } catch (e) {
        exported = null;
        note.className = 'sd-error';
        note.textContent = e.message;
        field.value = '';
        copyBtn.disabled = downloadBtn.disabled = true;
        if (shareBtn) shareBtn.disabled = true;
      }
    }

    show(current);
    return h;
  }

  Bridge.dealUi = {
    el: el,
    button: button,
    openOverlay: openOverlay,
    closeAll: closeAll,
    copyField: copyField,
    downloadFile: downloadFile,
    canShare: canShare,
    shareExport: shareExport
  };
  Bridge.openDealExport = openDealExport;
})();
