/* ====================================================
   CAPA DE MOVIMIENTO
   Se carga en <head> para marcar html.mx antes del primer pintado; el resto
   corre cuando app.js ya pintó la página. Sin librerías externas (respeta la
   CSP del sitio). Se apaga con "reducir movimiento" del sistema o ?motion=off.
   ==================================================== */
(function(){
  const off = /[?&]motion=off\b/.test(location.search);
  const reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const root = document.documentElement;
  if(!off && !reduce) root.classList.add('mx');

  const $  = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  function ready(fn){ if(document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn); }
  function esc(s){ return s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  if(off || reduce) return;

  /* ---------------- Aparición al entrar en pantalla ---------------- */
  const seen = new WeakSet();
  const io = new IntersectionObserver(ents => ents.forEach(e => {
    if(!e.isIntersecting) return;
    const el = e.target;
    el.classList.add('mx-in'); io.unobserve(el);
    if(el.matches('.stats')) countAll(el);
    // pasada la cascada, el hover de las tarjetas responde sin retraso
    if(el.matches('.pkg-grid,#toursGrid')) setTimeout(() => el.classList.add('mx-done'), 1600);
  }), { rootMargin:'0px 0px -10% 0px', threshold:.15 });
  function watch(el){ if(seen.has(el)) return; seen.add(el); el.classList.add('mx-t'); io.observe(el); }

  function splitWords(el){
    el.innerHTML = el.textContent.trim().split(/\s+/)
      .map((w, i) => '<span class="mx-w"><span style="--wi:' + i + '">' + esc(w) + '</span></span>').join(' ');
  }

  /* ---------------- Cifras que cuentan (0 intermediarios cuenta hacia abajo) ---------------- */
  function prepCount(box){
    $$('b', box).forEach(b => {
      const m = b.textContent.trim().match(/^(\d+)(.*)$/); if(!m) return;
      const to = +m[1];
      b.dataset.mxTo = to; b.dataset.mxSuf = m[2]; b.dataset.mxFrom = to === 0 ? 12 : 0;
      b.textContent = b.dataset.mxFrom + m[2];
    });
  }
  function countAll(box){
    $$('b[data-mx-to]', box).forEach((b, i) => {
      const from = +b.dataset.mxFrom, to = +b.dataset.mxTo, suf = b.dataset.mxSuf, dur = 1600 + i * 150;
      setTimeout(() => { b.textContent = to + suf; }, dur + 250);  // el valor final llega aunque no haya cuadros
      let t0 = null;
      function step(t){
        if(t0 === null) t0 = t;
        const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 4);
        b.textContent = Math.round(from + (to - from) * e) + suf;
        if(k < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }

  /* ---------------- Hero: entra cuando se va la intro del globo ---------------- */
  let hero = null, heroSplit = false, introGone = false, heroStarted = false;
  function watchIntro(){
    const gi = document.getElementById('globeIntro');
    if(!gi){ introGone = true; return; }
    const mo = new MutationObserver(() => {
      if(document.body.contains(gi) && !gi.classList.contains('out')) return;
      introGone = true; mo.disconnect(); tryHero();
    });
    mo.observe(gi, { attributes:true, attributeFilter:['class'] });
    mo.observe(document.body, { childList:true });
  }
  // dos cuadros: el estado inicial se pinta antes de arrancar la transición.
  // Con la pestaña en segundo plano no hay cuadros: el temporizador asegura que igual se muestre.
  function afterPaint(fn){
    let done = false;
    const go = () => { if(!done){ done = true; fn(); } };
    requestAnimationFrame(() => requestAnimationFrame(go));
    setTimeout(go, 150);
  }
  function tryHero(){
    if(heroStarted || !heroSplit || !introGone || !hero) return;
    heroStarted = true;
    afterPaint(() => {
      hero.classList.add('mx-in');
      setTimeout(() => hero.classList.add('mx-settled'), 2400);
    });
  }

  /* ---------------- Preparar lo que app.js pinta (y repinta al cambiar idioma) ---------------- */
  const STAGGER = [['.trust', '.trust-item'], ['.chips', '.chip'], ['.reel', ':scope > a'], ['.pkg-grid', ':scope > .reveal'], ['#toursGrid', ':scope > .reveal']];
  function enhance(){
    hero = hero || $('.hero');
    const ht = $('[data-hero="title"]');
    if(ht && ht.textContent.trim() && !ht.querySelector('.mx-w')){ splitWords(ht); heroSplit = true; tryHero(); }
    $$('.section h2, .section-sm h2').forEach(h => { if(!h.firstElementChild && h.textContent.trim()){ splitWords(h); watch(h); } });
    $$('.eyebrow').forEach(e => { if(!e.closest('.hero')) watch(e); });
    $$('.split-media').forEach(watch);
    STAGGER.forEach(([box, item]) => $$(box).forEach(b => {
      $$(item, b).forEach((c, i) => c.style.setProperty('--i', Math.min(i, 10)));
      watch(b);
    }));
    $$('.stats').forEach(s => { if(!seen.has(s)){ prepCount(s); watch(s); } });
    const cta = $('section.teal.center[style*="background-image"]');
    if(cta && !cta.classList.contains('mx-cta')){
      const bg = document.createElement('div');
      bg.className = 'mx-cta-bg'; bg.style.backgroundImage = cta.style.backgroundImage;
      cta.prepend(bg); cta.classList.add('mx-cta');
    }
    medias = $$('.split-media.mx-t'); ctaBg = $('.mx-cta-bg');
    heroInner = $('.hero-inner'); heroSlides = $('.hero-slides');
  }

  /* ---------------- Lo que sigue al scroll ---------------- */
  let bar = null, medias = [], ctaBg = null, heroInner = null, heroSlides = null, ticking = false;
  function centre(r, vh){ return (r.top + r.height / 2 - vh / 2) / (vh / 2 + r.height / 2); }  // -1 abajo … 1 arriba
  function frame(){
    ticking = false;
    const y = window.scrollY, vh = window.innerHeight, max = document.documentElement.scrollHeight - vh;
    bar.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, y / max) : 0).toFixed(4) + ')';
    if(hero && heroInner && heroSlides){
      const p = Math.min(1, y / hero.offsetHeight);
      heroInner.style.translate = '0 ' + (p * hero.offsetHeight * .32).toFixed(1) + 'px';
      heroInner.style.opacity = Math.max(0, 1 - p * 1.25).toFixed(3);
      heroSlides.style.scale = (1 + p * .12).toFixed(4);
    }
    medias.forEach(m => {
      const r = m.getBoundingClientRect(); if(r.bottom < 0 || r.top > vh) return;
      m.style.setProperty('--mx-py', (centre(r, vh) * r.height * -.035).toFixed(1) + 'px');
    });
    if(ctaBg){
      const r = ctaBg.parentNode.getBoundingClientRect();
      if(r.bottom > 0 && r.top < vh) ctaBg.style.transform = 'translate3d(0,' + (centre(r, vh) * r.height * .14).toFixed(1) + 'px,0)';
    }
  }
  function onScroll(){ if(!ticking){ ticking = true; requestAnimationFrame(frame); } }

  /* ---------------- Botones que se acercan al cursor (solo ratón) ---------------- */
  function magnetic(){
    if(!matchMedia('(hover:hover) and (pointer:fine)').matches) return;
    let cur = null;
    const release = b => { b.style.setProperty('--mx-bx', '0px'); b.style.setProperty('--mx-by', '0px'); };
    document.addEventListener('pointermove', e => {
      const b = e.target.closest ? e.target.closest('.btn:not(.btn-block)') : null;
      if(cur && cur !== b){ release(cur); cur = null; }
      if(!b) return;
      cur = b;
      const r = b.getBoundingClientRect();
      b.style.setProperty('--mx-bx', ((e.clientX - r.left - r.width / 2) / (r.width / 2) * 6).toFixed(1) + 'px');
      b.style.setProperty('--mx-by', ((e.clientY - r.top - r.height / 2) / (r.height / 2) * 4).toFixed(1) + 'px');
    }, { passive:true });
    document.documentElement.addEventListener('pointerleave', () => { if(cur){ release(cur); cur = null; } });
  }

  ready(function(){
    bar = document.createElement('div'); bar.className = 'mx-progress'; document.body.appendChild(bar);
    watchIntro();
    enhance();
    // app.js pinta y repinta (idioma, precios en vivo): se prepara de nuevo lo nuevo
    let pending = false;
    new MutationObserver(muts => {
      if(pending || muts.every(m => m.target.closest && m.target.closest('.stats'))) return;
      pending = true;
      setTimeout(() => { pending = false; enhance(); onScroll(); }, 0);
    }).observe(document.body, { childList:true, subtree:true });
    magnetic();
    window.addEventListener('scroll', onScroll, { passive:true });
    window.addEventListener('resize', onScroll);
    onScroll();
    // red de seguridad: nada queda oculto si el observador no llegó a dispararse
    setTimeout(() => {
      $$('.mx-t:not(.mx-in), h2:not(.mx-in)').forEach(el => {
        if(el.getBoundingClientRect().top < window.innerHeight) el.classList.add('mx-in');
      });
      if(introGone && hero && !hero.classList.contains('mx-in')) hero.classList.add('mx-in', 'mx-settled');
    }, 3000);
  });
})();
