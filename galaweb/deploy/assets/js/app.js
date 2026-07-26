/* =========================================================
   GALÁPAGOS HOOK ADVENTURE — app core
   store · i18n · header/footer · hero · render · forms · map
   ========================================================= */
(function(){
"use strict";

/* ---------------- ICONS ---------------- */
const ICONS = {
  clock:'<path d="M12 7v5l3 2" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" fill="none"/>',
  tag:'<path d="M3 11l8-8 10 10-8 8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="8" cy="8" r="1.6" fill="currentColor"/>',
  check:'<path d="M4 12l5 5L20 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  info:'<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 11v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="7.6" r="1.2" fill="currentColor"/>',
  arrow:'<path d="M2 6h14M11 1l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  user:'<circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  hook:'<path d="M16 3v8a5 5 0 11-10 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="16" cy="3" r="1.6" fill="currentColor"/>',
  shield:'<path d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  boat:'<path d="M4 14h16l-2 5H6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 14V4l6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  pin:'<path d="M12 22s7-7 7-12a7 7 0 10-14 0c0 5 7 12 7 12z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="10" r="2.5" fill="currentColor"/>',
  family:'<circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17" cy="9" r="2.4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M2 20c0-3.3 2.7-5 6-5s6 1.7 6 5M14 20c.3-2.4 1.8-3.6 4-3.6S21.7 17.6 22 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  experience:'<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.6 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  commitment:'<path d="M12 21c-5-3-8-6.5-8-11a4.5 4.5 0 018-2.8A4.5 4.5 0 0120 10c0 4.5-3 8-8 11z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  community:'<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" fill="none" stroke="currentColor" stroke-width="2"/>',
  fish:'<path d="M3 12c4-6 11-6 15 0-4 6-11 6-15 0z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M18 12c1.5-1 3-1.5 3-1.5s-.5 3-1.5 4M18 12c1.5 1 3 1.5 3 1.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="8" cy="11" r="1" fill="currentColor"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 9h18M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  gear:'<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  star:'<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.6 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z" fill="currentColor"/>',
  phone:'<path d="M5 4h4l2 5-3 2a12 12 0 005 5l2-3 5 2v4a2 2 0 01-2 2A17 17 0 013 6a2 2 0 012-2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  mail:'<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 7l9 6 9-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  wa:'<path d="M12 2a10 10 0 00-8.5 15.2L2 22l4.9-1.3A10 10 0 1012 2zm0 18a8 8 0 01-4.1-1.1l-.3-.2-2.9.8.8-2.8-.2-.3A8 8 0 1112 20zm4.4-6c-.2-.1-1.4-.7-1.6-.8s-.4-.1-.5.1-.6.8-.8 1-.3.2-.5.1a6.5 6.5 0 01-1.9-1.2 7.2 7.2 0 01-1.3-1.7c-.1-.2 0-.4.1-.5l.4-.4.2-.4v-.4l-.8-1.8c-.2-.5-.4-.4-.5-.4h-.5a1 1 0 00-.7.3A2.8 2.8 0 006 8.9a4.9 4.9 0 001 2.6 11.2 11.2 0 004.3 3.8c2 .8 2 .5 2.4.5a2.5 2.5 0 001.6-1.2 2 2 0 00.1-1.2c0-.1-.2-.2-.4-.3z" fill="currentColor"/>',
  insta:'<rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.5" cy="6.5" r="1.3" fill="currentColor"/>',
  tiktok:'<path d="M15 3c.3 2.5 1.8 4 4.5 4.2v3C18 10 16.5 9.5 15 8.6V15a5.5 5.5 0 11-5.5-5.5c.3 0 .7 0 1 .1v3.1a2.5 2.5 0 101.8 2.4V3z" fill="currentColor"/>',
  fb:'<path d="M14 8h2V5h-2c-2 0-3 1.3-3 3.2V10H9v3h2v8h3v-8h2.2l.4-3H14V8.5c0-.3.2-.5.6-.5z" fill="currentColor"/>',
  menu:'<path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
};
function svg(name, cls){ return '<svg viewBox="0 0 24 24"'+(cls?' class="'+cls+'"':'')+' aria-hidden="true">'+ (ICONS[name]||'') +'</svg>'; }

/* ---------------- STORE ---------------- */
const CKEY='GHA_CONTENT', LKEY='GHA_LANG';
function deepMerge(base, over){
  if(Array.isArray(base)){ return Array.isArray(over)? over : base; }
  if(base && typeof base==='object'){
    const out={...base};
    if(over && typeof over==='object'){ for(const k in over){ out[k]= (k in base)? deepMerge(base[k], over[k]) : over[k]; } }
    return out;
  }
  return (over!==undefined)? over : base;
}
function loadContent(){
  let stored=null;
  try{ stored=JSON.parse(localStorage.getItem(CKEY)||'null'); }catch(e){}
  return stored ? deepMerge(window.GHA_DEFAULT, stored) : window.GHA_DEFAULT;
}
let S = loadContent();
let L = localStorage.getItem(LKEY) || 'en';
window.GHA = { get content(){return S;}, reload(){ S=loadContent(); render(); }, get lang(){return L;}, svg };

function t(v){ if(v==null) return ''; if(typeof v==='object') return v[L]!=null? v[L] : (v.en!=null? v.en : ''); return v; }
function money(n){ return '$'+Number(n).toLocaleString('en-US'); }

/* ---------------- WHATSAPP ---------------- */
function waLink(msg){
  const num=(S.meta.whatsapp||'').replace(/\D/g,'');
  return 'https://wa.me/'+num+(msg?('?text='+encodeURIComponent(msg)):'');
}

/* ---------------- HEADER / FOOTER ---------------- */
const NAV=[
  {p:'index',     href:'index.html',         en:'Home',         es:'Inicio'},
  {p:'packages',  href:'packages.html',      en:'Packages',     es:'Paquetes'},
  {p:'tours',     href:'tours.html',         en:'Tours',        es:'Tours'},
  {p:'fishing',   href:'sport-fishing.html', en:'Sport Fishing',es:'Pesca'},
  {p:'about',     href:'about.html',         en:'About',        es:'Nosotros'},
  {p:'conservation',href:'conservation.html',en:'Conservation', es:'Conservación'},
  {p:'contact',   href:'contact.html',       en:'Contact',      es:'Contacto'},
];
function logoSrc(){ return (window.__resources && window.__resources['assets/img/logo.png']) || 'assets/img/logo.png'; }
function buildHeader(){
  const el=document.getElementById('site-header'); if(!el) return;
  const active=document.body.dataset.page;
  el.innerHTML=
  '<div class="wrap-wide">'
   +'<a class="brand" href="index.html">'
     +'<img src="'+logoSrc()+'" alt="Galápagos Hook Adventure">'
     +'<span class="brand-text"><b>Galápagos Hook</b><span>Adventure</span></span>'
   +'</a>'
   +'<nav class="nav" id="nav">'
     + NAV.map(n=>'<a href="'+n.href+'" data-en="'+n.en+'" data-es="'+n.es+'" class="'+(n.p===active?'active':'')+'">'+(L==='es'?n.es:n.en)+'</a>').join('')
     +'<div class="mobile-lang lang-toggle" style="margin-top:18px">'
        +'<button data-lang="en" class="'+(L==='en'?'on':'')+'">EN</button>'
        +'<button data-lang="es" class="'+(L==='es'?'on':'')+'">ES</button>'
     +'</div>'
   +'</nav>'
   +'<div class="header-tools">'
     +'<a class="hdr-social" href="https://instagram.com/'+S.meta.instagram+'" target="_blank" rel="noopener" aria-label="Instagram">'+svg('insta')+'</a>'
     +'<a class="hdr-social" href="https://tiktok.com/@'+S.meta.tiktok+'" target="_blank" rel="noopener" aria-label="TikTok">'+svg('tiktok')+'</a>'
     +'<div class="lang-toggle">'
        +'<button data-lang="en" class="'+(L==='en'?'on':'')+'">EN</button>'
        +'<button data-lang="es" class="'+(L==='es'?'on':'')+'">ES</button>'
     +'</div>'
     +'<button type="button" class="btn btn-gold btn-sm js-book" data-name="" data-price="0" data-unit="person" data-en="Book Now" data-es="Reservar">'+(L==='es'?'Reservar':'Book Now')+'</button>'
     +'<button class="nav-toggle" id="navToggle" aria-label="Menu"><span></span><span></span><span></span></button>'
   +'</div>'
  +'</div>';

  el.querySelectorAll('[data-lang]').forEach(b=>b.addEventListener('click',()=>setLang(b.dataset.lang)));
  const nav=el.querySelector('#nav'), tog=el.querySelector('#navToggle');
  tog.addEventListener('click',()=>nav.classList.toggle('open'));
  nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>nav.classList.remove('open')));
}
function buildFooter(){
  const el=document.getElementById('site-footer'); if(!el) return;
  const m=S.meta;
  el.innerHTML=
  '<div class="wrap">'
   +'<div class="footer-top">'
     +'<div class="footer-brand">'
       +'<img src="'+logoSrc()+'" alt="Galápagos Hook Adventure">'
       +'<p data-en="Local operators in San Cristóbal, Galápagos. Ocean tours, sport fishing and authentic island experiences." data-es="Operadores locales en San Cristóbal, Galápagos. Tours oceánicos, pesca deportiva y experiencias isleñas auténticas."></p>'
       +'<p class="h-script" style="font-size:26px;margin-top:14px">'+t(m.slogan)+'</p>'
     +'</div>'
     +'<div class="footer-col"><h4 data-en="Explore" data-es="Explorar"></h4><ul>'
       + NAV.slice(1).map(n=>'<li><a href="'+n.href+'" data-en="'+n.en+'" data-es="'+n.es+'">'+(L==='es'?n.es:n.en)+'</a></li>').join('')
     +'</ul></div>'
     +'<div class="footer-col"><h4 data-en="Company" data-es="Empresa"></h4><ul>'
       +'<li><a href="about.html" data-en="Our Story" data-es="Nuestra Historia"></a></li>'
       +'<li><a href="conservation.html" data-en="Conservation" data-es="Conservación"></a></li>'
       +'<li><a href="contact.html" data-en="Contact" data-es="Contacto"></a></li>'
       +'<li><a href="admin.html" data-en="Admin" data-es="Admin"></a></li>'
     +'</ul></div>'
     +'<div class="footer-col"><h4 data-en="Get in touch" data-es="Contáctanos"></h4><ul class="footer-contact">'
       +'<li>'+svg('pin')+'<span><b style="display:block;font-weight:700;color:var(--gold-soft);font-family:var(--body);font-size:11px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:2px">Galápagos HQ</b>'+t(m.address)+'</span></li>'
       +'<li>'+svg('pin')+'<span><b style="display:block;font-weight:700;color:var(--gold-soft);font-family:var(--body);font-size:11px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:2px">USA Office</b>'+t(m.addressUs)+'</span></li>'
       +'<li>'+svg('phone')+'<span>'+m.phone+'</span></li>'
       +'<li>'+svg('mail')+'<span>'+m.email+'</span></li>'
       +'<li>'+svg('clock')+'<span>'+t(m.hours)+'</span></li>'
     +'</ul></div>'
   +'</div>'
   +'<div class="footer-bottom">'
     +'<span>© '+new Date().getFullYear()+' Galápagos Hook Adventure. '+(L==='es'?'Todos los derechos reservados.':'All rights reserved.')+'</span>'
     +'<div class="footer-legal">'
       +'<a href="security-policy.html" data-en="Security Policy" data-es="Política de Seguridad">Security Policy</a>'
       +'<a href="terms.html" data-en="Terms &amp; Conditions" data-es="Términos y Condiciones">Terms &amp; Conditions</a>'
       +'<a href="legal.html" data-en="Legal" data-es="Legal">Legal</a>'
     +'</div>'
     +'<div class="socials">'
       +'<a href="https://instagram.com/'+m.instagram+'" target="_blank" rel="noopener" aria-label="Instagram">'+svg('insta')+'</a>'
       +'<a href="https://tiktok.com/@'+m.tiktok+'" target="_blank" rel="noopener" aria-label="TikTok">'+svg('tiktok')+'</a>'
       +'<a href="'+waLink('')+'" target="_blank" rel="noopener" aria-label="WhatsApp">'+svg('wa')+'</a>'
     +'</div>'
   +'</div>'
   +'<div class="footer-credits"><div class="credit-badge"><img src="assets/img/loan-ix-logo.png" alt="Loan-IX Softworks"></div><span data-en="Powered &amp; Owned by Loan-IX" data-es="Desarrollado y propiedad de Loan-IX">Powered &amp; Owned by Loan-IX</span></div>'
  +'</div>';
}
function buildWhatsAppFloat(){
  if(document.querySelector('.wa-float')) return;
  const a=document.createElement('a');
  a.className='wa-float'; a.target='_blank'; a.rel='noopener'; a.setAttribute('aria-label','WhatsApp');
  a.href=waLink(L==='es'?'¡Hola Galápagos Hook! Me gustaría más información.':'Hi Galápagos Hook! I would love more information.');
  a.innerHTML=svg('wa');
  document.body.appendChild(a);
}

