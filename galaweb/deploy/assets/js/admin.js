/* =========================================================
   GALÁPAGOS HOOK ADVENTURE — Admin
   Owner login + live content editor. Saves to localStorage
   (GHA_CONTENT) which every page reads on load.
   ========================================================= */
(function(){
"use strict";

const CRED = { email:"galahookadventure@outlook.com", pass:"LuismaLuanahook052217" };
const CKEY="GHA_CONTENT", SKEY="GHA_ADMIN";
const shell=document.getElementById('shell');

/* deep clone + merge (same shape as app.js) */
function clone(o){ return JSON.parse(JSON.stringify(o)); }
function deepMerge(base, over){
  if(Array.isArray(base)) return Array.isArray(over)?over:base;
  if(base && typeof base==='object'){ const out={...base}; if(over&&typeof over==='object'){for(const k in over) out[k]=(k in base)?deepMerge(base[k],over[k]):over[k];} return out; }
  return over!==undefined?over:base;
}
function loadWorking(){
  let stored=null; try{ stored=JSON.parse(localStorage.getItem(CKEY)||'null'); }catch(e){}
  return clone(stored?deepMerge(window.GHA_DEFAULT,stored):window.GHA_DEFAULT);
}
let W = loadWorking();
let dirty=false;

/* ---------- icons ---------- */
const I={
  save:'<svg viewBox="0 0 24 24" width="15" height="15"><path d="M5 3h12l4 4v14H5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8 3v6h7V3M8 21v-7h8v7" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  eye:'<svg viewBox="0 0 24 24" width="15" height="15"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  out:'<svg viewBox="0 0 24 24" width="15" height="15"><path d="M14 4h5v16h-5M14 12H4M7 8l-3 4 3 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

/* ============ LOGIN ============ */
function showLogin(){
  shell.innerHTML=
   '<div class="login"><form class="login-card" id="loginForm">'
   +'<img src="assets/img/logo.png" alt="logo">'
   +'<h1>Owner Login</h1><p>Galápagos Hook Adventure · Admin</p>'
   +'<div class="err" id="loginErr">Incorrect email or password.</div>'
   +'<div class="field"><label>Email</label><input type="email" id="aEmail" autocomplete="username" required></div>'
   +'<div class="field"><label>Password</label><input type="password" id="aPass" autocomplete="current-password" required></div>'
   +'<button type="submit" class="btn btn-gold btn-block" style="margin-top:8px">Log in</button>'
   +'<p style="margin:16px 0 0"><a href="index.html" style="color:var(--sea);font-weight:600;font-size:13px">← Back to site</a></p>'
   +'</form></div>';
  document.getElementById('loginForm').addEventListener('submit',e=>{
    e.preventDefault();
    const em=document.getElementById('aEmail').value.trim().toLowerCase();
    const pw=document.getElementById('aPass').value;
    if(em===CRED.email && pw===CRED.pass){ sessionStorage.setItem(SKEY,'1'); showAdmin(); }
    else document.getElementById('loginErr').classList.add('show');
  });
}

/* ============ helpers to build bound fields ============ */
function el(html){ const d=document.createElement('div'); d.innerHTML=html.trim(); return d.firstChild; }
function setDirty(){ dirty=true; const s=document.getElementById('saveState'); if(s){ s.textContent='Unsaved changes'; s.classList.add('show'); } }

function biField(label, obj, key, textarea){
  const wrap=el('<div class="ed-field"><label>'+label+'</label></div>');
  const row=el('<div class="ed-row"></div>');
  [['en','EN'],['es','ES']].forEach(([lng,tag])=>{
    if(typeof obj[key]!=='object'||obj[key]===null) obj[key]={en:obj[key]||'',es:obj[key]||''};
    const f=document.createElement(textarea?'textarea':'input');
    f.value=obj[key][lng]||'';
    f.placeholder=tag;
    f.addEventListener('input',()=>{ obj[key][lng]=f.value; setDirty(); });
    const c=el('<div></div>'); const lab=el('<label style="opacity:.6;font-size:10px">'+tag+'</label>'); c.appendChild(lab); c.appendChild(f);
    row.appendChild(c);
  });
  wrap.appendChild(row); return wrap;
}
function strField(label, obj, key){
  const wrap=el('<div class="ed-field"><label>'+label+'</label></div>');
  const f=document.createElement('input'); f.value=obj[key]||'';
  f.addEventListener('input',()=>{ obj[key]=f.value; setDirty(); });
  wrap.appendChild(f); return wrap;
}
function numField(label, obj, key){
  const wrap=el('<div class="ed-field"><label>'+label+'</label></div>');
  const box=el('<div class="price-in"><span>$</span></div>');
  const f=document.createElement('input'); f.type='number'; f.value=obj[key]||0; f.min=0;
  f.addEventListener('input',()=>{ obj[key]=parseInt(f.value||'0',10); setDirty(); });
  box.appendChild(f); wrap.appendChild(box); return wrap;
}
function imgField(label, obj, key){
  const wrap=el('<div class="ed-field"><label>'+label+'</label><div class="img-edit"></div></div>');
  const row=wrap.querySelector('.img-edit');
  const thumb=el('<div class="thumb"></div>'); thumb.style.backgroundImage='url('+obj[key]+')';
  const acts=el('<div class="img-actions"></div>');
  const path=document.createElement('input'); path.value=obj[key]||''; path.placeholder='image path or URL';
  path.addEventListener('input',()=>{ obj[key]=path.value; thumb.style.backgroundImage='url('+path.value+')'; setDirty(); });
  const up=el('<label class="mini-btn">⬆ Upload photo<input type="file" accept="image/*" hidden></label>');
  up.querySelector('input').addEventListener('change',ev=>{
    const file=ev.target.files[0]; if(!file) return;
    const rd=new FileReader();
    rd.onload=()=>{ obj[key]=rd.result; path.value='(uploaded image)'; thumb.style.backgroundImage='url('+rd.result+')'; setDirty(); };
    rd.readAsDataURL(file);
  });
  acts.appendChild(path); acts.appendChild(up);
  row.appendChild(thumb); row.appendChild(acts);
  return wrap;
}
function card(title, hintHTML){
  const c=el('<div class="ed-card"></div>');
  if(title) c.appendChild(el('<h3>'+title+'</h3>'));
  if(hintHTML) c.appendChild(el('<p class="hint">'+hintHTML+'</p>'));
  return c;
}
function includesEditor(arr){
  const box=el('<div class="ed-field"><label>What\'s included (EN · ES)</label></div>');
  function rowFor(item,idx){
    const r=el('<div class="inc-row"></div>');
    const a=document.createElement('input'); a.value=item.en||''; a.placeholder='EN';
    const b=document.createElement('input'); b.value=item.es||''; b.placeholder='ES';
    a.addEventListener('input',()=>{item.en=a.value;setDirty();});
    b.addEventListener('input',()=>{item.es=b.value;setDirty();});
    const del=el('<button class="mini-btn danger" type="button">✕</button>');
    del.addEventListener('click',()=>{ arr.splice(idx,1); rebuild(); setDirty(); });
    r.appendChild(a); r.appendChild(b); r.appendChild(del); return r;
  }
  function rebuild(){ [...box.querySelectorAll('.inc-row,.add-inc')].forEach(n=>n.remove());
    arr.forEach((it,i)=>box.appendChild(rowFor(it,i)));
    const add=el('<button class="mini-btn add-inc" type="button" style="margin-top:4px">+ Add line</button>');
    add.addEventListener('click',()=>{ arr.push({en:'',es:''}); rebuild(); setDirty(); });
    box.appendChild(add);
  }
  rebuild(); return box;
}

/* ============ PANELS ============ */
function panelSite(){
  const p=el('<div></div>');
  const m=W.meta;
  const c1=card('Brand & Contact','These appear in the header, footer and WhatsApp links across the site.');
  c1.appendChild(biField('Slogan',m,'slogan'));
  const r=el('<div class="ed-row"></div>');
  r.appendChild(strField('WhatsApp number',m,'whatsapp'));
  r.appendChild(strField('Phone',m,'phone'));
  r.appendChild(strField('Email',m,'email'));
  const r2=el('<div class="ed-row"></div>');
  r2.appendChild(strField('Instagram handle',m,'instagram'));
  r2.appendChild(strField('TikTok handle',m,'tiktok'));
  c1.appendChild(r); c1.appendChild(r2);
  c1.appendChild(biField('Address — Galápagos (HQ)',m,'address'));
  c1.appendChild(biField('Address — USA office (Florida)',m,'addressUs'));
  c1.appendChild(biField('Opening hours',m,'hours'));
  p.appendChild(c1);
  return p;
}
function panelHero(){
  const p=el('<div></div>'); const h=W.hero;
  const c=card('Hero headline','The big text on the home page.');
  c.appendChild(biField('Kicker (small label)',h,'kicker'));
  c.appendChild(biField('Title',h,'title'));
  c.appendChild(biField('Script line',h,'script'));
  c.appendChild(biField('Subtitle',h,'sub',true));
  p.appendChild(c);
  const ci=card('Hero slideshow images','These cross-fade behind the headline. Add, replace or remove.');
  function rebuild(){
    [...ci.querySelectorAll('.slide-row,.add-slide')].forEach(n=>n.remove());
    h.slides.forEach((src,i)=>{
      const row=el('<div class="slide-row" style="display:flex;gap:12px;align-items:center;margin-bottom:12px"></div>');
      const fakeObj={src:src};
      const f=imgField('Slide '+(i+1),fakeObj,'src');
      // bind back to array
      f.querySelectorAll('input').forEach(inp=>inp.addEventListener('input',()=>{h.slides[i]=fakeObj.src;}));
      f.querySelector('input[type=file]').addEventListener('change',()=>{ setTimeout(()=>{h.slides[i]=fakeObj.src;},60); });
      f.style.flex='1';
      const del=el('<button class="mini-btn danger" type="button">Remove</button>');
      del.addEventListener('click',()=>{ h.slides.splice(i,1); rebuild(); setDirty(); });
      row.appendChild(f); row.appendChild(del); ci.appendChild(row);
    });
    const add=el('<button class="add-btn add-slide" type="button">+ Add slide</button>');
    add.addEventListener('click',()=>{ h.slides.push('assets/img/kicker-day.jpg'); rebuild(); setDirty(); });
    ci.appendChild(add);
  }
  rebuild(); p.appendChild(ci);
  return p;
}
function listPanel(arr, opts){
  // opts: {title, hint, titleField(item), build(card,item,idx), template()}
  const p=el('<div></div>');
  function rebuild(){
    p.innerHTML='';
    arr.forEach((item,idx)=>{
      const c=card('','');
      const head=el('<div class="item-head"><h3 style="margin:0">'+opts.titleField(item)+'</h3></div>');
      const right=el('<div style="display:flex;gap:8px"></div>');
      const del=el('<button class="mini-btn danger" type="button">Delete</button>');
      del.addEventListener('click',()=>{ if(confirm('Delete this item?')){ arr.splice(idx,1); rebuild(); setDirty(); } });
      right.appendChild(del); head.appendChild(right);
      c.appendChild(head);
      const bodyWrap=el('<div style="margin-top:16px"></div>');
      opts.build(bodyWrap,item,idx, ()=>{ // onTitleChange
        head.querySelector('h3').textContent=opts.titleField(item);
      });
      c.appendChild(bodyWrap);
      p.appendChild(c);
    });
    const add=el('<button class="add-btn" type="button">+ '+opts.addLabel+'</button>');
    add.addEventListener('click',()=>{ arr.push(opts.template()); rebuild(); setDirty(); });
    p.appendChild(add);
  }
  rebuild(); return p;
}
function panelPackages(){
  return listPanel(W.packages,{
    addLabel:'Add package', titleField:it=>(it.name&&it.name.en?it.name.en:'Package')+' · '+(it.days&&it.days.en?it.days.en:''),
    template:()=>({id:'p'+Date.now(),img:'assets/img/lagoon.jpg',days:{en:'',es:''},nights:{en:'',es:''},price:0,popular:false,name:{en:'New package',es:''},blurb:{en:'',es:''},includes:[{en:'',es:''}]}),
    build:(c,it,idx,onTitle)=>{
      c.appendChild(imgField('Photo',it,'img'));
      const r=el('<div class="ed-row"></div>'); r.appendChild(biField('Days',it,'days')); r.appendChild(biField('Nights',it,'nights')); c.appendChild(r);
      const nm=biField('Name',it,'name'); nm.querySelectorAll('input').forEach(i=>i.addEventListener('input',onTitle)); c.appendChild(nm);
      c.appendChild(numField('Price (per person)',it,'price'));
      const pop=el('<div class="ed-field"><label style="display:flex;align-items:center;gap:9px;text-transform:none;letter-spacing:0;font-size:14px;cursor:pointer"><input type="checkbox" style="width:auto"> Mark as “Most Popular”</label></div>');
      const cb=pop.querySelector('input'); cb.checked=!!it.popular; cb.addEventListener('change',()=>{ if(cb.checked) W.packages.forEach(x=>x.popular=false); it.popular=cb.checked; setDirty(); });
      c.appendChild(pop);
      c.appendChild(includesEditor(it.includes));
    }
  });
}
function panelTours(){
  return listPanel(W.tours,{
    addLabel:'Add tour', titleField:it=>it.name&&it.name.en?it.name.en:'Tour',
    template:()=>({id:'t'+Date.now(),cat:'adventure',img:'assets/img/kicker-day.jpg',name:{en:'New tour',es:''},duration:{en:'',es:''},tag:{en:'Adventure',es:'Aventura'},price:0,priceLabel:{en:'per person',es:'por persona'},blurb:{en:'',es:''}}),
    build:(c,it,idx,onTitle)=>{
      c.appendChild(imgField('Photo',it,'img'));
      const nm=biField('Name',it,'name'); nm.querySelectorAll('input').forEach(i=>i.addEventListener('input',onTitle)); c.appendChild(nm);
      const r=el('<div class="ed-row"></div>');
      const catWrap=el('<div class="ed-field"><label>Category</label></div>');
      const sel=document.createElement('select');
      ['snorkeling','adventure','diving','private'].forEach(cat=>{ const o=document.createElement('option'); o.value=cat; o.textContent=cat; if(it.cat===cat)o.selected=true; sel.appendChild(o); });
      sel.addEventListener('change',()=>{it.cat=sel.value;setDirty();}); catWrap.appendChild(sel);
      r.appendChild(catWrap); r.appendChild(biField('Duration',it,'duration')); c.appendChild(r);
      c.appendChild(biField('Tag (badge)',it,'tag'));
      const r2=el('<div class="ed-row"></div>'); r2.appendChild(numField('Price (0 = custom quote)',it,'price')); r2.appendChild(biField('Price label',it,'priceLabel')); c.appendChild(r2);
      c.appendChild(biField('Description',it,'blurb',true));
    }
  });
}
function panelFishing(){
  const p=el('<div></div>'); const f=W.fishing;
  const c=card('Sport fishing intro','');
  c.appendChild(biField('Intro paragraph',f,'intro',true));
  c.appendChild(biField('Season note',f,'note',true));
  p.appendChild(c);
  const cs=card('Species','');
  cs.appendChild(includesEditor(f.species)); p.appendChild(cs);
  const ct=card('Charters & prices','Set price to 0 for “custom quote”.');
  const sub=listPanel(f.trips,{
    addLabel:'Add charter', titleField:it=>it.name&&it.name.en?it.name.en:'Charter',
    template:()=>({id:'f'+Date.now(),name:{en:'New charter',es:''},duration:{en:'',es:''},price:0}),
    build:(cc,it,idx,onTitle)=>{ const nm=biField('Name',it,'name'); nm.querySelectorAll('input').forEach(i=>i.addEventListener('input',onTitle)); cc.appendChild(nm); cc.appendChild(biField('Duration',it,'duration')); cc.appendChild(numField('Price',it,'price')); }
  });
  ct.appendChild(sub); p.appendChild(ct);
  const ci=card('Fishing photos','Shown in the rotating reel on the Sport Fishing page.');
  f.photos.forEach((src,i)=>{ const o={src:src}; const fld=imgField('Photo '+(i+1),o,'src'); fld.querySelectorAll('input').forEach(inp=>inp.addEventListener('input',()=>{f.photos[i]=o.src;})); fld.querySelector('input[type=file]').addEventListener('change',()=>setTimeout(()=>{f.photos[i]=o.src;},60)); ci.appendChild(fld); });
  p.appendChild(ci);
  return p;
}
function panelStory(){
  const p=el('<div></div>');
  const a=card('About / Our Story','');
  a.appendChild(biField('Title',W.about,'title'));
  a.appendChild(biField('Story (use a blank line for new paragraph)',W.about,'body',true));
  a.appendChild(imgField('About image',W.about,'image'));
  p.appendChild(a);
  const av=card('Values (4 cards)','');
  W.about.values.forEach((v,i)=>{ const r=el('<div style="border-top:1px solid var(--line-on-dark);padding-top:14px;margin-top:14px"></div>'); r.appendChild(biField('Value '+(i+1)+' title',v,'title')); r.appendChild(biField('Text',v,'text')); av.appendChild(r); });
  p.appendChild(av);
  const cz=card('Conservation','');
  cz.appendChild(biField('Title',W.conservation,'title'));
  cz.appendChild(biField('Body',W.conservation,'body',true));
  W.conservation.pillars.forEach((v,i)=>{ const r=el('<div style="border-top:1px solid var(--line-on-dark);padding-top:14px;margin-top:14px"></div>'); r.appendChild(biField('Pillar '+(i+1)+' title',v,'title')); r.appendChild(biField('Text',v,'text')); cz.appendChild(r); });
  p.appendChild(cz);
  return p;
}

function panelMessages(){
  const p=el('<div></div>');
  let msgs=[]; try{ msgs=JSON.parse(localStorage.getItem('GHA_MESSAGES')||'[]'); }catch(e){}
  const head=card('Inbox','Every booking and quote request made on the site lands here. To also receive these by email at '+(window.GHA_DEFAULT.meta.notifyEmail)+', paste a Formspree endpoint in “Site &amp; Contact”.');
  const bar=el('<div style="display:flex;gap:10px;align-items:center;justify-content:space-between"><h3 style="margin:0">'+msgs.length+' message'+(msgs.length===1?'':'s')+'</h3></div>');
  if(msgs.length){ const clr=el('<button class="mini-btn danger" type="button">Clear all</button>'); clr.addEventListener('click',()=>{ if(confirm('Delete all messages?')){ localStorage.removeItem('GHA_MESSAGES'); rebuild(); } }); bar.appendChild(clr); }
  head.appendChild(bar); p.appendChild(head);
  function fmt(ts){ try{ return new Date(ts).toLocaleString(); }catch(e){ return ''; } }
  function rebuild(){
    p.innerHTML=''; p.appendChild(head);
    try{ msgs=JSON.parse(localStorage.getItem('GHA_MESSAGES')||'[]'); }catch(e){ msgs=[]; }
    bar.querySelector('h3').textContent=msgs.length+' message'+(msgs.length===1?'':'s');
    if(!msgs.length){ p.appendChild(el('<div class="ed-card" style="text-align:center;color:rgba(255,255,255,.5)">No messages yet. Bookings and quote requests will appear here.</div>')); return; }
    msgs.forEach((m,idx)=>{
      const paid=m.status==='paid';
      const c=el('<div class="ed-card"></div>');
      c.innerHTML=
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">'
         +'<div><span style="display:inline-block;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:4px 10px;border-radius:30px;'+(paid?'background:#1f8a5b;color:#fff':'background:rgba(207,159,84,.25);color:#e4c98c')+'">'+(paid?'Paid booking':'Quote request')+'</span>'
           +'<div style="font-family:var(--display);font-weight:700;font-size:18px;color:var(--paper);margin-top:10px">'+(m.experience||'—')+'</div></div>'
         +'<div style="text-align:right;color:rgba(255,255,255,.5);font-size:12px">'+fmt(m.ts)+'</div>'
        +'</div>'
        +'<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px 18px;margin-top:14px;font-size:14px;color:rgba(255,255,255,.85)">'
         +'<div><span style="opacity:.55">Traveler:</span> '+(m.name||'')+'</div>'
         +'<div><span style="opacity:.55">Email:</span> <a href="mailto:'+(m.email||'')+'" style="color:#e4c98c">'+(m.email||'')+'</a></div>'
         +'<div><span style="opacity:.55">Travel date:</span> '+(m.date||'')+'</div>'
         +'<div><span style="opacity:.55">Guests:</span> '+(m.guests||'')+'</div>'
         +(paid?'<div><span style="opacity:.55">Paid:</span> <b style="color:#e4c98c">$'+(m.total||0).toLocaleString()+'</b></div><div><span style="opacity:.55">Card:</span> •••• '+(m.card||'')+'</div>':'<div style="grid-column:1/3"><span style="opacity:.55">Status:</span> Awaiting your custom quote</div>')
         +(m.message?'<div style="grid-column:1/3"><span style="opacity:.55">Message:</span> '+m.message+'</div>':'')
        +'</div>';
      const del=el('<button class="mini-btn danger" type="button" style="margin-top:14px">Delete</button>');
      del.addEventListener('click',()=>{ msgs.splice(idx,1); localStorage.setItem('GHA_MESSAGES',JSON.stringify(msgs)); rebuild(); });
      c.appendChild(del); p.appendChild(c);
    });
  }
  rebuild();
  return p;
}

const PANELS=[
  {id:'site',  label:'Site & Contact', build:panelSite},
  {id:'messages',label:'Messages',     build:panelMessages},
  {id:'hero',  label:'Home Hero',      build:panelHero},
  {id:'packages',label:'Packages',     build:panelPackages},
  {id:'tours', label:'Tours',          build:panelTours},
  {id:'fishing',label:'Sport Fishing', build:panelFishing},
  {id:'story', label:'About & Conservation', build:panelStory},
];

/* ============ ADMIN SHELL ============ */
function showAdmin(){
  shell.innerHTML=
   '<div class="admin-top">'
     +'<div class="brand-mini"><img src="assets/img/logo.png"><b>Hook Admin</b></div>'
     +'<div class="actions">'
       +'<span class="save-state" id="saveState"></span>'
       +'<a class="mini-btn" href="index.html" target="_blank">'+I.eye+' View site</a>'
       +'<button class="mini-btn" id="resetBtn">Reset all</button>'
       +'<button class="mini-btn" id="logoutBtn">'+I.out+' Log out</button>'
       +'<button class="btn btn-gold btn-sm" id="saveBtn">'+I.save+' Save changes</button>'
     +'</div>'
   +'</div>'
   +'<div class="admin-body">'
     +'<nav class="admin-nav" id="adminNav"></nav>'
     +'<main class="admin-main" id="adminMain"></main>'
   +'</div>';

  const nav=document.getElementById('adminNav');
  const main=document.getElementById('adminMain');
  let cache={};
  function open(id){
    nav.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.id===id));
    main.innerHTML='';
    const def=PANELS.find(x=>x.id===id);
    const head=el('<div><h2>'+def.label+'</h2></div>'); main.appendChild(head);
    const panel=el('<div class="panel active"></div>');
    panel.appendChild(def.build());
    main.appendChild(panel);
    main.scrollTo&&main.scrollTo(0,0); window.scrollTo(0,0);
  }
  PANELS.forEach(def=>{
    let badge='';
    if(def.id==='messages'){ let n=0; try{ n=JSON.parse(localStorage.getItem('GHA_MESSAGES')||'[]').length; }catch(e){} if(n) badge=' <span style="margin-left:auto;background:#cf9f54;color:#082420;font-size:11px;font-weight:800;border-radius:30px;padding:1px 8px">'+n+'</span>'; }
    const b=el('<button data-id="'+def.id+'" style="display:flex;align-items:center">'+def.label+badge+'</button>');
    b.addEventListener('click',()=>open(def.id)); nav.appendChild(b);
  });
  open('site');

  document.getElementById('saveBtn').addEventListener('click',()=>{
    try{ localStorage.setItem(CKEY, JSON.stringify(W)); }
    catch(e){ alert('Could not save — uploaded photos may be too large for browser storage. Try using image paths/URLs instead of uploads, or fewer uploads.'); return; }
    dirty=false; const s=document.getElementById('saveState'); s.textContent='✓ Saved'; s.classList.add('show');
    setTimeout(()=>s.classList.remove('show'),2600);
  });
  document.getElementById('resetBtn').addEventListener('click',()=>{
    if(confirm('Reset ALL content back to the original defaults? This cannot be undone.')){
      localStorage.removeItem(CKEY); W=loadWorking(); open('site');
      const s=document.getElementById('saveState'); s.textContent='Reset to defaults'; s.classList.add('show'); setTimeout(()=>s.classList.remove('show'),2600);
    }
  });
  document.getElementById('logoutBtn').addEventListener('click',()=>{
    if(dirty && !confirm('You have unsaved changes. Log out anyway?')) return;
    sessionStorage.removeItem(SKEY); showLogin();
  });
  window.addEventListener('beforeunload',e=>{ if(dirty){ e.preventDefault(); e.returnValue=''; } });
}

/* ============ boot ============ */
if(sessionStorage.getItem(SKEY)==='1') showAdmin(); else showLogin();
})();
