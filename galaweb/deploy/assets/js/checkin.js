/* =========================================================
   GALÁPAGOS HOOK ADVENTURE — check-in móvil
   ---------------------------------------------------------
   La cámara nativa del teléfono escanea el QR y abre esta página
   con #t=TOKEN. Aquí NO se usa la cámara desde JavaScript.

   El token viaja en el FRAGMENTO de la URL: el navegador no lo envía
   al servidor en la carga inicial, de modo que no queda en logs de
   acceso ni en cabeceras Referer. Se lee SOLO de location.hash.

   El token se guarda SOLO en memoria: nunca en localStorage ni
   sessionStorage. Se retira de la barra de direcciones con
   history.replaceState INMEDIATAMENTE después de leerlo, y nunca se
   vuelve a escribir en la URL. Tampoco se imprime en consola ni viaja
   en la query string: se envía por POST en el cuerpo JSON.
   ========================================================= */
(function () {
  "use strict";

  var ES = (function () { try { return localStorage.getItem('GHA_LANG') === 'es'; } catch (e) { return false; } })();
  var root = document.getElementById('ckRoot');

  /* Token SOLO en memoria. Se lee exclusivamente del fragmento (#t=…). */
  var TOKEN = (function () {
    try {
      var frag = String(window.location.hash || '').replace(/^#/, '');
      if (!frag) return '';
      var v = new URLSearchParams(frag).get('t');
      return v ? String(v) : '';
    } catch (e) { return ''; }
  })();

  /* Se retira de la barra de direcciones de inmediato, haya token o no. */
  (function stripTokenFromUrl() {
    try {
      if (window.history && history.replaceState) {
        history.replaceState(null, document.title, window.location.pathname);
      }
    } catch (e) { /* noop */ }
  })();

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function api(url, opts) {
    return fetch(url, Object.assign({ credentials: 'same-origin', headers: { Accept: 'application/json' } }, opts || {}))
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d }; }); });
  }

  /* ---------------- pantallas ---------------- */
  function showState(kind, big, sub) {
    return '<div class="ck-state ' + kind + '"><span class="big">' + esc(big) + '</span>'
      + (sub ? '<span class="sub">' + esc(sub) + '</span>' : '') + '</div>';
  }
  function showError(code) {
    var m = {
      QR_INVALID: [ES ? 'Código no válido' : 'Invalid code', ES ? 'Este QR no es válido.' : 'This QR code is not valid.'],
      QR_EXPIRED: [ES ? 'Código expirado' : 'Code expired', ES ? 'Este QR ya no está vigente.' : 'This QR code is no longer valid.'],
      QR_REVOKED: [ES ? 'Código revocado' : 'Code revoked', ES ? 'Este QR fue anulado.' : 'This QR code was revoked.'],
      BOOKING_NOT_CONFIRMED: [ES ? 'Reserva no válida' : 'Booking not valid', ES ? 'Esta reserva no está confirmada.' : 'This booking is not confirmed.']
    };
    var t = m[code] || [ES ? 'No se pudo verificar' : 'Could not verify', ES ? 'Inténtalo nuevamente.' : 'Please try again.'];
    root.innerHTML = showState('ck-err', t[0], t[1]);
  }
  function loading() { root.innerHTML = '<div class="ck-muted">' + (ES ? 'Verificando…' : 'Checking…') + '</div>'; }

  function row(label, value) {
    if (value == null || value === '') return '';
    return '<div class="ck-row"><span>' + esc(label) + '</span><b>' + value + '</b></div>';
  }
  function renderBooking(b) {
    var completed = b.completed === true;
    var head = completed
      ? showState('ck-done', ES ? 'Tour completado' : 'Tour completed', ES ? 'Pago confirmado' : 'Payment confirmed')
      : showState('ck-ok', ES ? 'Reserva confirmada' : 'Booking confirmed', ES ? 'Pago confirmado' : 'Payment confirmed');

    var html = head + '<div class="ck-card">'
      + '<div class="ck-code">' + esc(b.booking_code) + '</div>'
      + '<div class="ck-tour">' + esc(b.tour_name) + '</div>'
      + '<div class="ck-rows">'
      + row(ES ? 'Fecha del tour' : 'Tour date', esc(b.booking_date))
      + row(ES ? 'Cliente' : 'Customer', esc(b.customer_name))
      + row('Pax', esc(b.guests))
      + row(ES ? 'Teléfono' : 'Phone', b.customer_phone ? ('<a href="tel:' + esc(b.customer_phone) + '">' + esc(b.customer_phone) + '</a>') : '')
      + row('Email', b.customer_email ? ('<a href="mailto:' + esc(b.customer_email) + '">' + esc(b.customer_email) + '</a>') : '')
      + '</div>'
      + (b.notes ? ('<div class="ck-notes"><i>' + (ES ? 'Notas' : 'Notes') + '</i>' + esc(b.notes) + '</div>') : '')
      + '</div>';
    root.innerHTML = html;
  }

  /* ---------------- login en línea ---------------- */
  function renderLogin(onDone) {
    root.innerHTML = '<div class="ck-card">'
      + '<div style="font-family:var(--display);font-size:20px;font-weight:700;margin-bottom:4px">'
      + (ES ? 'Inicia sesión' : 'Sign in') + '</div>'
      + '<p style="color:rgba(255,255,255,.6);font-size:14px;margin-bottom:18px">'
      + (ES ? 'Necesitas tu cuenta del equipo para ver la reserva.' : 'You need your team account to view this booking.') + '</p>'
      + '<div class="ck-err-msg" id="ckLoginErr"></div>'
      + '<form id="ckLoginForm">'
      + '<div class="field"><label>Email</label><input type="email" id="ckEmail" autocomplete="username" required></div>'
      + '<div class="field"><label>' + (ES ? 'Contraseña' : 'Password') + '</label>'
      + '<input type="password" id="ckPass" autocomplete="current-password" required></div>'
      + '<button type="submit" class="btn btn-gold btn-block" id="ckLoginBtn" style="margin-top:8px">'
      + (ES ? 'Entrar' : 'Sign in') + '</button>'
      + '</form></div>';

    var btn = document.getElementById('ckLoginBtn');
    var err = document.getElementById('ckLoginErr');
    document.getElementById('ckLoginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var email = document.getElementById('ckEmail').value.trim();
      var pass = document.getElementById('ckPass').value;
      if (!email || !pass) return;
      err.classList.remove('show');
      btn.disabled = true;
      var label = btn.textContent;
      btn.textContent = ES ? 'Entrando…' : 'Signing in…';
      api('/api/admin-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: email, password: pass })
      }).then(function (r) {
        if (r.ok && r.data && r.data.authenticated) { onDone(); return; }   // vuelve al mismo token
        err.textContent = (r.data && r.data.error === 'NO_ACCESS')
          ? (ES ? 'No tienes acceso a este panel.' : 'You do not have access to this panel.')
          : (ES ? 'Correo o contraseña incorrectos.' : 'Invalid email or password.');
        err.classList.add('show'); btn.disabled = false; btn.textContent = label;
      }).catch(function () {
        err.textContent = ES ? 'No pudimos iniciar sesión. Inténtalo nuevamente.' : 'We could not sign you in. Please try again.';
        err.classList.add('show'); btn.disabled = false; btn.textContent = label;
      });
    });
  }

  /* ---------------- flujo ---------------- */
  function lookup() {
    if (!TOKEN) { showError('QR_INVALID'); return; }
    loading();
    /* POST: el token va en el cuerpo JSON, nunca en la URL. */
    api('/api/booking-qr-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ token: TOKEN })
    }).then(function (r) {
      if (r.status === 401) { renderLogin(lookup); return; }               // sesión caducada a mitad
      if (r.ok && r.data && r.data.booking) {
        TOKEN = '';                 // ya no hace falta: fuera de memoria
        renderBooking(r.data.booking);
        return;
      }
      TOKEN = '';
      showError(r.data && r.data.error);
    }).catch(function () {
      root.innerHTML = '<div class="ck-state ck-err"><span class="big">'
        + (ES ? 'Sin conexión' : 'Connection error') + '</span><span class="sub">'
        + (ES ? 'Inténtalo nuevamente.' : 'Please try again.') + '</span></div>';
    });
  }

  function boot() {
    if (!TOKEN) {
      root.innerHTML = '<div class="ck-state ck-err"><span class="big">'
        + (ES ? 'Falta el código' : 'Missing code') + '</span><span class="sub">'
        + (ES ? 'Escanea el QR de la reserva.' : 'Scan the booking QR code.') + '</span></div>';
      return;
    }
    loading();
    api('/api/admin-session').then(function (r) {
      if (r.ok && r.data && r.data.authenticated) lookup();
      else renderLogin(lookup);
    }).catch(function () { renderLogin(lookup); });
  }

  boot();
})();