/* ---------------- HEADER SCROLL ---------------- */
function initHeaderScroll(){
  const h=document.getElementById('site-header'); if(!h) return;
  const hasHero=!!document.querySelector('.hero,.pagehero');
  const on=()=>{ h.classList.toggle('scrolled', window.scrollY>40 || !hasHero); };
  on(); window.addEventListener('scroll',on,{passive:true});
}

/* ---------------- HERO SLIDESHOW ---------------- */
let heroTimer;
function renderHero(){
  const box=document.getElementById('heroSlides'); if(!box) return;
  box.innerHTML=S.hero.slides.map((src,k)=>'<div class="hero-slide'+(k===0?' on':'')+'" style="background-image:url('+src+')"></div>').join('');
  const slides=[...box.children]; const dotsWrap=document.getElementById('heroDots');
  let i=0;
  if(dotsWrap){ dotsWrap.innerHTML=slides.map((_,k)=>'<button aria-label="slide '+(k+1)+'"></button>').join(''); }
  const dots=dotsWrap?[...dotsWrap.children]:[];
  function show(n){ slides.forEach((s,k)=>s.classList.toggle('on',k===n)); dots.forEach((d,k)=>d.classList.toggle('on',k===n)); i=n; }
  dots.forEach((d,k)=>d.addEventListener('click',()=>{show(k);reset();}));
  show(0);
  function reset(){ clearInterval(heroTimer); heroTimer=setInterval(()=>show((i+1)%slides.length),5200); }
  if(slides.length>1) reset();
}

/* ---------------- GENERIC SLIDESHOW (fishing reel etc) ---------------- */
function initReels(){
  document.querySelectorAll('[data-reel]').forEach(box=>{
    const slides=[...box.children]; if(slides.length<2){ if(slides[0])slides[0].classList.add('on'); return; }
    let i=0; slides.forEach((s,k)=>s.classList.toggle('on',k===0));
    setInterval(()=>{ slides[i].classList.remove('on'); i=(i+1)%slides.length; slides[i].classList.add('on'); }, 4200);
  });
}

/* ---------------- TRIP CARD CAROUSELS (sport fishing) ---------------- */
let tripCarTimers=[];
function initTripCarousels(){
  tripCarTimers.forEach(clearInterval); tripCarTimers=[];
  document.querySelectorAll('[data-trip-car]').forEach((box,idx)=>{
    const slides=[...box.querySelectorAll('.trip-car-slide')];
    const dots=[...box.querySelectorAll('.trip-car-dots span')];
    if(slides.length<2) return;
    let i=0;
    const go=n=>{ slides.forEach((s,k)=>s.classList.toggle('on',k===n)); dots.forEach((d,k)=>d.classList.toggle('on',k===n)); i=n; };
    dots.forEach((d,k)=>d.addEventListener('click',()=>go(k)));
    // stagger start so the three cards aren't in lockstep
    setTimeout(()=>{ tripCarTimers.push(setInterval(()=>go((i+1)%slides.length), 3600)); }, idx*1200);
  });
}

/* ---------------- REVEAL ---------------- */
let io;
function initReveal(){
  if(!('IntersectionObserver' in window)){ document.querySelectorAll('.reveal').forEach(e=>e.classList.add('in')); return; }
  io=new IntersectionObserver((ents)=>{ ents.forEach(e=>{ if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target);} }); },{threshold:.12,rootMargin:'0px 0px -8% 0px'});
  observeReveals();
  // failsafe: never leave content permanently hidden
  setTimeout(()=>document.querySelectorAll('.reveal:not(.in)').forEach(e=>{ var r=e.getBoundingClientRect(); if(r.top < window.innerHeight*1.1) e.classList.add('in'); }),2600);
}
function observeReveals(){ if(io) document.querySelectorAll('.reveal:not(.in)').forEach(e=>io.observe(e)); }

/* ====================================================
   RENDERERS
   ==================================================== */
function renderTrust(){
  const el=document.getElementById('trustStrip'); if(!el) return;
  const ic=['user','check','shield','boat','pin'];
  el.innerHTML='<div class="wrap">'+S.trust.map((x,k)=>'<div class="trust-item">'+svg(ic[k]||'pin')+'<b>'+t(x)+'</b></div>').join('')+'</div>';
}

