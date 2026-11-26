/* =========================================================
   Promo Black Friday 2026 (pedido del owner, 2026-11-26):
   barra animada arriba + popup (una vez por sesión). SOLO
   anuncia: los descuentos los valida y aplica el servidor
   (public.discount_rules). Todo se apaga solo al pasar
   promo.endsAt (lunes 30 nov 23:59:59 hora de Galápagos) y la
   página vuelve a lo normal. app.js (loadPromo) solo carga este
   archivo mientras la promo está vigente.
   API: window.GHAPromo.render(cfg, lang) · .codeFor(cfg, tourId)
        · .active(cfg) · .timeLeft(cfg, lang) · .barHtml(cfg, lang)
        · .popHtml(cfg, lang) · .openPop()
   ========================================================= */
(function () {
  'use strict';

  var DISMISS_KEY = 'gha_promo_dismissed';   // barra cerrada en esta sesión
  var POP_KEY = 'gha_promo_pop_seen';        // popup ya mostrado en esta sesión
  var timer = null, bound = false, popTimer = null;
  var state = { cfg: null, lang: 'en' };

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
  function pad(n) { return (n < 10 ? '0' : '') + n; }

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

  function parts(cfg, now) {
    var ms = Date.parse(cfg.endsAt) - (now == null ? Date.now() : now);
    if (!(ms > 0)) return null;
    var s = Math.floor(ms / 1000);
    return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
  }
  function timeLeft(cfg, lang, now) {
    var p = parts(cfg, now);
    if (!p) return '';
    return (lang === 'es' ? 'Termina en ' : 'Ends in ') + (p.d ? p.d + 'd ' : '') + ((p.d || p.h) ? p.h + 'h ' : '') + p.m + 'm ' + pad(p.s) + 's';
  }

  /* ---------------- barra ---------------- */
  function barHtml(cfg, lang, now) {
    var es = lang === 'es';
    var offers = cfg.codes.map(function (c) {
      return '<span class="bf-offer"><b class="bf-pct">−' + esc(c.pct) + '%</b> ' + esc(tr(c.label, lang))
        + ' <button type="button" class="bf-code" data-code="' + esc(c.code) + '" title="'
        + esc(es ? 'Copiar código' : 'Copy code') + '">' + esc(c.code) + '</button></span>';
    }).join('');
    return '<div class="bf-in">'
      + '<button type="button" class="bf-badge" id="bfOpen" title="' + esc(es ? 'Ver la promo' : 'See the deal') + '">' + esc(tr(cfg.badge, lang)) + '</button>'
      + offers
      + '<span class="bf-when"><span class="bf-left" id="bfLeft" title="' + esc(tr(cfg.until, lang)) + '">' + esc(timeLeft(cfg, lang, now)) + '</span>'
      + '<span class="bf-dl"> · ' + esc(tr(cfg.until, lang)) + '</span></span>'
      + '<span class="bf-travel">' + esc(tr(cfg.travel, lang)) + '</span>'
      + '</div>'
      + '<button type="button" class="bf-x" id="bfClose" aria-label="' + esc(es ? 'Cerrar' : 'Close') + '">&times;</button>';
  }

  /* ---------------- popup ---------------- */
  function popHtml(cfg, lang, now) {
    var es = lang === 'es';
    var p = parts(cfg, now) || { d: 0, h: 0, m: 0, s: 0 };
    function box(u, n, label) {
      return '<div class="bfp-box"><b class="bfp-n" data-u="' + u + '">' + (u === 'd' ? n : pad(n)) + '</b><span class="bfp-u">' + label + '</span></div>';
    }
    var coupons = cfg.codes.map(function (c, i) {
      return '<div class="bfp-coupon" style="--i:' + i + '">'
        + '<div class="bfp-off"><b>' + esc(c.pct) + '%</b><span>OFF</span></div>'
        + '<div class="bfp-cinfo"><p>' + esc(tr(c.long || c.label, lang)) + '</p>'
        + '<button type="button" class="bfp-code" data-code="' + esc(c.code) + '">' + esc(c.code) + '</button>'
        + '<small>' + (es ? 'Toca el código para copiarlo' : 'Tap the code to copy it') + '</small></div></div>';
    }).join('');
    return '<div class="bfp-card" role="document">'
      + '<button type="button" class="bfp-x" aria-label="' + (es ? 'Cerrar' : 'Close') + '">&times;</button>'
      + '<span class="bfp-kicker">Galápagos Hook Adventure</span>'
      + '<h2 class="bfp-title" id="bfpTitle">' + esc(tr(cfg.badge, lang)) + '</h2>'
      + '<p class="bfp-sub">' + esc(tr(cfg.popSub, lang)) + '</p>'
      + '<div class="bfp-coupons">' + coupons + '</div>'
      + '<div class="bfp-clock">' + box('d', p.d, es ? 'días' : 'days') + box('h', p.h, es ? 'horas' : 'hrs')
      + box('m', p.m, 'min') + box('s', p.s, es ? 'seg' : 'sec') + '</div>'
      + '<p class="bfp-travel">' + esc(tr(cfg.popTravel, lang)) + '</p>'
      + '<div class="bfp-ctas"><a class="bfp-cta" href="/packages.html">' + (es ? 'Ver paquetes' : 'See packages') + '</a>'
      + '<a class="bfp-cta ghost" href="/tours.html">' + (es ? 'Ver tours' : 'See tours') + '</a></div>'
      + '<button type="button" class="bfp-later">' + (es ? 'Ahora no' : 'Not now') + '</button>'
      + '</div>';
  }

  function popSeen(cfg) {
    try { return sessionStorage.getItem(POP_KEY) === cfg.id; } catch (e) { return true; }  // sin storage: no insistir
  }
  function onPopKey(e) { if (e.key === 'Escape') closePop(); }
  function closePop() {
    var back = document.getElementById('bfPop');
    if (!back) return;
    back.classList.remove('on');
    document.removeEventListener('keydown', onPopKey);
    document.documentElement.style.overflow = '';
    setTimeout(function () { if (back.parentNode) back.parentNode.removeChild(back); }, 320);
  }
  function bindPop(back) {
    back.querySelector('.bfp-x').addEventListener('click', closePop);
    back.querySelector('.bfp-later').addEventListener('click', closePop);
    back.querySelectorAll('.bfp-code').forEach(function (btn) {
      btn.addEventListener('click', function () { copy(btn.dataset.code, btn, state.lang); });
    });
    back.querySelectorAll('.bfp-cta').forEach(function (a) {
      a.addEventListener('click', function (e) {
        if (a.pathname === location.pathname) { e.preventDefault(); closePop(); }   // ya está en esa página
      });
    });
  }
  function openPop() {
    var cfg = state.cfg;
    if (!active(cfg) || document.getElementById('bfPop')) return;
    try { sessionStorage.setItem(POP_KEY, cfg.id); } catch (e) { /* igual se muestra esta vez */ }
    var back = document.createElement('div');
    back.id = 'bfPop'; back.className = 'bfp-back';
    back.setAttribute('role', 'dialog'); back.setAttribute('aria-modal', 'true'); back.setAttribute('aria-labelledby', 'bfpTitle');
    back.innerHTML = popHtml(cfg, state.lang);
    back.addEventListener('click', function (e) { if (e.target === back) closePop(); });
    document.body.appendChild(back);
    bindPop(back);
    document.addEventListener('keydown', onPopKey);
    document.documentElement.style.overflow = 'hidden';
    void back.offsetWidth;          // fija el estado inicial para que la entrada se anime
    back.classList.add('on');
    try { back.querySelector('.bfp-cta').focus({ preventScroll: true }); } catch (e) { /* sin foco */ }
  }
  /* Se muestra una vez por sesión, ~1.5 s después de cargar, cuando no hay
     otra ventana encima (intro del globo, popup de contacto o checkout). */
  function schedulePop() {
    if (popTimer || popSeen(state.cfg)) return;
    function busy() {
      return document.getElementById('globeIntro') || document.querySelector('.ghn-back')
        || document.querySelector('#bkDrop.open') || document.querySelector('#dtDrop.open');
    }
    function wait() {
      if (!active(state.cfg) || popSeen(state.cfg)) return;
      if (busy()) { popTimer = setTimeout(wait, 700); return; }
      popTimer = setTimeout(function () { if (!busy()) openPop(); else wait(); }, 1500);
    }
    popTimer = setTimeout(wait, 400);
  }

  /* ---------------- comunes ---------------- */
  function dismissed(cfg) {
    try { return sessionStorage.getItem(DISMISS_KEY) === cfg.id; } catch (e) { return false; }
  }
  function ensureCss() {
    if (document.getElementById('bfCss')) return;
    var l = document.createElement('link');
    l.id = 'bfCss'; l.rel = 'stylesheet'; l.href = '/assets/css/promo-bf.css?v=bf2';
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

  function removeBar() {
    var b = document.getElementById('bfBar'), root = document.documentElement;
    if (b) b.remove();
    root.classList.remove('bf-on');
    root.style.removeProperty('--bf-h');
    root.style.removeProperty('--bf-top');
  }
  function stopAll() {
    removeBar(); closePop();
    if (timer) { clearInterval(timer); timer = null; }
    if (popTimer) { clearTimeout(popTimer); popTimer = null; }
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

  /* Cada segundo: cuenta regresiva de la barra y del popup; al vencer, todo se va. */
  function tick() {
    if (!active(state.cfg)) { stopAll(); return; }
    var el = document.getElementById('bfLeft');
    if (el) el.textContent = timeLeft(state.cfg, state.lang);
    var pop = document.getElementById('bfPop');
    var p = pop && parts(state.cfg);
    if (p) {
      pop.querySelectorAll('.bfp-n').forEach(function (n) {
        var u = n.dataset.u, v = u === 'd' ? String(p.d) : pad(p[u]);
        if (n.textContent !== v) { n.textContent = v; n.classList.remove('tick'); void n.offsetWidth; n.classList.add('tick'); }
      });
    }
  }

  function render(cfg, lang) {
    state.cfg = cfg; state.lang = lang || 'en';
    if (!active(cfg)) { stopAll(); return; }
    ensureCss();
    if (!dismissed(cfg)) {
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
      document.getElementById('bfOpen').addEventListener('click', openPop);
      document.getElementById('bfClose').addEventListener('click', function () {
        try { sessionStorage.setItem(DISMISS_KEY, cfg.id); } catch (e) { /* solo se cierra en esta vista */ }
        removeBar();
      });
      layout();
    } else {
      removeBar();
    }
    /* Popup abierto + cambio de idioma: se repinta en el idioma nuevo. */
    var pop = document.getElementById('bfPop');
    if (pop) { pop.innerHTML = popHtml(cfg, state.lang); bindPop(pop); pop.querySelector('.bfp-card').style.transition = 'none'; }
    if (!bound) {
      bound = true;
      window.addEventListener('scroll', layout, { passive: true });
      window.addEventListener('resize', layout);
    }
    if (!timer) timer = setInterval(tick, 1000);
    schedulePop();
  }

  window.GHAPromo = { render: render, codeFor: codeFor, active: active, timeLeft: timeLeft, barHtml: barHtml, popHtml: popHtml, openPop: openPop };
})();
