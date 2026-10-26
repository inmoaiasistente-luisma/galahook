/* ====================================================
   HERO "ENTRADA"
   Arriba del todo la foto respira (video en bucle, cámara quieta). Al bajar,
   el scroll maneja el video: la cámara avanza hacia León Dormido y, al final,
   la imagen se sumerge entre tiburones martillo. Tres capítulos con su texto,
   un índice a la derecha y una barra abajo. Sin movimiento: foto quieta.
   ==================================================== */
(function(){
  const hx = document.querySelector('.hx');
  if(!hx) return;
  const root = document.documentElement;
  const $  = s => hx.querySelector(s);
  const $$ = s => [...hx.querySelectorAll(s)];
  const es = () => root.lang === 'es';

  /* ---------------- Marco con esquinas cortadas (se calcula al tamaño real, no se deforma) ---------------- */
  const frame = $('.hx-frame'), fsvg = frame.querySelector('svg'), fpath = frame.querySelector('path');
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

  /* ---------------- Textos para lectores de pantalla (cambian con el idioma) ---------------- */
  const btn = $('.hx-pause'), railBox = $('.hx-rail');
  let paused = false;
  function labels(){
    railBox.setAttribute('aria-label', es() ? 'Capítulos' : 'Chapters');
    btn.setAttribute('aria-label', paused ? (es() ? 'Reproducir video' : 'Play video') : (es() ? 'Pausar video' : 'Pause video'));
  }
  labels();
  new MutationObserver(labels).observe(root, { attributes:true, attributeFilter:['lang'] });

  /* Sin movimiento (o navegador sin overflow:clip, que el escenario fijo necesita): queda la foto quieta */
  const motion = root.classList.contains('mx') && !!(window.CSS && CSS.supports && CSS.supports('overflow', 'clip'));
  if(!motion) return;
  root.classList.add('hx-on');

  /* ---------------- Videos: vertical en celular, 960 o 1600 según la pantalla ---------------- */
  const scrub = $('.hx-scrub'), loop = $('.hx-loop');
  const portrait = matchMedia('(max-aspect-ratio: 3/4)').matches;
  const px = window.innerWidth * Math.min(window.devicePixelRatio || 1, 2);
  const suf = portrait ? '-port.mp4' : window.innerWidth >= 900 && px > 1100 ? '-1600.mp4' : '-960.mp4';
  const saveData = !!(navigator.connection && navigator.connection.saveData);
  let dur = 0;
  if(!saveData){
    scrub.muted = loop.muted = true;
    scrub.addEventListener('loadedmetadata', () => {
      dur = scrub.duration || 0;
      // Safari no pinta cuadros de un video que nunca se reprodujo: play/pause silencioso
      const pr = scrub.play(); if(pr && pr.then) pr.then(() => scrub.pause()).catch(() => {});
      kick();
    }, { once:true });
    scrub.addEventListener('loadeddata', () => { hx.classList.add('is-ready'); kick(); }, { once:true });
    loop.addEventListener('canplay', () => hx.classList.add('loop-ok'), { once:true });
    scrub.src = scrub.dataset.src + suf;
    loop.src = loop.dataset.src + suf;
  }

  /* ---------------- Recorrido: 0 arriba del hero, 1 cuando el escenario se suelta ---------------- */
  const CH = [[0, .3], [.3, .64], [.64, 1.01]];   // tramos de cada capítulo
  const JUMP = [0, .42, .84];                      // a dónde lleva cada botón del índice
  const VEND = .66;                                // el video termina justo al sumergirse
  const DIVE = [.6, .78];                          // la línea de agua sube en este tramo
  const copies = $$('.hx-copy'), rail = $$('.hx-rail li'), cue = $('.hx-cue b');
  let p = 0, ch = -1, target = 0, vt = 0, raf = 0, live = null, liveT = null;
  let mx = 0, my = 0, tx = 0, ty = 0;

  function span(){ return Math.max(1, hx.offsetHeight - window.innerHeight); }
  function setChapter(n){
    ch = n;
    copies.forEach((el, i) => {
      el.classList.toggle('is-on', i === n);
      if(i === 0) el.classList.toggle('is-off', n !== 0);
      el.inert = i !== n;   // lo que no se ve no recibe foco
    });
    rail.forEach((li, i) => li.classList.toggle('is-on', i === n));
    const lab = n && copies[n].querySelector('[data-decode]'); if(lab) decode(lab, 520);
    const rl = rail[n] && rail[n].querySelector('[data-decode]'); if(rl) decode(rl);
  }
  function setLive(on){
    if(on === live) return;
    live = on;
    hx.classList.toggle('is-live', on);
    clearTimeout(liveT);
    if(on){ const pr = loop.play(); if(pr && pr.catch) pr.catch(() => {}); }
    else liveT = setTimeout(() => loop.pause(), 900);   // se apaga después del fundido
  }
  function update(){
    const top = hx.getBoundingClientRect().top;
    p = Math.min(1, Math.max(0, -top / span()));
    hx.style.setProperty('--hx-p', p.toFixed(4));
    cue.textContent = String(Math.round(p * 100)).padStart(2, '0');

    let n = CH.findIndex(([a, b]) => p >= a && p < b); if(n < 0) n = CH.length - 1;
    if(n !== ch) setChapter(n);
    rail.forEach((li, i) => li.style.setProperty('--f', Math.min(1, Math.max(0, (p - CH[i][0]) / (CH[i][1] - CH[i][0]))).toFixed(3)));

    const d = Math.min(1, Math.max(0, (p - DIVE[0]) / (DIVE[1] - DIVE[0]))), e = d * d * (3 - 2 * d);
    hx.style.setProperty('--hx-dive', (100 - e * 100).toFixed(2));
    hx.style.setProperty('--hx-to', d > 0 && d < 1 ? '1' : '0');
    hx.style.setProperty('--hx-ds', (d < 1 ? 1.12 - e * .12 : 1 + (p - DIVE[1]) * .25).toFixed(4));

    setLive(p < .012 && !paused && top > -window.innerHeight);
    target = Math.min(1, p / VEND);
    kick();
  }

  /* Un solo bucle de cuadros: el video persigue al scroll con suavidad y el fondo sigue al cursor */
  function kick(){ if(!raf) raf = requestAnimationFrame(tick); }
  function tick(){
    raf = 0;
    let more = false;
    if(dur){
      const t = target * (dur - .05);
      vt += (t - vt) * .18;
      if(Math.abs(t - vt) < .004) vt = t; else more = true;
      if(scrub.seeking) more = true;
      else if(Math.abs(scrub.currentTime - vt) > .01) scrub.currentTime = vt;
    }
    mx += (tx - mx) * .08; my += (ty - my) * .08;
    if(Math.abs(tx - mx) > .05 || Math.abs(ty - my) > .05) more = true;
    hx.style.setProperty('--hx-mx', mx.toFixed(2) + 'px');
    hx.style.setProperty('--hx-my', my.toFixed(2) + 'px');
    if(more) kick();
  }

  /* ---------------- Interacción ---------------- */
  rail.forEach((li, i) => li.querySelector('button').addEventListener('click', () => {
    const y = hx.getBoundingClientRect().top + window.scrollY + JUMP[i] * span();
    window.scrollTo({ top: Math.round(y), behavior:'smooth' });
  }));
  btn.addEventListener('click', () => {
    paused = !paused;
    hx.classList.toggle('is-paused', paused);
    btn.setAttribute('aria-pressed', paused ? 'true' : 'false');
    labels(); update();
  });
  $$('.hx-talk, .hx-rail button').forEach(a => a.addEventListener('pointerenter', () => {
    const s = a.querySelector('[data-decode]'); if(s) decode(s, 360);
  }));
  if(matchMedia('(hover:hover) and (pointer:fine)').matches){
    hx.addEventListener('pointermove', e => {
      tx = (e.clientX / window.innerWidth - .5) * -16;
      ty = (e.clientY / window.innerHeight - .5) * -10;
      kick();
    }, { passive:true });
    hx.addEventListener('pointerleave', () => { tx = ty = 0; kick(); });
  }
  // cuando el hero entra (después de la intro del globo) las etiquetas de la barra se decodifican en cascada
  new MutationObserver((m, mo) => {
    if(!hx.classList.contains('mx-in')) return;
    mo.disconnect();
    $$('.hx-rail [data-decode], .hx-dock [data-decode]').forEach((s, i) => setTimeout(() => decode(s, 420), 1300 + i * 110));
  }).observe(hx, { attributes:true, attributeFilter:['class'] });

  window.addEventListener('scroll', update, { passive:true });
  window.addEventListener('resize', update);
  window.addEventListener('load', update);
  update();
})();