function detailBtn(type, id, cls, label){
  return '<button type="button" class="'+cls+' js-detail" data-type="'+type+'" data-id="'+esc(id)+'">'+label+'</button>';
}
function tourCard(tr){
  const quote = !tr.price;
  const hasDetail = !!(window.GHA_DETAILS && GHA_DETAILS.tours && GHA_DETAILS.tours[tr.id]);
  return '<article class="tcard reveal" data-cat="'+tr.cat+'">'
    +'<div class="tcard-media'+(hasDetail?' js-detail':'')+'"'+(hasDetail?' data-type="tour" data-id="'+esc(tr.id)+'"':'')+'><img src="'+tr.img+'" alt="'+t(tr.name)+'" loading="lazy"><span class="tcard-tag">'+t(tr.tag)+'</span></div>'
    +'<div class="tcard-body">'
      +'<h3>'+t(tr.name)+'</h3>'
      +'<div class="tcard-meta"><span>'+svg('clock')+t(tr.duration)+'</span></div>'
      +'<p>'+t(tr.blurb)+'</p>'
      +'<div class="tcard-foot">'
        +'<div class="price'+(quote?' quote':'')+'">'+(quote
            ? '<small>'+ (L==='es'?'Precio':'Price') +'</small><b>'+t(tr.priceLabel)+'</b>'
            : '<small>'+ (L==='es'?'Desde':'From') +'</small><b>'+money(tr.price)+' <em>'+t(tr.priceLabel)+'</em></b>')+'</div>'
        +'<div class="tcard-btns">'
          +(hasDetail?detailBtn('tour', tr.id, 'btn btn-ghost btn-sm', (L==='es'?'Ver más':'More info')):'')
          +bookBtn(t(tr.name), tr.price, 'person', 'btn '+(quote?'btn-ink':'btn-ink')+' btn-sm', quote?(L==='es'?'Cotizar':'Get Quote'):(L==='es'?'Reservar':'Book'), 1, tr.id)
        +'</div>'
      +'</div>'
    +'</div>'
  +'</article>';
}
function bookMsg(name){ return (L==='es'?'¡Hola! Me interesa el tour "':'Hi! I\'m interested in the "')+name+(L==='es'?'". ¿Me dan más información?':'" tour. Could you tell me more?'); }

/* ====================================================
   BOOKING / CHECKOUT  (choose dates + pay by card)
   ==================================================== */
