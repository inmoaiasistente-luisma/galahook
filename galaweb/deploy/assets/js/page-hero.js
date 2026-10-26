/* ====================================================
   CABECERA DE PÁGINAS INTERNAS
   Arriba la foto respira (video en bucle, cámara quieta). Con data-ph-run el
   escenario queda fijo un tramo corto: el scroll empuja la cámara hacia
   adelante y el texto se despide antes de que entre la página. Sin
   data-ph-run (contacto) la cabecera se va normal, con el mismo empuje suave.
   Sin movimiento: foto quieta.
   ==================================================== */
(function(){
  const ph = document.querySelector('.ph');
  if(!ph) return;
  const root = document.documentElement;
  const $  = s => ph.querySelector(s);
  const $$ = s => [...ph.querySelectorAll(s)];
  const es = () => root.lang === 'es';

  /* ---------------- Marco con esquinas cortadas (al tamaño real, no se deforma) ---------------- */
  const frame = $('.ph-frame'), fsvg = frame.querySelector('svg'), fpath = frame.querySelector('path');
  function drawFrame(){
    const w = frame.clientWidth, h = frame.clientHeight; if(!w || !h) return;
    const c = w < 700 ? 12 : 18, x0 = .5, y0 = .5, x1 = w - .5, y1 = h - .5;
    fsvg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    fpath.setAttribute('d', 'M' + (x0 + c) + ' ' + y0 + 'H' + (x1 - c) + 'L' + x1 + ' ' + (y0 + c) + 'V' + (y1 - c)
      + 'L' + (x1 - c) + ' ' + y1 + 'H' + (x0 + c) + 'L' + x0 + ' ' + (y1 - c) + 'V' + (y0 + c) + 'Z');
  }
  drawFrame();
  if('ResizeObserver' in window) new ResizeObserver(drawFrame).observe(frame); else window.addEventListener('resize', drawFrame);

  /* ---------------- Etiquetas que se "decodifican" (letras al azar que se asientan) ---------------- */
  const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789·/';
  function decode(el, dur){
    const t = el.firstChild; if(!t || t.nodeType !== 3) return;
    if(el._dc){ cancelAnimationFrame(el._dc.raf); clearTimeout(el._dc.to); if(el._dc.t === t) t.data = el._dc.final; }
    const final = t.data, n = final.length, t0 = performance.now(), st = el._dc = { t, final };
    dur = dur || 400;
    const done = () => { if(el._dc === st){ cancelAnimationFrame(st.raf); t.data = final; el._dc = null; } };
    const step = now => {
      const k = Math.min(1, (now - t0) / dur), fixed = Math.floor(k * n);
      let s = final.slice(0, fixed);
      for(let i = fixed; i < n; i++) s += final[i] === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      t.data = s;   // solo el texto (characterData): no despierta a los observadores de motion.js
      if(k < 1) st.raf = requestAnimationFrame(step); else done();
    };
    st.raf = requestAnimationFrame(step);
    st.to = setTimeout(done, dur + 150);   // sin cuadros (pestaña oculta) el texto final igual llega
  }

  /* ---------------- Pausa: texto para lectores de pantalla según el idioma ---------------- */
  const btn = $('.ph-pause');
  let paused = false;
  function labels(){ btn.setAttribute('aria-label', paused ? (es() ? 'Reproducir video' : 'Play video') : (es() ? 'Pausar video' : 'Pause video')); }
  labels();
  new MutationObserver(labels).observe(root, { attributes:true, attributeFilter:['lang'] });

  /* ---------------- Entrada (no hay intro del globo en estas páginas) ---------------- */
  if(!root.classList.contains('mx')) return;
  let entered = false;
  const enter = () => {
    if(entered) return; entered = true;
    ph.classList.add('mx-in');
    $$('[data-decode]').forEach((s, i) => setTimeout(() => decode(s, 520), 250 + i * 900));
  };
  requestAnimationFrame(() => requestAnimationFrame(enter));
  setTimeout(enter, 150);   // con la pestaña en segundo plano no hay cuadros

  /* Sin overflow:clip el escenario fijo no funciona: queda la entrada y la foto quieta */
  if(!(window.CSS && CSS.supports && CSS.supports('overflow', 'clip'))) return;
  root.classList.add('ph-on');

  /* ---------------- Video: vertical en celular, 960 o 1600 según la pantalla ---------------- */
  const loop = $('.ph-loop');
  const portrait = matchMedia('(max-aspect-ratio: 3/4)').matches;
  const px = window.innerWidth * Math.min(window.devicePixelRatio || 1, 2);
  const suf = portrait ? '-port.mp4' : window.innerWidth >= 900 && px > 1100 ? '-1600.mp4' : '-960.mp4';
  const saveData = !!(navigator.connection && navigator.connection.saveData);
  let visible = true;
  function sync(){
    if(!loop.src) return;
    if(visible && !paused){ const pr = loop.play(); if(pr && pr.catch) pr.catch(() => {}); }
    else loop.pause();
  }
  if(loop && !saveData){
    loop.muted = true;
    loop.addEventListener('canplay', () => { ph.classList.add('loop-ok'); sync(); }, { once:true });
    loop.preload = 'auto';
    loop.src = loop.dataset.src + suf;
    // fuera de pantalla el video descansa
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; sync(); }).observe(ph);
  }

  /* ---------------- Recorrido ---------------- */
  const run = ph.hasAttribute('data-ph-run');
  const cue = $('.ph-cue b');
  let raf = 0, mx = 0, my = 0, tx = 0, ty = 0;
  const clamp = v => Math.min(1, Math.max(0, v));
  const smooth = (a, b, v) => { const k = clamp((v - a) / (b - a)); return k * k * (3 - 2 * k); };

  function update(){
    const r = ph.getBoundingClientRect(), vh = window.innerHeight;
    // con tramo fijo: 0 arriba, 1 cuando el escenario se suelta; sin tramo: 0 arriba, 1 cuando la cabecera se fue
    const p = run ? clamp(-r.top / Math.max(1, ph.offsetHeight - vh)) : clamp(-r.top / Math.max(1, r.height));
    const out = smooth(.22, .86, p);
    ph.style.setProperty('--ph-p', p.toFixed(4));
    ph.style.setProperty('--ph-s', (1 + p * .16).toFixed(4));
    ph.style.setProperty('--ph-ty', (-out * 70).toFixed(1) + 'px');
    ph.style.setProperty('--ph-o', (1 - out).toFixed(3));
    ph.style.setProperty('--ph-dk', (smooth(.4, 1, p) * .5).toFixed(3));
    if(!run) ph.style.setProperty('--ph-py', (p * r.height * .28).toFixed(1) + 'px');
    if(cue) cue.textContent = String(Math.round(p * 100)).padStart(2, '0');
  }

  /* El fondo sigue al cursor con suavidad (solo ratón) */
  function kick(){ if(!raf) raf = requestAnimationFrame(tick); }
  function tick(){
    raf = 0;
    mx += (tx - mx) * .08; my += (ty - my) * .08;
    if(Math.abs(tx - mx) > .05 || Math.abs(ty - my) > .05) kick();
    ph.style.setProperty('--ph-mx', mx.toFixed(2) + 'px');
    ph.style.setProperty('--ph-my', my.toFixed(2) + 'px');
  }
  if(matchMedia('(hover:hover) and (pointer:fine)').matches){
    ph.addEventListener('pointermove', e => {
      tx = (e.clientX / window.innerWidth - .5) * -16;
      ty = (e.clientY / window.innerHeight - .5) * -10;
      kick();
    }, { passive:true });
    ph.addEventListener('pointerleave', () => { tx = ty = 0; kick(); });
  }

  /* ---------------- Interacción ---------------- */
  btn.addEventListener('click', () => {
    paused = !paused;
    ph.classList.toggle('is-paused', paused);
    btn.setAttribute('aria-pressed', paused ? 'true' : 'false');
    labels(); sync();
  });
  $$('.ph-talk').forEach(a => a.addEventListener('pointerenter', () => {
    const s = a.querySelector('[data-decode]'); if(s) decode(s, 360);
  }));

  let ticking = false;
  window.addEventListener('scroll', () => { if(!ticking){ ticking = true; requestAnimationFrame(() => { ticking = false; update(); }); } }, { passive:true });
  window.addEventListener('resize', update);
  update();
})();
