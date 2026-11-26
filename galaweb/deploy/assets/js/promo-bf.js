/* =========================================================
   Barra de promoción — Black Friday 2026 (pedido del owner,
   2026-11-26). SOLO anuncia: los descuentos los valida y aplica
   el servidor (public.discount_rules). La barra y la sugerencia
   del checkout se apagan solas al pasar promo.endsAt (lunes 30
   nov 23:59:59 hora de Galápagos) y la página vuelve a lo normal.
   La carga app.js (loadPromo) solo mientras la promo está vigente.
   API: window.GHAPromo.render(cfg, lang) · .codeFor(cfg, tourId)
        · .active(cfg) · .timeLeft(cfg, lang) · .barHtml(cfg, lang)
   ========================================================= */
(function () {
  'use strict';

  var DISMISS_KEY = 'gha_promo_dismissed';
  var timer = null, bound = false, state = { cfg: null, lang: 'en' };

  function tr(v, lang) {
    if (v == null) return '';
    if (typeof v === 'object') return v[lang] != null ? v[lang] : (v.en != null ? v.en : '');
    return String(v);
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function active(cfg, now) {
    if (!cfg || !cfg.endsAt || !cfg.codes || !cfg.codes.length) return false;
    var end = Date.parse(cfg.endsAt);
    return isFinite(end) && (now == null ? Date.now() : now) < end;
  }

  /* Código que corresponde a una experiencia (null si no hay o ya venció). */
  function codeFor(cfg, tourId, now) {
    if (!tourId || !active(cfg, now)) return null;
    for (var i = 0; i < cfg.codes.length; i++) {
      var c = cfg.codes[i];
      if (c && c.ids && c.ids.indexOf(tourId) !== -1) return c;
    }
    return null;
  }

  function timeLeft(cfg, lang, now) {
    var ms = Date.parse(cfg.endsAt) - (now == null ? Date.now() : now);
    if (!(ms > 0)) return '';
    var m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
    return (lang === 'es' ? 'Termina en ' : 'Ends in ') + (d ? d + 'd ' : '') + ((d || h) ? h + 'h ' : '') + mm + 'm';
  }

  function barHtml(cfg, lang, now) {
    var offers = cfg.codes.map(function (c) {
      return '<span class="bf-offer"><b class="bf-pct">−' + esc(c.pct) + '%</b> ' + esc(tr(c.label, lang))
        + ' <button type="button" class="bf-code" data-code="' + esc(c.code) + '" title="'
        + esc(lang === 'es' ? 'Copiar código' : 'Copy code') + '">' + esc(c.code) + '</button></span>';
    }).join('');
    return '<div class="bf-in">'
      + '<span class="bf-badge">' + esc(tr(cfg.badge, lang)) + '</span>'
      + offers
      + '<span class="bf-when"><span class="bf-left" id="bfLeft" title="' + esc(tr(cfg.until, lang)) + '">' + esc(timeLeft(cfg, lang, now)) + '</span>'
      + '<span class="bf-dl"> · ' + esc(tr(cfg.until, lang)) + '</span></span>'
      + '<span class="bf-travel">' + esc(tr(cfg.travel, lang)) + '</span>'
      + '</div>'
      + '<button type="button" class="bf-x" id="bfClose" aria-label="' + esc(lang === 'es' ? 'Cerrar' : 'Close') + '">&times;</button>';
  }

  function dismissed(cfg) {
    try { return sessionStorage.getItem(DISMISS_KEY) === cfg.id; } catch (e) { return false; }
  }
  function ensureCss() {
    if (document.getElementById('bfCss')) return;
    var l = document.createElement('link');
    l.id = 'bfCss'; l.rel = 'stylesheet'; l.href = '/assets/css/promo-bf.css?v=bf1';
    l.onload = layout;
    document.head.appendChild(l);
  }

  /* La barra ocupa su propio espacio arriba (padding del body) y se va con
     el scroll; el header fijo baja lo que mide la barra mientras se ve. */
  function layout() {
    var b = document.getElementById('bfBar'), root = document.documentElement;
    if (!b) return;
    var h = b.offsetHeight;
    root.style.setProperty('--bf-h', h + 'px');
    root.style.setProperty('--bf-top', Math.max(0, h - (window.scrollY || 0)) + 'px');
  }

  function remove() {
    var b = document.getElementById('bfBar'), root = document.documentElement;
    if (b) b.remove();
    root.classList.remove('bf-on');
    root.style.removeProperty('--bf-h');
    root.style.removeProperty('--bf-top');
    if (timer) { clearInterval(timer); timer = null; }
  }

  function copy(code, btn, lang) {
    var done = function () {
      var old = btn.textContent;
      btn.textContent = lang === 'es' ? '¡Copiado!' : 'Copied!';
      btn.classList.add('ok');
      setTimeout(function () { btn.textContent = old; btn.classList.remove('ok'); }, 1400);
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(code).then(done, done); return; }
    } catch (e) { /* sin portapapeles: igual se ve el código */ }
    done();
  }

  function render(cfg, lang) {
    state.cfg = cfg; state.lang = lang || 'en';
    if (!active(cfg) || dismissed(cfg)) { remove(); return; }
    ensureCss();
    var b = document.getElementById('bfBar');
    if (!b) {
      b = document.createElement('div');
      b.id = 'bfBar'; b.className = 'bf-bar'; b.setAttribute('role', 'region'); b.setAttribute('aria-label', 'Black Friday');
      document.body.insertBefore(b, document.body.firstChild);
    }
    b.innerHTML = barHtml(cfg, state.lang);
    document.documentElement.classList.add('bf-on');
    b.querySelectorAll('.bf-code').forEach(function (btn) {
      btn.addEventListener('click', function () { copy(btn.dataset.code, btn, state.lang); });
    });
    document.getElementById('bfClose').addEventListener('click', function () {
      try { sessionStorage.setItem(DISMISS_KEY, cfg.id); } catch (e) { /* solo se cierra en esta vista */ }
      remove();
    });
    layout();
    if (!bound) {
      bound = true;
      window.addEventListener('scroll', layout, { passive: true });
      window.addEventListener('resize', layout);
    }
    if (timer) clearInterval(timer);
    timer = setInterval(function () {
      if (!active(state.cfg)) { remove(); return; }            // venció: vuelve a la normalidad
      var el = document.getElementById('bfLeft');
      if (el) el.textContent = timeLeft(state.cfg, state.lang);
    }, 30000);
  }

  window.GHAPromo = { render: render, codeFor: codeFor, active: active, timeLeft: timeLeft, barHtml: barHtml };
})();