function esc(s){ return String(s==null?'':s).replace(/"/g,'&quot;'); }
function bookBtn(name, price, unit, cls, label, min, tourId){
  return '<button type="button" class="'+cls+' js-book" data-name="'+esc(name)+'" data-price="'+(price||0)+'" data-unit="'+unit+'" data-min="'+(min||1)+'" data-tour-id="'+esc(tourId||'')+'">'+label+'</button>';
}
function bookables(){
  const PK=L==='es'?'Paquetes':'Packages', TO=L==='es'?'Tours':'Tours', FI=L==='es'?'Pesca deportiva':'Sport fishing';
  const out=[];
  S.packages.forEach(p=>{ if(p.price) out.push({tourId:p.id, label:t(p.name)+' · '+t(p.days), price:p.price, unit:'person', min:(p.minGuests||2), requiresQuote:false, group:PK}); });
  S.tours.forEach(tr=>{ if(tr.price) out.push({tourId:tr.id, label:t(tr.name), price:tr.price, unit:'person', min:1, requiresQuote:false, group:TO}); });
  S.fishing.trips.forEach(tr=>{ if(tr.price) out.push({tourId:tr.id, label:t(tr.name), price:tr.price, unit:'boat', min:1, requiresQuote:false, group:FI}); });
  return out;
}
let bkState={tourId:'',name:'',price:0,unit:'person',min:1,requiresQuote:false};
/* ---- idempotencia del formulario (Fase 3) ---- */
let bkRequestId=null, bkFingerprint=null, bkSubmitting=false;
function bkUuid(){
  try{ if(window.crypto && crypto.randomUUID) return crypto.randomUUID(); }catch(e){}
  const b=new Uint8Array(16);
  try{ crypto.getRandomValues(b); }catch(e){ for(let i=0;i<16;i++) b[i]=Math.floor(Math.random()*256); }
  b[6]=(b[6]&0x0f)|0x40; b[8]=(b[8]&0x3f)|0x80;
  const h=[]; for(let i=0;i<16;i++) h.push(b[i].toString(16).padStart(2,'0'));
  return h[0]+h[1]+h[2]+h[3]+'-'+h[4]+h[5]+'-'+h[6]+h[7]+'-'+h[8]+h[9]+'-'+h[10]+h[11]+h[12]+h[13]+h[14]+h[15];
}
function bkNormEmail(e){ return String(e||'').trim().toLowerCase(); }
function bkComputeFingerprint(){
  const dt=(document.getElementById('bkDate')||{}).value||'';
  const guests=Math.max(bkState.min||1, parseInt(((document.getElementById('bkGuests')||{}).value||'1'),10));
  const email=bkNormEmail((document.getElementById('bkTravEmail')||{}).value);
  return [bkState.tourId||'', dt, guests, email].join('|');
}
/* Reutiliza el request_id salvo que cambien tour/fecha/guests/email → entonces genera uno nuevo */
function bkEnsureRequestId(){
  const fp=bkComputeFingerprint();
  if(!bkRequestId || fp!==bkFingerprint){ bkRequestId=bkUuid(); bkFingerprint=fp; }
  return bkRequestId;
}
function bkResetRequestId(){ bkRequestId=null; bkFingerprint=null; }
function fmtDate(s){ if(!s) return '—'; const d=new Date(s+'T00:00'); return d.toLocaleDateString(L==='es'?'es-ES':'en-US',{weekday:'short',day:'numeric',month:'short',year:'numeric'}); }
function money2(n){ return '$'+Number(n).toLocaleString('en-US'); }

function buildBookingModal(){
  if(document.getElementById('bkDrop')) return;
  const d=document.createElement('div'); d.className='bkdrop'; d.id='bkDrop';
  d.innerHTML=
   '<div class="bkmodal" role="dialog" aria-modal="true" aria-label="Booking">'
   +'<button class="bk-close" id="bkClose" aria-label="Close">&times;</button>'
   +'<div class="bk-grid" id="bkGrid">'
     +'<aside class="bk-summary">'
       +'<p class="eyebrow" id="bkEyebrow">Your booking</p>'
       +'<h3 id="bkSumName">—</h3>'
       +'<div class="bk-line"><span id="bkL1">Travel date</span><b id="bkSumDate">—</b></div>'
       +'<div class="bk-line" id="bkSumGuestsRow"><span id="bkL2">Guests</span><b id="bkSumGuests">—</b></div>'
       +'<div class="bk-line"><span id="bkL3">Price</span><b id="bkSumPrice">—</b></div>'
       +'<div class="bk-line bk-promo" id="bkPromoRow" style="display:none"><span id="bkPromoLab">Group promo −20%</span><b id="bkSumPromo">—</b></div>'
       +'<div class="bk-total"><span id="bkL4">Total</span><b id="bkSumTotal">—</b></div>'
       +'<ul class="bk-trust">'
         +'<li>'+svg('shield')+'<span id="bkT1">Secure checkout</span></li>'
         +'<li>'+svg('check')+'<span id="bkT2">Free cancellation up to 30 days before</span></li>'
         +'<li>'+svg('user')+'<span id="bkT3">Hosted by a local family</span></li>'
       +'</ul>'
     +'</aside>'
     +'<form class="bk-form" id="bkForm" novalidate>'
       +'<div class="field" id="bkSelectWrap" style="display:none"><label id="bkLabExp">Experience</label><select id="bkSelect"></select></div>'
       +'<div class="form-row">'
         +'<div class="field"><label id="bkLabName">Full name</label><input id="bkTravName" required></div>'
         +'<div class="field"><label id="bkLabEmail">Email</label><input type="email" id="bkTravEmail" required></div>'
       +'</div>'
       +'<div class="form-row">'
         +'<div class="field"><label id="bkLabDate">Travel date</label><input type="date" id="bkDate" required></div>'
         +'<div class="field" id="bkGuestsWrap"><label id="bkLabGuests">Guests</label><input type="number" id="bkGuests" min="1" max="20" value="2"></div>'
       +'</div>'
       +'<div class="bk-pay" id="bkPay">'
         +'<h4 id="bkPayTitle">'+svg('shield')+'Payment</h4>'
         +'<div class="bk-cards"><span>VISA</span><span>Mastercard</span><span>Amex</span></div>'
         +'<div class="field"><label id="bkLabCardName">Cardholder name</label><input id="bkCardName" autocomplete="cc-name"></div>'
         // Stripe Elements individuales (mismos huecos/estilo que los inputs). Los datos de tarjeta viven solo en los iframes de Stripe.
         +'<div class="field"><label id="bkLabCardNum">Card number</label><div id="bkCardNumber" class="stripe-field"></div></div>'
         +'<div class="form-row">'
           +'<div class="field"><label id="bkLabExp2">Expiry</label><div id="bkCardExpiry" class="stripe-field"></div></div>'
           +'<div class="field"><label>CVC</label><div id="bkCardCvc" class="stripe-field"></div></div>'
         +'</div>'
         +'<div class="field"><label id="bkLabZip">Billing ZIP / Postal code</label><input id="bkZip" autocomplete="postal-code"></div>'
       +'</div>'
       +'<div class="field" id="bkMsgWrap" style="display:none"><label id="bkLabMsg">Your message</label><textarea id="bkMsg"></textarea></div>'
       +'<button type="submit" class="btn btn-gold btn-block" id="bkPayBtn" style="margin-top:6px">Pay</button>'
       +'<p class="bk-secure" id="bkSecure"></p>'
     +'</form>'
   +'</div>'
   +'<div class="bk-success" id="bkSuccess">'
     +'<div class="tick">'+svg('check')+'</div>'
     +'<h3 id="bkSucTitle">Booking confirmed!</h3>'
     +'<p id="bkSucMsg" class="lead" style="margin:0 auto;max-width:44ch;color:var(--ink-soft)"></p>'
     +'<div class="bk-recap" id="bkRecap"></div>'
     +'<button class="btn btn-ink" id="bkDone">Done</button>'
   +'</div>'
   +'</div>';
  document.body.appendChild(d);

  d.addEventListener('click',e=>{ if(e.target===d) closeBooking(); });
  d.querySelector('#bkClose').addEventListener('click',closeBooking);
  d.querySelector('#bkDone').addEventListener('click',closeBooking);
  d.querySelector('#bkGuests').addEventListener('input',updateBkSummary);
  d.querySelector('#bkDate').addEventListener('change',updateBkSummary);
  // Los campos de tarjeta son Stripe Elements — formateo/validación los maneja Stripe (ver setupPaymentFields).
  d.querySelector('#bkForm').addEventListener('submit',e=>{ e.preventDefault(); submitBooking(); });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape' && d.classList.contains('open')) closeBooking(); });
}
function applyBookingLang(){
  const es=L==='es'; const set=(id,txt)=>{ const el=document.getElementById(id); if(el) el.textContent=txt; };
  set('bkEyebrow', es?'Tu reserva':'Your booking');
  set('bkL1', es?'Fecha de viaje':'Travel date'); set('bkL2', es?'Viajeros':'Guests'); set('bkL3', es?'Precio':'Price'); set('bkL4', es?'Total':'Total');
  set('bkT1', es?'Pago seguro':'Secure checkout'); set('bkT2', es?('Cancelación gratis hasta '+(S.meta.cancelDays||60)+' días antes'):('Free cancellation up to '+(S.meta.cancelDays||60)+' days before')); set('bkT3', es?'Atendido por una familia local':'Hosted by a local family');
  set('bkLabExp', es?'Experiencia':'Experience'); set('bkLabName', es?'Nombre completo':'Full name'); set('bkLabEmail', es?'Correo':'Email');
  set('bkLabDate', es?'Fecha de viaje':'Travel date'); set('bkLabGuests', es?'Viajeros':'Guests');
  if(S.pkgPromo&&S.pkgPromo.summary) set('bkPromoLab', t(S.pkgPromo.summary));
  set('bkLabCardName', es?'Nombre en la tarjeta':'Cardholder name'); set('bkLabCardNum', es?'Número de tarjeta':'Card number'); set('bkLabExp2', es?'Vencimiento':'Expiry'); set('bkLabZip', es?'Código postal de facturación':'Billing ZIP / Postal code');
  set('bkLabMsg', es?'Tu mensaje':'Your message');
  const pt=document.getElementById('bkPayTitle'); if(pt) pt.innerHTML=svg('shield')+(es?'Pago':'Payment');
  set('bkSecure', es?'🔒 Pago seguro · procesado por Stripe':'🔒 Secure checkout · powered by Stripe');
}
function updateBkSummary(){
  if(!document.getElementById('bkDrop')) return;
  const es=L==='es';
  const guests=Math.max(bkState.min||1, parseInt((document.getElementById('bkGuests').value||'1'),10));
  const request=!(bkState.price>0);
  const tot=bkTotal(guests);
  const total=tot.total;
  const gi=document.getElementById('bkGuests'); if(document.activeElement!==gi && parseInt(gi.value||'0',10)!==guests) gi.value=guests;
  document.getElementById('bkSumName').textContent=bkState.name||'—';
  document.getElementById('bkSumDate').textContent=fmtDate(document.getElementById('bkDate').value);
  document.getElementById('bkSumGuests').textContent=guests;
  document.getElementById('bkSumPrice').textContent= request?(es?'A cotizar':'Custom quote'):(money2(bkState.price)+(bkState.unit==='person'?(es?' /persona':' /person'):(es?' /bote':' /boat')));
  const promoRow=document.getElementById('bkPromoRow');
  if(promoRow){
    const show=!request&&tot.eligible;
    promoRow.style.display=show?'':'none';
    if(show) document.getElementById('bkSumPromo').textContent='−'+money2(tot.gross-tot.total);
  }
  document.getElementById('bkSumTotal').textContent= request?'—':money2(total);
  document.getElementById('bkPay').style.display=request?'none':'';
  document.getElementById('bkMsgWrap').style.display=request?'':'none';
  document.getElementById('bkSecure').style.display=request?'none':'';
  document.getElementById('bkSumGuestsRow').style.display=bkState.unit==='boat'?'none':'';
  const pb=document.getElementById('bkPayBtn'); pb.disabled=false; if(pb.dataset.idle) delete pb.dataset.idle;
  pb.textContent= request?(es?'Enviar solicitud':'Send request'):((es?'Pagar ':'Pay ')+money2(total));
}
/* Group promo: packages (person-unit, min ≥ 2) get 20% off the whole group when 3+ travelers book */
function bkTotal(guests){
  const gross=bkState.unit==='person'?bkState.price*guests:bkState.price;
  const eligible=bkState.unit==='person'&&(bkState.min||1)>=2&&guests>2;
  return { gross:gross, eligible:eligible, total: eligible?Math.round(gross*0.8):gross };
}
function openBooking(opts){
  buildBookingModal();
  const general=!opts.name;
  bkSubmitting=false; bkResetRequestId();
  if(window.GHAPayments) GHAPayments.unmount();   // re-montaje limpio en cada apertura (sin duplicados)
  bkState={tourId:opts.tourId||'', name:opts.name||'', price:+opts.price||0, unit:opts.unit||'person', min:+opts.min||1, requiresQuote:!(+opts.price>0)};
  document.getElementById('bkSuccess').classList.remove('show');
  document.getElementById('bkGrid').style.display='';
  const selWrap=document.getElementById('bkSelectWrap'), sel=document.getElementById('bkSelect');
  if(general){
    const items=bookables();
    let html='', lastG=null;
    items.forEach((it)=>{ if(it.group!==lastG){ if(lastG!==null)html+='</optgroup>'; html+='<optgroup label="'+it.group+'">'; lastG=it.group; } html+='<option value="'+esc(it.tourId)+'" data-tour-id="'+esc(it.tourId)+'" data-price="'+it.price+'" data-unit="'+it.unit+'" data-min="'+(it.min||1)+'">'+it.label+' — '+money2(it.price)+'</option>'; });
    if(lastG!==null)html+='</optgroup>';
    sel.innerHTML=html; selWrap.style.display='';
    const first=items[0];
    if(first) bkState={tourId:first.tourId, name:first.label, price:first.price, unit:first.unit, min:first.min||1, requiresQuote:false};
    sel.onchange=()=>{ const o=sel.selectedOptions[0]; bkState={tourId:o.dataset.tourId, name:o.textContent.split(' — ')[0], price:+o.dataset.price, unit:o.dataset.unit, min:+o.dataset.min||1, requiresQuote:!(+o.dataset.price>0)}; bkResetRequestId(); syncGuestsMin(); updateBkSummary(); setupPaymentFields(); };
  } else { selWrap.style.display='none'; }
  const dt=document.getElementById('bkDate'); dt.min=new Date().toISOString().slice(0,10); dt.value='';
  syncGuestsMin();
  document.getElementById('bkForm').reset(); dt.value=''; syncGuestsMin();
  applyBookingLang(); updateBkSummary(); setupPaymentFields();
  document.getElementById('bkDrop').classList.add('open');
  document.documentElement.style.overflow='hidden';
  setTimeout(()=>{ const f=document.getElementById('bkTravName'); f&&f.focus(); },200);
}
/* Monta los Stripe Elements solo para experiencias pagables; los desmonta en cotizaciones. */
function setupPaymentFields(){
  const P=window.GHAPayments; if(!P) return;
  if(bkState.requiresQuote){ P.unmount(); return; }
  if(P.ready()) return;
  P.mount({number:'bkCardNumber', expiry:'bkCardExpiry', cvc:'bkCardCvc'}).catch(function(){ /* sin exponer detalles */ });
}
function closeBooking(){ const d=document.getElementById('bkDrop'); if(d) d.classList.remove('open'); document.documentElement.style.overflow=''; bkSubmitting=false; if(window.GHAPayments) GHAPayments.unmount(); }
function syncGuestsMin(){
  const g=document.getElementById('bkGuests'); if(!g) return;
  const min=bkState.min||1; g.min=min;
  let v=parseInt(g.value||'0',10); if(!v||v<min) v=Math.max(min,2); g.value=v;
}
/* Save every booking/request locally (Admin → Messages reads this) + optional email via Formspree */
function recordBooking(data){
  try{ const arr=JSON.parse(localStorage.getItem('GHA_MESSAGES')||'[]'); arr.unshift(data); localStorage.setItem('GHA_MESSAGES', JSON.stringify(arr.slice(0,300))); }catch(e){}
  sendNotification(data);
}
function sendNotification(data){
  const ep=S.meta.formEndpoint; if(!ep) return; // paste a Formspree endpoint in Admin → Site to receive emails (no server needed)
  const body={ _subject:'New '+data.type+' — Galápagos Hook Adventure', _replyto:data.email, recipient:S.meta.notifyEmail,
    traveler:data.name, email:data.email, experience:data.experience, travel_date:data.date, guests:data.guests,
    total:data.total?('$'+data.total):'Custom quote', status:data.status, card_last4:data.card||'', message:data.message||'' };
  try{ fetch(ep,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body)}); }catch(e){}
}
/* ---- estado del botón PAY (procesando) ---- */
function setPayBusy(busy){
  const btn=document.getElementById('bkPayBtn'); if(!btn) return; const es=L==='es';
  if(busy){ if(!btn.dataset.idle) btn.dataset.idle=btn.textContent; btn.disabled=true;
    btn.textContent=bkState.requiresQuote?(es?'Enviando…':'Sending…'):(es?'Procesando el pago…':'Processing payment…'); }
  else{ btn.disabled=false; if(btn.dataset.idle){ btn.textContent=btn.dataset.idle; delete btn.dataset.idle; } }
}
function bkPost(url, payload){
  return fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(payload)})
    .then(function(res){ return res.json().catch(function(){return {};}).then(function(data){ return {ok:res.ok,status:res.status,data:data}; }); });
}
function bkErrorMessage(code, es){
  switch(code){
    case 'PAYMENT_ATTEMPT_CANCELED': return es?'Ese intento se canceló. Vuelve a intentarlo.':'That attempt was canceled. Please try again.';
    case 'PAYMENT_ATTEMPT_FAILED':   return es?'El intento anterior falló. Vuelve a intentarlo.':'The previous attempt failed. Please try again.';
    case 'REQUEST_ID_CONFLICT':      return es?'Los datos cambiaron. Vuelve a intentarlo.':'The details changed. Please try again.';
    case 'INVALID_EMAIL':            return es?'Revisa el correo.':'Please check the email.';
    case 'INVALID_DATE': case 'DATE_IN_PAST': return es?'Revisa la fecha del viaje.':'Please check the travel date.';
    case 'GUESTS_BELOW_MIN':         return es?'No alcanza el mínimo de viajeros.':'Below the minimum number of travelers.';
    case 'GUESTS_TOO_MANY':          return es?'Demasiados viajeros.':'Too many travelers.';
    case 'QUOTE_REQUIRED':           return es?'Esta experiencia es por cotización.':'This experience is quote-only.';
    case 'PAYMENT_REQUIRED':         return es?'Esta experiencia requiere pago.':'This experience requires payment.';
    case 'INTERNAL_ERROR': case 'CONFIG_UNAVAILABLE': return normalizeStripeError({type:'api_error'}, es);
    default:                         return es?'No se pudo completar. Intenta de nuevo.':'Could not complete. Please try again.';
  }
}
function handleBkError(r, es){
  const code=r.data && r.data.error;
  if(code==='PAYMENT_ATTEMPT_FAILED'||code==='PAYMENT_ATTEMPT_CANCELED'||code==='REQUEST_ID_CONFLICT') bkResetRequestId();
  GHA.toast(bkErrorMessage(code, es));
}
/* Normalización central de errores de Stripe → mensajes claros para el cliente.
   Nunca expone error.message, códigos internos, ids, claves ni detalles técnicos. */
