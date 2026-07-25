/* =========================================================
   GALÁPAGOS HOOK ADVENTURE — Admin
   Owner login + live content editor. Saves to localStorage
   (GHA_CONTENT) which every page reads on load.
   ========================================================= */
(function(){
"use strict";

const CKEY="GHA_CONTENT";              // editor de contenido LOCAL/legacy (solo este navegador, ver docs)
const shell=document.getElementById('shell');
const ES=(function(){ try{ return localStorage.getItem('GHA_LANG')==='es'; }catch(e){ return false; } })();

/* ---- API helpers (sesión por cookie HttpOnly; el navegador nunca accede a Supabase) ---- */
function apiGet(url){ return fetch(url,{headers:{Accept:'application/json'},credentials:'same-origin'}).then(handleRes); }
function apiPost(url, body){ return fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},credentials:'same-origin',body:JSON.stringify(body||{})}).then(handleRes); }
function handleRes(res){ return res.json().catch(function(){return {};}).then(function(data){ return {ok:res.ok,status:res.status,data:data}; }); }
function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
let adminToastTimer;
function adminToast(msg){
  let t=document.querySelector('.toast');
  if(!t){ t=document.createElement('div'); t.className='toast'; t.setAttribute('role','alert'); t.setAttribute('aria-live','assertive'); document.body.appendChild(t); }
  t.textContent=msg; requestAnimationFrame(function(){ t.classList.add('show'); });
  clearTimeout(adminToastTimer); adminToastTimer=setTimeout(function(){ t.classList.remove('show'); },3200);
}
function onUnauthorized(){ adminToast(ES?'Tu sesión expiró. Inicia sesión nuevamente.':'Your session expired. Please sign in again.'); showLogin(); }

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
   +'<div class="err" id="loginErr"></div>'
   +'<div class="field"><label>Password</label><input type="password" id="aPass" autocomplete="current-password" required></div>'
   +'<button type="submit" class="btn btn-gold btn-block" id="loginBtn" style="margin-top:8px">Log in</button>'
   +'<p style="margin:16px 0 0"><a href="index.html" style="color:var(--sea);font-weight:600;font-size:13px">← Back to site</a></p>'
   +'</form></div>';
  const btn=document.getElementById('loginBtn'), errEl=document.getElementById('loginErr');
  document.getElementById('loginForm').addEventListener('submit',function(e){
    e.preventDefault();
    const pw=document.getElementById('aPass').value;
    if(!pw) return;
    errEl.classList.remove('show'); btn.disabled=true; const lbl=btn.textContent; btn.textContent=ES?'Ingresando…':'Signing in…';
    apiPost('/api/admin-login',{password:pw}).then(function(r){
      if(r.ok && r.data && r.data.authenticated){ showAdmin(); return; }
      errEl.textContent=ES?'Contraseña incorrecta.':'Invalid password.'; errEl.classList.add('show');
      btn.disabled=false; btn.textContent=lbl;
    }).catch(function(){
      errEl.textContent=ES?'No pudimos iniciar sesión. Inténtalo nuevamente.':'We could not sign you in. Please try again.'; errEl.classList.add('show');
      btn.disabled=false; btn.textContent=lbl;
    });
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

/* ============ BOOKINGS (fuente de verdad: Supabase vía /api) ============ */
function bkSelectField(label, options){
  const wrap=el('<div class="ed-field"><label>'+label+'</label></div>');
  const s=document.createElement('select');
  options.forEach(function(o){ const opt=document.createElement('option'); opt.value=o[0]; opt.textContent=o[1]; s.appendChild(opt); });
  wrap.appendChild(s); return {wrap:wrap, select:s};
}
function bkDateField(label){
  const wrap=el('<div class="ed-field"><label>'+label+'</label></div>');
  const i=document.createElement('input'); i.type='date'; wrap.appendChild(i); return {wrap:wrap, input:i};
}
function bkRow(label,val){ return '<div><span style="opacity:.55">'+label+':</span> '+val+'</div>'; }
function bkFmtDT(s){ if(!s) return '—'; try{ return new Date(s).toLocaleString(ES?'es-ES':'en-US'); }catch(e){ return escapeHtml(s); } }
function bkFmtMoney(b){
  if(b.amount_cents==null || b.request_type==='quote') return ES?'Cotización':'Quote';
  try{ return new Intl.NumberFormat('en-US',{style:'currency',currency:String(b.currency||'usd').toUpperCase()}).format(b.amount_cents/100); }
  catch(e){ return '$'+(b.amount_cents/100); }
}
function bkPill(text,bg,color){ return '<span style="display:inline-block;font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;padding:4px 10px;border-radius:30px;background:'+bg+';color:'+color+'">'+escapeHtml(text)+'</span>'; }
function bkPayBadge(s){
  const m={ paid:['#1f8a5b','#fff'], pending:['rgba(207,159,84,.25)','#e4c98c'], processing:['rgba(207,159,84,.25)','#e4c98c'], failed:['rgba(200,70,50,.25)','#ffb3a3'], refunded:['rgba(120,120,200,.28)','#c7c9ff'], not_required:['rgba(255,255,255,.12)','rgba(255,255,255,.75)'] };
  const c=m[s]||['rgba(255,255,255,.12)','#fff']; return '<span style="opacity:.55;font-size:11px">'+(ES?'Pago':'Payment')+'</span> '+bkPill(s,c[0],c[1]);
}
function bkBookBadge(s){
  const m={ confirmed:['#1f8a5b','#fff'], completed:['rgba(90,160,120,.30)','#bfe8cf'], new:['rgba(255,255,255,.12)','rgba(255,255,255,.8)'], pending_payment:['rgba(207,159,84,.25)','#e4c98c'], cancelled:['rgba(200,70,50,.25)','#ffb3a3'], failed:['rgba(200,70,50,.25)','#ffb3a3'] };
  const c=m[s]||['rgba(255,255,255,.12)','#fff']; return '<span style="opacity:.55;font-size:11px">'+(ES?'Reserva':'Booking')+'</span> '+bkPill(s,c[0],c[1]);
}
function bkBookingCard(b){
  const c=el('<div class="ed-card"></div>');
  const isQuote=b.request_type==='quote';
  c.innerHTML=
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">'
      +'<div><div style="font-family:var(--body);font-weight:800;letter-spacing:.04em;color:#e4c98c;font-size:13px">'+escapeHtml(b.booking_code||'')+'</div>'
        +'<div style="font-family:var(--display);font-weight:700;font-size:18px;color:var(--paper);margin-top:4px">'+escapeHtml(b.tour_name||'—')+'</div>'
        +'<div style="margin-top:9px;display:flex;gap:14px;flex-wrap:wrap;align-items:center">'+bkPayBadge(b.payment_status)+bkBookBadge(b.booking_status)+'</div></div>'
      +'<div style="text-align:right;color:#e4c98c;font-weight:800;font-size:18px">'+bkFmtMoney(b)+'</div>'
    +'</div>'
    +'<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px 18px;margin-top:16px;font-size:14px;color:rgba(255,255,255,.85)">'
      +bkRow(ES?'Tipo':'Type', isQuote?(ES?'Cotización':'Quote request'):(ES?'Reserva':'Booking'))
      +bkRow(ES?'Cliente':'Customer', escapeHtml(b.customer_name))
      +bkRow('Email','<a href="mailto:'+escapeHtml(b.customer_email)+'" style="color:#e4c98c">'+escapeHtml(b.customer_email)+'</a>')
      +(b.customer_phone?bkRow(ES?'Teléfono':'Phone', escapeHtml(b.customer_phone)):'')
      +bkRow(ES?'Fecha de viaje':'Travel date', escapeHtml(b.booking_date))
      +bkRow('Guests', escapeHtml(b.guests))
      +bkRow(ES?'Creada':'Created', bkFmtDT(b.created_at))
      +(b.paid_at?bkRow(ES?'Pagada':'Paid at', bkFmtDT(b.paid_at)):'')
      +(b.notes?'<div style="grid-column:1/3">'+bkRow(ES?'Notas':'Notes', escapeHtml(b.notes))+'</div>':'')
    +'</div>';
  const ctrl=el('<div style="margin-top:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"></div>');
  const sel=document.createElement('select'); sel.style.cssText='padding:9px 12px;border-radius:7px;background:rgba(255,255,255,.07);color:var(--paper);border:1.5px solid var(--line-on-dark);font-family:var(--body)';
  ['new','pending_payment','confirmed','cancelled','completed','failed'].forEach(function(s){ const o=document.createElement('option'); o.value=s; o.textContent=s; if(b.booking_status===s)o.selected=true; sel.appendChild(o); });
  const upd=el('<button class="mini-btn" type="button">'+(ES?'Actualizar estado':'Update status')+'</button>');
  upd.addEventListener('click',function(){
    const ns=sel.value; if(ns===b.booking_status) return;
    if(b.payment_status==='paid' && ns==='cancelled'){
      if(!confirm(ES?'Cancelar esta reserva no reembolsará el pago de Stripe. ¿Deseas continuar?':'Canceling this booking will not refund the Stripe payment. Continue?')){ sel.value=b.booking_status; return; }
    }
    upd.disabled=true; const lbl=upd.textContent; upd.textContent=ES?'Guardando…':'Saving…';
    apiPost('/api/admin-booking-update',{booking_id:b.id,booking_status:ns}).then(function(r){
      if(r.status===401){ onUnauthorized(); return; }
      if(!r.ok || !r.data || !r.data.booking){ upd.disabled=false; upd.textContent=lbl; adminToast(ES?'No se pudo actualizar. Inténtalo nuevamente.':'Could not update. Please try again.'); return; }
      c.replaceWith(bkBookingCard(r.data.booking)); adminToast(ES?'Reserva actualizada':'Booking updated');
    }).catch(function(){ upd.disabled=false; upd.textContent=lbl; adminToast(ES?'No se pudo actualizar. Inténtalo nuevamente.':'Could not update. Please try again.'); });
  });
  ctrl.appendChild(sel); ctrl.appendChild(upd); c.appendChild(ctrl);
  return c;
}
function panelBookings(){
  const p=el('<div></div>');
  const state={ page:1, limit:25, loading:false };

  const fcard=card('', '');
  const r1=el('<div class="ed-row"></div>');
  const searchWrap=el('<div class="ed-field"><label>'+(ES?'Buscar':'Search')+'</label></div>');
  const searchInput=document.createElement('input'); searchInput.maxLength=100; searchInput.placeholder=ES?'Código, nombre, correo o tour':'Code, name, email or tour'; searchWrap.appendChild(searchInput);
  const typeF=bkSelectField(ES?'Tipo':'Type',[['',ES?'Todos':'All'],['booking',ES?'Reserva':'Booking'],['quote',ES?'Cotización':'Quote']]);
  r1.appendChild(searchWrap); r1.appendChild(typeF.wrap);
  const r2=el('<div class="ed-row"></div>');
  const payF=bkSelectField(ES?'Estado de pago':'Payment status',[['',ES?'Todos':'All'],['not_required','not_required'],['pending','pending'],['processing','processing'],['paid','paid'],['failed','failed'],['refunded','refunded']]);
  const bookF=bkSelectField(ES?'Estado de reserva':'Booking status',[['',ES?'Todos':'All'],['new','new'],['pending_payment','pending_payment'],['confirmed','confirmed'],['cancelled','cancelled'],['completed','completed'],['failed','failed']]);
  r2.appendChild(payF.wrap); r2.appendChild(bookF.wrap);
  const r3=el('<div class="ed-row"></div>');
  const fromF=bkDateField(ES?'Desde':'From'); const toF=bkDateField(ES?'Hasta':'To');
  r3.appendChild(fromF.wrap); r3.appendChild(toF.wrap);
  const r4=el('<div class="ed-row"></div>');
  const sortF=bkSelectField(ES?'Orden':'Sort',[['newest',ES?'Más recientes':'Newest'],['oldest',ES?'Más antiguas':'Oldest'],['booking_date_asc',ES?'Fecha viaje ↑':'Travel date ↑'],['booking_date_desc',ES?'Fecha viaje ↓':'Travel date ↓']]);
  const applyWrap=el('<div class="ed-field" style="display:flex;align-items:flex-end"></div>');
  const applyBtn=el('<button class="btn btn-gold btn-sm" type="button" style="width:100%">'+(ES?'Aplicar filtros':'Apply filters')+'</button>');
  applyWrap.appendChild(applyBtn); r4.appendChild(sortF.wrap); r4.appendChild(applyWrap);
  fcard.appendChild(r1); fcard.appendChild(r2); fcard.appendChild(r3); fcard.appendChild(r4);
  p.appendChild(fcard);

  const listWrap=el('<div></div>'); p.appendChild(listWrap);
  const pager=el('<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin:6px 2px 0;color:rgba(255,255,255,.7);font-size:13px"></div>');
  const prevBtn=el('<button class="mini-btn" type="button">'+(ES?'‹ Anterior':'‹ Prev')+'</button>');
  const nextBtn=el('<button class="mini-btn" type="button">'+(ES?'Siguiente ›':'Next ›')+'</button>');
  const pageInfo=el('<span></span>');
  pager.appendChild(prevBtn); pager.appendChild(pageInfo); pager.appendChild(nextBtn); p.appendChild(pager);

  function buildQS(){
    const q=['page='+state.page,'limit='+state.limit];
    const s=searchInput.value.trim().slice(0,100); if(s) q.push('search='+encodeURIComponent(s));
    if(typeF.select.value) q.push('request_type='+typeF.select.value);
    if(payF.select.value) q.push('payment_status='+payF.select.value);
    if(bookF.select.value) q.push('booking_status='+bookF.select.value);
    if(fromF.input.value) q.push('date_from='+fromF.input.value);
    if(toF.input.value) q.push('date_to='+toF.input.value);
    if(sortF.select.value) q.push('sort='+sortF.select.value);
    return q.join('&');
  }
  function load(){
    if(state.loading) return; state.loading=true; applyBtn.disabled=true; prevBtn.disabled=true; nextBtn.disabled=true;
    listWrap.innerHTML='<div class="ed-card" style="text-align:center;color:rgba(255,255,255,.5)">'+(ES?'Cargando…':'Loading…')+'</div>';
    apiGet('/api/admin-bookings?'+buildQS()).then(function(r){
      state.loading=false; applyBtn.disabled=false;
      if(r.status===401){ onUnauthorized(); return; }
      if(!r.ok){ listWrap.innerHTML='<div class="ed-card" style="text-align:center;color:#ffb3a3">'+(ES?'No pudimos cargar las reservas. Inténtalo nuevamente.':'We could not load the bookings. Please try again.')+'</div>'; return; }
      const list=(r.data&&r.data.bookings)||[]; const pg=(r.data&&r.data.pagination)||{page:1,totalPages:1,total:0};
      listWrap.innerHTML='';
      if(!list.length) listWrap.appendChild(el('<div class="ed-card" style="text-align:center;color:rgba(255,255,255,.5)">'+(ES?'No hay reservas para estos filtros.':'No bookings for these filters.')+'</div>'));
      list.forEach(function(b){ listWrap.appendChild(bkBookingCard(b)); });
      state.page=pg.page||1;
      pageInfo.textContent=(ES?'Página ':'Page ')+(pg.page||1)+' / '+(pg.totalPages||1)+' · '+(pg.total||0)+(ES?' registros':' records');
      prevBtn.disabled=(pg.page||1)<=1; nextBtn.disabled=(pg.page||1)>=(pg.totalPages||1);
    }).catch(function(){
      state.loading=false; applyBtn.disabled=false;
      listWrap.innerHTML='<div class="ed-card" style="text-align:center;color:#ffb3a3">'+(ES?'No pudimos cargar las reservas. Inténtalo nuevamente.':'We could not load the bookings. Please try again.')+'</div>';
    });
  }
  applyBtn.addEventListener('click',function(){ state.page=1; load(); });
  searchInput.addEventListener('keydown',function(e){ if(e.key==='Enter'){ state.page=1; load(); } });
  prevBtn.addEventListener('click',function(){ if(state.page>1){ state.page--; load(); } });
  nextBtn.addEventListener('click',function(){ state.page++; load(); });
  load();
  return p;
}

const PANELS=[
  {id:'bookings',label:(ES?'Reservas':'Bookings'), build:panelBookings},
  {id:'site',  label:'Site & Contact', build:panelSite},
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
    const b=el('<button data-id="'+def.id+'" style="display:flex;align-items:center">'+def.label+'</button>');
    b.addEventListener('click',()=>open(def.id)); nav.appendChild(b);
  });
  open('bookings');

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
    apiPost('/api/admin-logout',{}).then(function(){ showLogin(); }).catch(function(){ showLogin(); });
  });
  window.addEventListener('beforeunload',e=>{ if(dirty){ e.preventDefault(); e.returnValue=''; } });
}

/* ============ boot ============ */
apiGet('/api/admin-session').then(function(r){ if(r.ok && r.data && r.data.authenticated) showAdmin(); else showLogin(); }).catch(function(){ showLogin(); });
})();
