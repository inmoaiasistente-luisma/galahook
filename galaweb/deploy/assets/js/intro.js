/* =========================================================
   GALÁPAGOS HOOK — globe intro / preloader
   Spinning country-outline globe (light, on teal) + whirl,
   a progress bar to 100%, then a "ready" prompt + enter arrow.
   Mount:  <div id="globeIntro" data-enter-href="index.html"></div>
           data-enter-href : navigate here on enter (optional)
           data-session    : show once per browser session
           data-text       : override the ready headline
   Requires d3 + topojson-client loaded before this file.
   ========================================================= */
(function(){
"use strict";
var host = document.getElementById('globeIntro');
if(!host){ host=document.createElement('div'); host.id='globeIntro'; document.body.appendChild(host); }

var enterHref = host.getAttribute('data-enter-href');
var sessionGate = host.hasAttribute('data-session');
var readyText = host.getAttribute('data-text') || 'Ready for your next experience?';

/* session skip */
if(sessionGate && sessionStorage.getItem('gha_entered')==='1'){ host.remove(); return; }

/* ---- styles ---- */
var css = `
#globeIntro.gintro{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(120% 120% at 50% 35%, #0f4034 0%, #0a2a22 60%, #071d18 100%);
  font-family:'Hanken Grotesk','Source Sans 3',system-ui,sans-serif;color:#eef2ea;
  transition:opacity .7s ease, visibility .7s;}
#globeIntro.gintro.out{opacity:0;visibility:hidden;}
.gintro .gcol{display:flex;flex-direction:column;align-items:center;}
.gintro .gloader{position:relative;width:400px;height:400px;display:grid;place-items:center;}
.gintro canvas{width:400px;height:400px;display:block;}
.gintro .gwhirl{position:absolute;inset:-28px;pointer-events:none;}
.gintro .gring{position:absolute;inset:0;border-radius:50%;}
.gintro .gsweep{background:conic-gradient(from 0deg,transparent 0deg,rgba(255,255,255,0) 30deg,rgba(255,255,255,.16) 180deg,rgba(255,255,255,.7) 330deg,transparent 360deg);
  -webkit-mask:radial-gradient(circle,transparent 46%,#000 47.5%,#000 50%,transparent 51%);mask:radial-gradient(circle,transparent 46%,#000 47.5%,#000 50%,transparent 51%);
  animation:gspin 2.4s linear infinite;}
.gintro .gsweep.outer{inset:-16px;opacity:.55;animation-duration:4.2s;animation-direction:reverse;}
.gintro .gdash{border:1.25px dashed rgba(255,255,255,.28);animation:gspin 9s linear infinite;}
.gintro .gdash.tight{inset:10px;border-style:dotted;border-color:rgba(255,255,255,.2);animation-duration:6s;animation-direction:reverse;}
.gintro .gfleck{position:absolute;top:50%;left:50%;width:3px;height:3px;margin:-1.5px;border-radius:50%;background:#eef2ea;}
.gintro .gorbit{position:absolute;inset:0;animation:gspin 3.4s linear infinite;}
.gintro .gorbit:nth-child(6){animation-duration:5.1s;animation-direction:reverse;opacity:.7;}
.gintro .gorbit:nth-child(7){animation-duration:7.2s;opacity:.5;}
@keyframes gspin{to{transform:rotate(360deg);}}
.gintro .gmark{margin-top:42px;font-family:'Bricolage Grotesque','Source Sans 3',sans-serif;font-weight:700;letter-spacing:.32em;text-transform:uppercase;font-size:13px;color:rgba(255,255,255,.62);}
.gintro .gprogress{margin-top:18px;width:240px;max-width:62vw;height:3px;border-radius:3px;background:rgba(255,255,255,.14);overflow:hidden;}
.gintro .gbar{height:100%;width:0%;background:linear-gradient(90deg,#cf9f54,#e4c98c);border-radius:3px;transition:width .12s linear;}
.gintro .gpct{margin-top:12px;font-size:12px;letter-spacing:.18em;color:rgba(255,255,255,.55);font-variant-numeric:tabular-nums;transition:opacity .4s;}
.gintro .gready{margin-top:30px;text-align:center;opacity:0;transform:translateY(14px);transition:opacity .7s ease .05s,transform .7s cubic-bezier(.22,.61,.36,1);pointer-events:none;}
.gintro .gready.show{opacity:1;transform:none;pointer-events:auto;}
.gintro .gready p{margin:0 0 22px;font-family:'Bricolage Grotesque','Source Sans 3',sans-serif;font-weight:700;font-size:clamp(22px,3.4vw,32px);letter-spacing:-.01em;color:#fbf8f1;}
.gintro .genter{position:relative;width:66px;height:66px;border-radius:50%;background:#cf9f54;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;border:none;
  transition:transform .35s cubic-bezier(.22,.61,.36,1),background .3s;box-shadow:0 14px 34px -12px rgba(207,159,84,.8);}
.gintro .genter:hover{transform:translateY(-3px) scale(1.04);background:#e4c98c;}
.gintro .genter svg{width:26px;height:26px;color:#082420;transition:transform .35s cubic-bezier(.22,.61,.36,1);}
.gintro .genter:hover svg{transform:translateX(4px);}
.gintro .genter::after{content:"";position:absolute;inset:0;border-radius:50%;border:2px solid #cf9f54;animation:gpulse 2.2s ease-out infinite;}
@keyframes gpulse{0%{transform:scale(1);opacity:.7;}100%{transform:scale(1.5);opacity:0;}}
.gintro .gskip{margin-top:16px;background:none;border:none;color:rgba(255,255,255,.45);font-family:inherit;font-size:12px;letter-spacing:.14em;text-transform:uppercase;cursor:pointer;transition:color .3s;}
.gintro .gskip:hover{color:rgba(255,255,255,.8);}
@media (prefers-reduced-motion:reduce){.gintro .gsweep,.gintro .gdash,.gintro .gorbit{animation:none;}}
`;
var st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);

/* ---- markup ---- */
host.className='gintro';
host.style.cssText='';
host.innerHTML =
  '<div class="gcol">'
   +'<div class="gloader">'
     +'<div class="gwhirl" aria-hidden="true">'
       +'<div class="gring gsweep outer"></div><div class="gring gsweep"></div>'
       +'<div class="gring gdash"></div><div class="gring gdash tight"></div>'
       +'<div class="gorbit"><span class="gfleck" style="top:4%;left:50%"></span></div>'
       +'<div class="gorbit"><span class="gfleck" style="top:50%;left:96%"></span></div>'
       +'<div class="gorbit"><span class="gfleck" style="top:92%;left:38%"></span></div>'
     +'</div>'
     +'<canvas id="gIntroGlobe" width="400" height="400"></canvas>'
   +'</div>'
   +'<div class="gmark">Galápagos Hook Adventure</div>'
   +'<div class="gprogress"><div class="gbar" id="gIntroBar"></div></div>'
   +'<div class="gpct" id="gIntroPct">0%</div>'
   +'<div class="gready" id="gIntroReady">'
     +'<p>'+readyText+'</p>'
     +'<button class="genter" id="gIntroEnter" aria-label="Enter the site">'
       +'<svg viewBox="0 0 24 24" fill="none"><path d="M4 12h14M12 5l7 7-7 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
     +'</button>'
   +'</div>'
  +'</div>';

document.documentElement.style.overflow='hidden';

/* ---- globe ---- */
(function runGlobe(){
  var canvas=document.getElementById('gIntroGlobe'); if(!canvas || typeof d3==='undefined') return;
  var ctx=canvas.getContext('2d'); var SIZE=400;
  var dpr=Math.max(1,Math.min(2,window.devicePixelRatio||1));
  canvas.width=SIZE*dpr; canvas.height=SIZE*dpr; ctx.scale(dpr,dpr);
  var projection=d3.geoOrthographic().scale(SIZE/2-6).translate([SIZE/2,SIZE/2]).clipAngle(90);
  var path=d3.geoPath(projection,ctx); var graticule=d3.geoGraticule10(); var sphere={type:'Sphere'};
  var land=null;
  function draw(){
    ctx.clearRect(0,0,SIZE,SIZE);
    ctx.beginPath(); path(sphere); ctx.fillStyle='rgba(255,255,255,0.05)'; ctx.fill();
    ctx.beginPath(); path(graticule); ctx.lineWidth=0.4; ctx.strokeStyle='rgba(255,255,255,0.22)'; ctx.stroke();
    if(land){ ctx.beginPath(); path(land); ctx.fillStyle='rgba(235,242,236,0.9)'; ctx.fill(); ctx.lineWidth=0.5; ctx.strokeStyle='rgba(255,255,255,0.9)'; ctx.stroke(); }
    ctx.beginPath(); path(sphere); ctx.lineWidth=1.1; ctx.strokeStyle='rgba(255,255,255,0.85)'; ctx.stroke();
  }
  var lng=0,last=performance.now(),started=false;
  function tick(now){ var dt=(now-last)/1000; last=now; lng+=dt*22; projection.rotate([lng,-12,0]); draw(); requestAnimationFrame(tick); }
  function start(){ projection.rotate([lng,-12,0]); draw(); if(!started){ started=true; last=performance.now(); requestAnimationFrame(tick); } }
  if(typeof topojson!=='undefined'){
    fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json').then(function(r){return r.json();})
      .then(function(w){ land=topojson.feature(w, w.objects.land||w.objects.countries); start(); })
      .catch(function(){ start(); });
  }
  start(); started=false;
})();

/* ---- progress ---- */
var bar=document.getElementById('gIntroBar'), pct=document.getElementById('gIntroPct'), ready=document.getElementById('gIntroReady');
var DUR=2400, t0=performance.now();
function step(now){
  var k=Math.min(1,(now-t0)/DUR);
  var eased=1-Math.pow(1-k,2.1);
  var p=Math.round(eased*100);
  bar.style.width=p+'%'; pct.textContent=p+'%';
  if(k<1) requestAnimationFrame(step); else finish();
}
requestAnimationFrame(step);
function finish(){ pct.style.opacity='0'; ready.classList.add('show'); }

/* ---- enter ---- */
function enter(){
  if(sessionGate) sessionStorage.setItem('gha_entered','1');
  if(enterHref){ location.href=enterHref; return; }
  host.classList.add('out');
  document.documentElement.style.overflow='';
  setTimeout(function(){ host.remove(); },750);
}
document.getElementById('gIntroEnter').addEventListener('click',enter);
document.addEventListener('keydown',function(e){ if((e.key==='Enter'||e.key===' ') && ready.classList.contains('show')){ e.preventDefault(); enter(); } });
})();