function normalizeStripeError(err, es){
  const M={
    declined: es?'Tu tarjeta fue rechazada. Intenta con otra tarjeta.':'Your card was declined. Please try another card.',
    invalid:  es?'Revisa la información de tu tarjeta.':'Please review your card information.',
    funds:    es?'Tu tarjeta no tiene fondos suficientes. Intenta con otro método de pago.':'Your card has insufficient funds. Please try another payment method.',
    network:  es?'No pudimos conectarnos con el servicio de pago. Inténtalo nuevamente.':'We could not connect to the payment service. Please try again.',
    auth:     es?'No pudimos autenticar este pago. Inténtalo nuevamente.':'We could not authenticate this payment. Please try again.',
    config:   es?'El servicio de pago no está disponible temporalmente. Inténtalo nuevamente en unos momentos.':'The payment service is temporarily unavailable. Please try again shortly.',
    unknown:  es?'No pudimos procesar tu pago. Inténtalo nuevamente o utiliza otra tarjeta.':'We could not process your payment. Please try again or use another card.'
  };
  if(!err) return M.unknown;
  const type=err.type||'', code=err.code||'', decline=err.declineCode||err.decline_code||'';
  if(err.__network || type==='api_connection_error') return M.network;
  if(decline==='insufficient_funds') return M.funds;
  if(code==='card_declined') return M.declined;
  if(type==='validation_error' || /incomplete|invalid_number|invalid_expiry|invalid_cvc|incomplete_zip/.test(code)) return M.invalid;
  if(code==='payment_intent_authentication_failure' || /authentication/.test(code)) return M.auth;
  if(type==='api_error' || type==='invalid_request_error') return M.config;
  return M.unknown;
}
/* ---- pantallas de éxito (usan datos confirmados por el backend) ---- */
function bkShowSuccessShell(){ document.getElementById('bkGrid').style.display='none'; document.getElementById('bkSuccess').classList.add('show'); const m=document.querySelector('.bkmodal'); if(m) m.scrollTop=0; }
function bkRenderRecap(data, dt, guests, es, showAmount, amountLabel){
  const code=data&&data.bookingCode?data.bookingCode:''; const tourName=data&&data.tourName?data.tourName:bkState.name;
  let recap='<div><span>'+(es?'Código':'Code')+'</span><b>'+esc(code)+'</b></div>'
    +'<div><span>'+(es?'Experiencia':'Experience')+'</span><b>'+esc(tourName)+'</b></div>'
    +'<div><span>'+(es?'Fecha':'Date')+'</span><b>'+fmtDate(dt)+'</b></div>'
    +(bkState.unit==='person'?'<div><span>'+(es?'Viajeros':'Guests')+'</span><b>'+guests+'</b></div>':'');
  if(showAmount && data && typeof data.amountCents==='number') recap+='<div class="tot"><span>'+amountLabel+'</span><b>'+money2(Math.round(data.amountCents/100))+'</b></div>';
  document.getElementById('bkRecap').innerHTML=recap;
}
function showPaidSuccess(data, name, email, dt, guests, es){
  bkShowSuccessShell();
  document.getElementById('bkSucTitle').textContent= es?'¡Reserva confirmada!':'Booking confirmed!';
  document.getElementById('bkSucMsg').textContent= es?'Tu reserva está confirmada. Recibirás en breve un correo con tu código QR.':'Your booking is confirmed. A confirmation email with your QR code will arrive shortly.';
  bkRenderRecap(data, dt, guests, es, true, es?'Pagado':'Paid');
}
function showProcessing(data, name, email, dt, guests, es){
  bkShowSuccessShell();
  document.getElementById('bkSucTitle').textContent= es?'Pago en procesamiento':'Payment processing';
  document.getElementById('bkSucMsg').textContent= es?'Tu pago se está procesando. Guarda tu código de reserva; confirmaremos tu reserva en breve.':'Your payment is processing. Save your booking code — we\'ll confirm your booking shortly.';
  bkRenderRecap(data, dt, guests, es, true, es?'Importe':'Amount');
}
function showQuoteSuccess(data, name, email, dt, guests, es){
  bkShowSuccessShell();
  document.getElementById('bkSucTitle').textContent= es?'¡Solicitud recibida!':'Request received!';
  document.getElementById('bkSucMsg').textContent= es?'Recibimos tu solicitud. Recibirás un correo de confirmación en breve.':'We received your request. A confirmation email will arrive shortly.';
  bkRenderRecap(data, dt, guests, es, false, '');
}
async function submitBooking(){
  if(bkSubmitting) return;                       // evita doble clic / envíos concurrentes
  const es=L==='es';
  const name=document.getElementById('bkTravName').value.trim();
  const email=document.getElementById('bkTravEmail').value.trim();
  const dt=document.getElementById('bkDate').value;
  if(!name||!email||!dt){ GHA.toast(es?'Completa nombre, correo y fecha':'Please add name, email and date'); return; }
  const guests=Math.max(bkState.min||1, parseInt((document.getElementById('bkGuests').value||'1'),10));
  const notesEl=document.getElementById('bkMsg'); const notes=notesEl&&notesEl.value?notesEl.value.trim():'';

  // Solo tour_id / fecha / guests / datos de contacto van al backend. NUNCA amount/price/total ni datos de tarjeta.
  const payload={ request_id:bkEnsureRequestId(), tour_id:bkState.tourId, booking_date:dt, guests:guests, customer_name:name, customer_email:email };
  if(notes) payload.notes=notes;

  bkSubmitting=true; setPayBusy(true);

  /* ---------- COTIZACIÓN (private / expedition) ---------- */
  if(bkState.requiresQuote){
    try{
      const r=await bkPost('/api/quote-request', payload);
      if(!r.ok){ handleBkError(r, es); bkSubmitting=false; setPayBusy(false); return; }
      showQuoteSuccess(r.data, name, email, dt, guests, es); bkSubmitting=false;
    }catch(e){ GHA.toast(normalizeStripeError({__network:true}, es)); bkSubmitting=false; setPayBusy(false); }
    return;
  }

  /* ---------- PAGO (create-payment-intent + Stripe Elements) ---------- */
  if(!(window.GHAPayments && GHAPayments.ready())){
    GHA.toast(normalizeStripeError({type:'api_error'}, es)); bkSubmitting=false; setPayBusy(false); return;
  }
  try{
    const r=await bkPost('/api/create-payment-intent', payload);
    if(!r.ok){ handleBkError(r, es); bkSubmitting=false; setPayBusy(false); return; }
    const data=r.data;
    if(data.alreadyPaid){ showPaidSuccess(data, name, email, dt, guests, es); bkSubmitting=false; return; }  // ya pagado → no recobrar
    if(!data.clientSecret){ GHA.toast(es?'Respuesta inválida del servidor.':'Invalid server response.'); bkSubmitting=false; setPayBusy(false); return; }
    const billing={ name:(document.getElementById('bkCardName').value||name).trim(), email:email, address:{ postal_code:(document.getElementById('bkZip').value||'').trim()||undefined } };
    const result=await GHAPayments.confirmCardPayment(data.clientSecret, billing);
    if(result.error){ GHA.toast(normalizeStripeError(result.error, es)); bkSubmitting=false; setPayBusy(false); return; } // tarjeta rechazada → mismo request_id, PAY reactivado
    const pi=result.paymentIntent;
    if(pi && pi.status==='succeeded'){ showPaidSuccess(data, name, email, dt, guests, es); bkSubmitting=false; return; }
    if(pi && pi.status==='processing'){ showProcessing(data, name, email, dt, guests, es); bkSubmitting=false; return; }
    GHA.toast(es?'El pago no se completó.':'Payment was not completed.'); bkSubmitting=false; setPayBusy(false);
  }catch(e){ GHA.toast(es?'Error de conexión. Intenta de nuevo.':'Connection error. Please try again.'); bkSubmitting=false; setPayBusy(false); }
}

/* ====================================================
   DETAIL MODAL  ("View details" / "More info")
   ==================================================== */
const FACT_ICONS = { duration:'clock', length:'calendar', group:'family', level:'gear', start:'pin', base:'pin', style:'star' };
const FACT_LABELS = {
  duration:{en:'Duration',es:'Duración'}, length:{en:'Length',es:'Duración'},
  group:{en:'Group size',es:'Tamaño del grupo'}, level:{en:'Difficulty',es:'Dificultad'},
  start:{en:'Start & finish',es:'Inicio y fin'}, base:{en:'Based in',es:'Con base en'}, style:{en:'Tour style',es:'Estilo'}
};
function buildDetailModal(){
  if(document.getElementById('dtDrop')) return;
  const d=document.createElement('div'); d.className='dtdrop'; d.id='dtDrop';
  d.innerHTML='<div class="dtmodal" role="dialog" aria-modal="true"><button class="bk-close" id="dtClose" aria-label="Close">&times;</button><div id="dtContent"></div></div>';
  document.body.appendChild(d);
  d.addEventListener('click',e=>{ if(e.target===d) closeDetail(); });
  d.querySelector('#dtClose').addEventListener('click',closeDetail);
  document.addEventListener('keydown',e=>{ if(e.key==='Escape' && d.classList.contains('open')) closeDetail(); });
}
function closeDetail(){ const d=document.getElementById('dtDrop'); if(d) d.classList.remove('open'); document.documentElement.style.overflow=''; }
function openDetail(type, id){
  const det=(window.GHA_DETAILS||{})[type==='package'?'packages':'tours'];
  const det1=det&&det[id]; if(!det1) return;
  const src= type==='package' ? S.packages.find(p=>p.id===id) : S.tours.find(tr=>tr.id===id);
  if(!src) return;
  buildDetailModal();
  const es=L==='es';
  const eyebrow= type==='package' ? (t(src.days)+' / '+t(src.nights)) : t(src.tag);
  const quote=!src.price;
  const priceHTML= quote
    ? '<small>'+(es?'Precio':'Price')+'</small><b>'+(es?'Cotización a medida':'Custom quote')+'</b>'
    : '<small>'+(es?'Desde':'From')+'</small><b>'+money(src.price)+'</b><em>'+(type==='package'?(es?'/ persona · mín 2':'/ person · min 2'):'/ '+t(src.priceLabel))+'</em>';
  const gal=(det1.gallery||[src.img]);
  const galHTML='<div class="dt-gallery">'+gal.map((g,k)=>'<div class="dt-g'+(k===0?' lead':'')+'" style="background-image:url('+g+')"></div>').join('')+'</div>';
  const highHTML= (det1.highlights&&det1.highlights.length)?'<section class="dt-sec"><h3>'+(es?'Lo mejor de la experiencia':'Tour highlights')+'</h3><ul class="dt-checks">'+det1.highlights.map(h=>'<li>'+svg('check')+'<span>'+t(h)+'</span></li>').join('')+'</ul></section>':'';
  const itinHTML= (det1.agenda&&det1.agenda.length)?'<section class="dt-sec"><h3>'+(type==='package'?(es?'Itinerario día a día':'Day-by-day itinerary'):(es?'Cómo es tu día':'How your day flows'))+'</h3><div class="dt-timeline">'+det1.agenda.map(a=>'<div class="dt-step"><div class="dt-dot"></div><div class="dt-step-b"><b>'+t(a.title)+'</b><p>'+t(a.body)+'</p></div></div>').join('')+'</div></section>':'';
  const inclHTML='<section class="dt-sec"><div class="dt-incl">'
    +'<div><h4>'+svg('check')+(es?'Qué incluye':'What\'s included')+'</h4><ul class="dt-checks">'+(det1.included||[]).map(i=>'<li>'+svg('check')+'<span>'+t(i)+'</span></li>').join('')+'</ul></div>'
    +'<div><h4 class="x">'+(es?'No incluye':'Not included')+'</h4><ul class="dt-x">'+(det1.notIncluded||[]).concat(S.mealNote?[S.mealNote]:[]).map(i=>'<li><span>→</span>'+t(i)+'</li>').join('')+'</ul></div>'
    +'</div></section>';
  const polHTML = policyAccordion();
  const choiceHTML = (type==='package' && id!=='p8is' && S.pkgChoice) ? (
    '<section class="dt-sec"><h3>'+t(S.pkgChoice.title)+'</h3>'
    +'<div class="dt-choice">'
      +'<p class="dt-choice-lead">'+t(S.pkgChoice.lead)+'</p>'
      +'<div class="dt-choice-opts">'+S.pkgChoice.options.map(o=>'<span class="dt-chip'+(o.fish?' fish':'')+'">'+svg(o.fish?'hook':'check')+t(o)+'</span>').join('')+'</div>'
      +'<div class="dt-rosita">'+svg('boat')+'<div><b>'+t(S.pkgChoice.fishing.title)+'</b><p>'+t(S.pkgChoice.fishing.body)+'</p></div></div>'
    +'</div></section>'
  ) : '';
  let factsHTML='';
  if(det1.facts){ factsHTML='<ul class="dt-facts">'+Object.keys(det1.facts).map(k=>'<li>'+svg(FACT_ICONS[k]||'pin')+'<span><small>'+t(FACT_LABELS[k]||{en:k,es:k})+'</small><b>'+t(det1.facts[k])+'</b></span></li>').join('')+'</ul>'; }
  const waHref=waLink((es?'¡Hola! Quiero más información sobre "':'Hi! I\'d love more info about the "')+t(src.name)+'".');
  const bookLabel= quote?(es?'Pedir cotización':'Request a quote'):(es?'Reservar ahora':'Book now');
  const c=document.getElementById('dtContent');
  c.innerHTML='<div class="dt-banner"><p class="eyebrow">'+eyebrow+'</p><h2>'+t(src.name)+'</h2></div>'
    +galHTML
    +'<div class="dt-body"><div class="dt-main">'
      +'<p class="dt-intro">'+t(det1.intro||src.blurb)+'</p>'
      +highHTML+itinHTML+choiceHTML+inclHTML+polHTML
    +'</div><aside class="dt-side"><div class="dt-card">'
      +'<div class="dt-price'+(quote?' quote':'')+'">'+priceHTML+'</div>'
      +((type==='package'&&S.pkgPromo)?'<div class="dt-promo">'+svg('tag')+'<span>'+t(S.pkgPromo.line)+'</span></div>':'')
      +factsHTML
      +bookBtn(t(src.name)+(type==='package'?' · '+t(src.days):''), src.price, type==='package'?'person':(quote?'boat':'person'), 'btn btn-gold btn-block', bookLabel, (type==='package'?(src.minGuests||2):1), src.id)
      +'<a class="btn btn-ghost btn-block" href="'+waHref+'" target="_blank" rel="noopener" style="margin-top:10px">'+svg('wa')+(es?'Preguntar por WhatsApp':'Ask on WhatsApp')+'</a>'
    +'</div></aside></div>';
  document.getElementById('dtDrop').classList.add('open');
  document.documentElement.style.overflow='hidden';
  document.querySelector('.dtmodal').scrollTop=0;
}

function renderTours(){
  const grid=document.getElementById('toursGrid'); if(!grid) return;
  const limit=parseInt(grid.dataset.limit||'0',10);
  let list=S.tours.slice();
  if(limit){ list.sort(()=>Math.random()-0.5); list=list.slice(0,limit); }
  grid.innerHTML=list.map(tourCard).join('');
  // filters
  const fbar=document.getElementById('tourFilters');
  if(fbar){
    fbar.innerHTML=S.tourCats.map(c=>'<button data-f="'+c.id+'" class="'+(c.id==='all'?'active':'')+'">'+t(c)+'</button>').join('');
    fbar.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{
      fbar.querySelectorAll('button').forEach(x=>x.classList.remove('active')); b.classList.add('active');
      const f=b.dataset.f;
      grid.querySelectorAll('.tcard').forEach(c=>{ c.style.display=(f==='all'||c.dataset.cat===f)?'':'none'; });
    }));
  }
  observeReveals();
}

function policyAccordion(){
  if(!S.policies||!S.policies.items) return '';
  const es=L==='es';
  return '<details class="dt-policy"><summary>'+svg('info')+'<span>'+t(S.policies.title)+'</span>'+svg('arrow')+'</summary>'
    +'<ul class="dt-policy-list">'+S.policies.items.map(i=>'<li>'+t(i)+'</li>').join('')+'</ul></details>';
}

function pkgCard(p){
  const onIndex = document.body.dataset.page==='index';
  const hasDetail = !!(window.GHA_DETAILS && GHA_DETAILS.packages && GHA_DETAILS.packages[p.id]);
  return '<article class="pkg reveal'+(p.popular?' featured':'')+'">'
    +(p.popular?'<div class="pkg-flag" data-en="Most Popular" data-es="Más Popular">'+(L==='es'?'Más Popular':'Most Popular')+'</div>':'')
    +'<div class="pkg-media'+(hasDetail?' js-detail':'')+'"'+(hasDetail?' data-type="package" data-id="'+esc(p.id)+'"':'')+'><img src="'+p.img+'" alt="'+t(p.name)+'" loading="lazy"></div>'
    +'<div class="pkg-head"><span class="days">'+t(p.days)+'</span> <span class="nights">/ '+t(p.nights)+'</span>'
      +'<div style="font-family:var(--display);font-weight:700;font-size:19px;margin-top:8px">'+t(p.name)+'</div></div>'
    +(onIndex?'':'<div class="pkg-price"><small>'+(L==='es'?'Desde':'From')+'</small><b>'+money(p.price)+'</b><em>/ '+(L==='es'?'persona':'person')+' · '+(L==='es'?'mín 2':'min 2')+'</em></div>')
    +'<ul class="pkg-includes">'+p.includes.map(i=>'<li>'+svg('check')+'<span>'+t(i)+'</span></li>').join('')+'</ul>'
    +'<div class="pkg-foot">'
      +(hasDetail?detailBtn('package', p.id, 'btn btn-ghost btn-block', (L==='es'?'Ver itinerario':'View itinerary')):'')
      +bookBtn(t(p.name)+' · '+t(p.days), p.price, 'person', 'btn '+(p.popular?'btn-gold':'btn-ink')+' btn-block', (onIndex?(L==='es'?'Consultar':'Enquire'):(L==='es'?'Reservar este viaje':'Book this journey')), (p.minGuests||2), p.id)
    +'</div>'
  +'</article>';
}
function renderPackages(){
  const grid=document.getElementById('pkgGrid'); if(!grid) return;
  const onIndex = document.body.dataset.page==='index';
  let list=S.packages.slice();
  if(onIndex){ list.sort(()=>Math.random()-0.5); list=list.slice(0,3); }
  grid.innerHTML=list.map(pkgCard).join(''); observeReveals();
}

function renderFishing(){
  const f=S.fishing;
  const chips=document.getElementById('fishSpecies');
  if(chips) chips.innerHTML=f.species.map(s=>'<span class="chip">'+svg('fish')+'<b>'+t(s)+'</b></span>').join('');
  const reel=document.getElementById('fishReel');
  if(reel) reel.innerHTML=f.photos.map((p,k)=>'<div class="hero-slide'+(k===0?' on':'')+'" style="background-image:url('+p+')"></div>').join('');
  const trips=document.getElementById('fishTrips');
  if(trips) trips.innerHTML=f.trips.map(tr=>{
    const car=(f.tripCarousel&&f.tripCarousel.length)?f.tripCarousel:[];
    const carHTML=car.length?('<div class="trip-car" data-trip-car>'+car.map((src,k)=>'<div class="trip-car-slide'+(k===0?' on':'')+'" style="background-image:url('+src+')"></div>').join('')+'<div class="trip-car-dots">'+car.map((_,k)=>'<span class="'+(k===0?'on':'')+'"></span>').join('')+'</div></div>'):'';
    return '<article class="pkg reveal">'+carHTML+'<div class="pkg-head"><span class="days">'+t(tr.name)+'</span><div class="nights" style="margin-top:6px">'+t(tr.duration)+'</div></div>'
      +(tr.price
          ? '<div class="pkg-price"><small>'+(L==='es'?'Desde':'From')+'</small><b>'+money(tr.price)+'</b><em>/ '+(L==='es'?'bote':'boat')+'</em></div>'
          : '<div class="pkg-price quote"><small>'+(L==='es'?'Precio':'Price')+'</small><b style="font-size:18px">'+(L==='es'?'Pregunta por tu pesca':'Ask about your trip')+'</b></div>')
      +'<div class="pkg-foot" style="padding-top:8px">'+bookBtn(t(tr.name), tr.price, 'boat', 'btn btn-gold btn-block', (tr.price?(L==='es'?'Reservar':'Book'):(L==='es'?'Pedir cotización':'Get Quote')), 1, tr.id)+'</div></article>';
  }).join('');
  initTripCarousels();
  const cal=document.getElementById('fishCalendar');
  if(cal){
    cal.innerHTML=f.calendar.months.map((mo,k)=>{
      let cls=''; if(f.calendar.peak.includes(k))cls='peak'; else if(f.calendar.good.includes(k))cls='good';
      return '<div class="cal-m '+cls+'">'+mo+'</div>';
    }).join('');
  }
  observeReveals();
}

function renderGallery(){
  const el=document.getElementById('galleryReel'); if(!el) return;
  el.innerHTML=S.gallery.map(src=>'<a href="'+src+'" target="_blank" rel="noopener"><img src="'+src+'" alt="Galápagos" loading="lazy"></a>').join('');
}

function renderAbout(){
  const body=document.getElementById('aboutBody');
  if(body) body.innerHTML=t(S.about.body).split('\n\n').map(p=>'<p>'+p+'</p>').join('');
  const vals=document.getElementById('aboutValues');
  if(vals) vals.innerHTML=S.about.values.map(v=>'<div class="feature reveal"><div class="ic">'+svg(v.icon)+'</div><h4>'+t(v.title)+'</h4><p>'+t(v.text)+'</p></div>').join('');
  observeReveals();
}
function renderConservation(){
  const body=document.getElementById('consBody');
  if(body) body.innerHTML='<p>'+t(S.conservation.body)+'</p>';
  const pil=document.getElementById('consPillars');
  if(pil) pil.innerHTML=S.conservation.pillars.map((p,k)=>'<div class="feature reveal"><div class="ic">'+svg(['community','fish','shield','commitment'][k]||'shield')+'</div><h4>'+t(p.title)+'</h4><p>'+t(p.text)+'</p></div>').join('');
  observeReveals();
}

/* ---------------- MAP ---------------- */
function renderMap(){
  const wrap=document.getElementById('mapWrap'); if(!wrap) return;
  const spots=S.mapSpots;
  // stylized island silhouette (San Cristóbal-ish blob) + pins
  const island='M150 250 C120 200 130 150 200 130 C250 115 300 90 380 100 C470 110 560 130 640 150 C720 170 760 220 740 280 C720 340 660 360 580 365 C520 368 470 390 400 385 C320 380 250 360 200 340 C160 325 165 290 150 250 Z';
  let svgStr='<svg class="map-svg" viewBox="0 0 880 500" preserveAspectRatio="xMidYMid meet">'
    +'<defs><radialGradient id="sea" cx="50%" cy="40%" r="80%"><stop offset="0%" stop-color="#13403c"/><stop offset="100%" stop-color="#08201f"/></radialGradient>'
    +'<linearGradient id="land" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#3a4a36"/><stop offset="100%" stop-color="#26331f"/></linearGradient></defs>'
    +'<rect width="880" height="500" fill="url(#sea)"/>'
    // faint depth rings
    +'<g opacity="0.06" fill="none" stroke="#fff" stroke-width="1">'
      +'<ellipse cx="440" cy="250" rx="360" ry="200"/><ellipse cx="440" cy="250" rx="270" ry="150"/><ellipse cx="440" cy="250" rx="180" ry="100"/></g>'
    +'<path d="'+island+'" fill="url(#land)" stroke="#cf9f54" stroke-width="1.4" stroke-opacity="0.5"/>';
  spots.forEach(sp=>{
    const cx=(sp.x/100)*880, cy=(sp.y/100)*500;
    svgStr+='<g class="map-pin" data-id="'+sp.id+'" transform="translate('+cx+','+cy+')">'
      +'<circle class="pulse" r="6"/><circle class="dot" r="6"/></g>';
  });
  svgStr+='</svg>';
  wrap.innerHTML=svgStr+'<div class="map-tip" id="mapTip"></div>';
  const tip=wrap.querySelector('#mapTip');
  wrap.querySelectorAll('.map-pin').forEach(p=>{
    const sp=spots.find(s=>s.id===p.dataset.id);
    const move=(e)=>{ const r=wrap.getBoundingClientRect(); tip.style.left=Math.min(r.width-240,(e.clientX-r.left)+14)+'px'; tip.style.top=((e.clientY-r.top)+14)+'px'; };
    p.addEventListener('mouseenter',e=>{ tip.innerHTML='<b>'+t(sp.name)+'</b><span>'+t(sp.desc)+'</span>'; tip.classList.add('show'); move(e); });
    p.addEventListener('mousemove',move);
    p.addEventListener('mouseleave',()=>tip.classList.remove('show'));
    p.addEventListener('click',()=>{ tip.innerHTML='<b>'+t(sp.name)+'</b><span>'+t(sp.desc)+'</span>'; tip.classList.add('show'); });
  });
  const leg=document.getElementById('mapLegend');
  if(leg) leg.innerHTML=spots.map(sp=>'<button data-id="'+sp.id+'"><i></i>'+t(sp.name)+'</button>').join('');
  if(leg) leg.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{
    leg.querySelectorAll('button').forEach(x=>x.classList.remove('active')); b.classList.add('active');
    const sp=spots.find(s=>s.id===b.dataset.id); tip.innerHTML='<b>'+t(sp.name)+'</b><span>'+t(sp.desc)+'</span>';
    const cx=(sp.x/100)*100, cy=(sp.y/100)*100; tip.style.left='calc('+cx+'% - 0px)'; tip.style.top='calc('+cy+'% + 14px)'; tip.classList.add('show');
  }));
}

/* ---------------- CONTACT FORM ---------------- */
function initForms(){
  document.querySelectorAll('form[data-contact]').forEach(form=>{
    form.addEventListener('submit',e=>{
      e.preventDefault();
      const data=Object.fromEntries(new FormData(form).entries());
      const msg=(L==='es'?'¡Hola Galápagos Hook! Soy ':'Hi Galápagos Hook! I\'m ')+(data.name||'')
        +(data.interest?(L==='es'?'. Me interesa: ':'. I\'m interested in: ')+data.interest:'')
        +(data.message?('. '+data.message):'')
        +(data.email?(' ('+data.email+')'):'');
      // WhatsApp shortcut OR email fallback
      window.open(waLink(msg),'_blank');
      toast(L==='es'?'¡Gracias! Abriendo WhatsApp…':'Thanks! Opening WhatsApp…');
      form.reset();
    });
    // wire dedicated whatsapp button if present
    const wbtn=form.querySelector('[data-wa-shortcut]');
    if(wbtn) wbtn.addEventListener('click',()=>{ const n=form.querySelector('[name=name]'); n&&n.focus(); form.requestSubmit(); });
  });
}
let toastTimer;
function toast(msg){
  let el=document.querySelector('.toast');
  // Se monta directamente en document.body (hermano del modal) para no quedar atrapado en su stacking context.
  if(!el){ el=document.createElement('div'); el.className='toast'; el.setAttribute('role','alert'); el.setAttribute('aria-live','assertive'); document.body.appendChild(el); }
  el.textContent=msg; requestAnimationFrame(()=>el.classList.add('show'));
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('show'),3200);
}
window.GHA.toast=toast;

/* ---------------- LANGUAGE ---------------- */
function applyStaticLang(){
  document.documentElement.lang=L;
  document.querySelectorAll('[data-en]').forEach(el=>{
    const val=(L==='es' && el.dataset.es!=null)? el.dataset.es : el.dataset.en;
    if(el.hasAttribute('data-html')) el.innerHTML=val; else el.textContent=val;
  });
  document.querySelectorAll('[data-en-attr]').forEach(el=>{
    // format: "placeholder|EN text||ES text"
  });
}
function setLang(lang){ if(lang===L) return; L=lang; localStorage.setItem(LKEY,lang); render(); }
window.GHA.setLang=setLang;

/* ---------------- MASTER RENDER ---------------- */
function render(){
  buildHeader(); buildFooter();
  applyStaticLang();
  renderHero();
  renderTrust(); renderPackages(); renderTours(); renderFishing();
  renderGallery(); renderAbout(); renderConservation(); renderMap();
  // hero text fields (data-hero attributes)
  document.querySelectorAll('[data-hero]').forEach(el=>{ el.innerHTML=t(S.hero[el.dataset.hero]); });
  // build wa float fresh (lang msg)
  const old=document.querySelector('.wa-float'); if(old) old.remove(); buildWhatsAppFloat();
  observeReveals();
}

/* ---------------- INIT ---------------- */
function init(){
  initReveal();
  render();
  initHeaderScroll();
  initReels();
  initForms();
  // open the checkout from any Book button
  document.addEventListener('click',e=>{
    const b=e.target.closest('.js-book'); if(!b) return;
    e.preventDefault();
    closeDetail();
    openBooking({name:b.dataset.name, price:b.dataset.price, unit:b.dataset.unit, min:b.dataset.min, tourId:b.dataset.tourId});
  });
  // open the detail modal from any More-info button or card media
  document.addEventListener('click',e=>{
    const b=e.target.closest('.js-detail'); if(!b) return;
    e.preventDefault();
    openDetail(b.dataset.type, b.dataset.id);
  });
}
if(document.readyState!=='loading') init(); else document.addEventListener('DOMContentLoaded',init);

})();
