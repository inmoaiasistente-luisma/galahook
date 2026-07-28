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
   +'<div class="field"><label>Email</label><input type="email" id="aEmail" autocomplete="username" required></div>'
   +'<div class="field"><label>Password</label><input type="password" id="aPass" autocomplete="current-password" required></div>'
   +'<button type="submit" class="btn btn-gold btn-block" id="loginBtn" style="margin-top:8px">Log in</button>'
   +'<p style="margin:16px 0 0"><a href="index.html" style="color:var(--sea);font-weight:600;font-size:13px">← Back to site</a></p>'
   +'</form></div>';
  const btn=document.getElementById('loginBtn'), errEl=document.getElementById('loginErr');
  document.getElementById('loginForm').addEventListener('submit',function(e){
    e.preventDefault();
    const em=document.getElementById('aEmail').value.trim();
    const pw=document.getElementById('aPass').value;
    if(!em||!pw) return;
    errEl.classList.remove('show'); btn.disabled=true; const lbl=btn.textContent; btn.textContent=ES?'Ingresando…':'Signing in…';
    apiPost('/api/admin-login',{email:em,password:pw}).then(function(r){
      if(r.ok && r.data && r.data.authenticated){ showAdmin(r.data.user); return; }
      const code=r.data && r.data.error;
      errEl.textContent = (code==='NO_ACCESS')
        ? (ES?'No tienes acceso a este panel.':'You do not have access to this panel.')
        : (ES?'Correo o contraseña incorrectos.':'Invalid email or password.');
      errEl.classList.add('show'); btn.disabled=false; btn.textContent=lbl;
    }).catch(function(){
      errEl.textContent=ES?'No pudimos iniciar sesión. Inténtalo nuevamente.':'We could not sign you in. Please try again.'; errEl.classList.add('show');
      btn.disabled=false; btn.textContent=lbl;
    });
  });
}
/* Etiquetas de rol para la interfaz */
function roleLabel(role){
  if(role==='owner') return ES?'Administrador maestro':'Master administrator';
  if(role==='admin') return ES?'Administrador':'Administrator';
  if(role==='staff') return ES?'Personal operativo':'Staff';
  return '';
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

/* ============ RESERVAS · calendario + tabla + detalle ============
   Fuente de verdad: Supabase vía /api/admin-bookings.
   Los permisos los impone SIEMPRE el servidor; aquí solo se adapta la UI. */

/* ---- fechas (siempre en horario local, sin desfase de zona) ---- */
function bkPad(n){ return String(n).padStart(2,'0'); }
function bkYmd(d){ return d.getFullYear()+'-'+bkPad(d.getMonth()+1)+'-'+bkPad(d.getDate()); }
function bkParseYmd(s){ const p=String(s||'').split('-'); return new Date(+p[0],(+p[1]||1)-1,(+p[2]||1)); }
function bkToday(){ return bkYmd(new Date()); }
function bkMonthBounds(y,m){ return [bkYmd(new Date(y,m,1)), bkYmd(new Date(y,m+1,0))]; }
function bkMonthLabel(y,m){
  try{ return bkParseYmd(bkYmd(new Date(y,m,1))).toLocaleDateString(ES?'es-ES':'en-US',{month:'long',year:'numeric'}); }
  catch(e){ return (m+1)+'/'+y; }
}
function bkDayLabel(s){
  try{ return bkParseYmd(s).toLocaleDateString(ES?'es-ES':'en-US',{day:'numeric',month:'long'}); }
  catch(e){ return s; }
}
function bkFmtDate(s){ if(!s) return '—'; try{ return bkParseYmd(s).toLocaleDateString(ES?'es-ES':'en-US',{day:'2-digit',month:'short'}); }catch(e){ return escapeHtml(s); } }
function bkFmtDT(s){ if(!s) return '—'; try{ return new Date(s).toLocaleString(ES?'es-ES':'en-US'); }catch(e){ return escapeHtml(s); } }
function bkMoney(cents, cur){
  if(cents==null) return '—';
  try{ return new Intl.NumberFormat('en-US',{style:'currency',currency:String(cur||'usd').toUpperCase()}).format(cents/100); }
  catch(e){ return '$'+(cents/100); }
}

/* ---- badges compactos (color + texto siempre visible) ---- */
const BK_PAY_KIND ={paid:'ok',pending:'warn',processing:'warn',failed:'bad',refunded:'muted',not_required:'info'};
const BK_BOOK_KIND={confirmed:'ok',pending_payment:'warn',new:'info',cancelled:'bad',completed:'muted',failed:'bad'};
function bkBadge(txt,kind){ return '<span class="bdg bdg-'+(kind||'muted')+'">'+escapeHtml(txt||'')+'</span>'; }

/* ---- campos de filtro ---- */
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

/* ---- consultas ---- */
function bkQS(o){
  const q=[];
  Object.keys(o).forEach(function(k){ const v=o[k]; if(v!==''&&v!=null) q.push(k+'='+encodeURIComponent(v)); });
  return q.join('&');
}
/* Descarga el rango completo (paginando) para agregar el calendario. */
function bkFetchAll(params, maxPages){
  const out=[]; const max=maxPages||6; let page=1;
  function step(){
    return apiGet('/api/admin-bookings?'+bkQS(Object.assign({},params,{page:page,limit:100}))).then(function(r){
      if(r.status===401){ onUnauthorized(); return null; }
      if(!r.ok) throw new Error('load');
      const list=(r.data&&r.data.bookings)||[]; const pg=(r.data&&r.data.pagination)||{};
      out.push.apply(out,list);
      if(page<(pg.totalPages||1) && page<max){ page++; return step(); }
      return {rows:out, truncated:(pg.totalPages||1)>max};
    });
  }
  return step();
}

/* ---- detalle (modal compacto) ---- */
function bkModal(){
  let m=document.getElementById('bkDetail');
  if(!m){
    m=el('<div class="bk-modal" id="bkDetail"><div class="bk-modal-card" role="dialog" aria-modal="true">'
      +'<button class="bk-modal-x" type="button" aria-label="Close">&times;</button>'
      +'<div class="bk-modal-body"></div></div></div>');
    document.body.appendChild(m);
    m.addEventListener('click',function(e){ if(e.target===m) bkCloseModal(); });
    m.querySelector('.bk-modal-x').addEventListener('click',bkCloseModal);
    document.addEventListener('keydown',function(e){ if(e.key==='Escape') bkCloseModal(); });
  }
  return m;
}
function bkCloseModal(){ const m=document.getElementById('bkDetail'); if(m) m.classList.remove('open'); }
function bkDl(label,val){ return '<div class="bk-dl"><span>'+label+'</span><b>'+val+'</b></div>'; }
function bkMailTo(v){ return v?('<a href="mailto:'+escapeHtml(v)+'">'+escapeHtml(v)+'</a>'):'—'; }
function bkTelTo(v){ return v?('<a href="tel:'+escapeHtml(v)+'">'+escapeHtml(v)+'</a>'):'—'; }

/* Detalle de STAFF: solo lectura, sin datos financieros y SIN controles. */
function bkStaffDetail(b){
  const m=bkModal(), body=m.querySelector('.bk-modal-body');
  body.innerHTML='<h3>'+escapeHtml(b.booking_code||'')+'</h3>'
    +'<div class="bk-dls">'
      +bkDl('Tour', escapeHtml(b.tour_name||'—'))
      +bkDl(ES?'Fecha':'Date', escapeHtml(b.booking_date||'—'))
      +bkDl(ES?'Viajeros':'Guests', escapeHtml(b.guests))
      +bkDl(ES?'Cliente':'Customer', escapeHtml(b.customer_name||'—'))
      +bkDl('Email', bkMailTo(b.customer_email))
      +bkDl(ES?'Teléfono':'Phone', bkTelTo(b.customer_phone))
      +(b.notes?bkDl(ES?'Notas':'Notes', escapeHtml(b.notes)):'')
    +'</div>';
  m.classList.add('open');
}
/* ---- QR operativo (owner/admin) ----
   El PNG llega en base64 desde el servidor al rotar; para el QR vigente se
   descarga bajo demanda. Nunca se guarda el token en el navegador. */
function bkQrPanel(b){
  const box=el('<div class="bk-sub"></div>');
  box.innerHTML='<h4>'+(ES?'Código QR':'QR code')+'</h4>'
    +'<p class="bk-sub-hint">'+(ES?'El cliente lo recibe por correo. Escanéalo el día del tour con la cámara del teléfono.'
                                  :'The customer receives it by email. Scan it on the tour day with the phone camera.')+'</p>';
  const imgWrap=el('<div class="bk-qr-img"></div>');
  const acts=el('<div class="bk-sub-acts"></div>');
  const rotateB=el('<button class="mini-btn" type="button">'+(ES?'Rotar QR':'Rotate QR')+'</button>');
  const revokeB=el('<button class="mini-btn danger" type="button">'+(ES?'Revocar QR':'Revoke QR')+'</button>');
  const dlB=el('<a class="mini-btn" style="display:none">'+(ES?'Descargar QR':'Download QR')+'</a>');
  const msg=el('<div class="bk-sub-msg"></div>');

  function showPng(base64, filename, url){
    imgWrap.innerHTML='<img alt="QR" src="data:image/png;base64,'+base64+'">'
      +'<div class="bk-qr-url">'+escapeHtml(url||'')+'</div>';
    dlB.href='data:image/png;base64,'+base64; dlB.download=filename||'qr.png'; dlB.style.display='';
  }
  rotateB.addEventListener('click',function(){
    if(!confirm(ES?'Al rotar, el QR que ya recibió el cliente dejará de funcionar de inmediato. ¿Continuar?'
                  :'Rotating will immediately invalidate the QR the customer already received. Continue?')) return;
    rotateB.disabled=true; const lbl=rotateB.textContent; rotateB.textContent=ES?'Rotando…':'Rotating…';
    apiPost('/api/admin-booking-qr-rotate',{booking_id:b.id}).then(function(r){
      rotateB.disabled=false; rotateB.textContent=lbl;
      if(r.status===401){ onUnauthorized(); return; }
      if(!r.ok||!r.data||!r.data.pngBase64){ msg.className='bk-sub-msg err'; msg.textContent=ES?'No se pudo rotar el QR.':'Could not rotate the QR.'; return; }
      showPng(r.data.pngBase64, r.data.filename, r.data.qrUrl);
      msg.className='bk-sub-msg warn';
      msg.textContent=ES?'QR rotado. El anterior quedó invalidado: descarga el nuevo y envíaselo al cliente.'
                        :'QR rotated. The previous one is now invalid: download the new one and send it to the customer.';
      adminToast(ES?'QR rotado':'QR rotated');
    }).catch(function(){ rotateB.disabled=false; rotateB.textContent=lbl; msg.className='bk-sub-msg err'; msg.textContent=ES?'Error de conexión.':'Connection error.'; });
  });
  revokeB.addEventListener('click',function(){
    if(!confirm(ES?'Revocar dejará el QR inservible para el check-in. ¿Continuar?':'Revoking will make the QR unusable for check-in. Continue?')) return;
    revokeB.disabled=true;
    apiPost('/api/admin-booking-qr-revoke',{booking_id:b.id}).then(function(r){
      revokeB.disabled=false;
      if(r.status===401){ onUnauthorized(); return; }
      if(!r.ok){ msg.className='bk-sub-msg err'; msg.textContent=ES?'No se pudo revocar.':'Could not revoke.'; return; }
      imgWrap.innerHTML=''; dlB.style.display='none';
      msg.className='bk-sub-msg err'; msg.textContent=ES?'QR revocado. Usa "Rotar QR" para emitir uno nuevo.':'QR revoked. Use "Rotate QR" to issue a new one.';
      adminToast(ES?'QR revocado':'QR revoked');
    }).catch(function(){ revokeB.disabled=false; });
  });
  acts.appendChild(rotateB); acts.appendChild(revokeB); acts.appendChild(dlB);
  box.appendChild(imgWrap); box.appendChild(acts); box.appendChild(msg);
  return box;
}

/* ---- estado de notificaciones (owner/admin) ---- */
const BK_NOTIF_KIND={sent:'ok',pending:'warn',sending:'warn',failed:'bad',skipped:'muted'};
function bkNotifPanel(b){
  const box=el('<div class="bk-sub"></div>');
  box.innerHTML='<h4>'+(ES?'Notificaciones':'Notifications')+'</h4>';
  const list=el('<div class="bk-notifs"></div>');
  box.appendChild(list);
  function load(){
    list.innerHTML='<div class="bk-sub-hint">'+(ES?'Cargando…':'Loading…')+'</div>';
    apiGet('/api/admin-booking-notifications?booking_id='+encodeURIComponent(b.id)).then(function(r){
      if(r.status===401){ onUnauthorized(); return; }
      if(!r.ok||!r.data){ list.innerHTML='<div class="bk-sub-msg err">'+(ES?'No se pudo cargar.':'Could not load.')+'</div>'; return; }
      const rows=r.data.notifications||[];
      if(!rows.length){ list.innerHTML='<div class="bk-sub-hint">'+(ES?'Sin correos registrados.':'No emails recorded.')+'</div>'; return; }
      list.innerHTML='';
      rows.forEach(function(n){
        const line=el('<div class="bk-notif"></div>');
        line.innerHTML='<div class="bk-notif-main"><b>'+escapeHtml(n.notification_type)+'</b>'
          +'<small>'+escapeHtml(n.recipient_email)+' · '+(ES?'intentos':'attempts')+' '+escapeHtml(n.attempts)+'</small></div>'
          +'<div>'+bkBadge(n.status, BK_NOTIF_KIND[n.status])+'</div>';
        if(n.status==='failed'){
          const rb=el('<button class="mini-btn" type="button">'+(ES?'Reintentar':'Retry')+'</button>');
          rb.addEventListener('click',function(){
            rb.disabled=true; rb.textContent=ES?'Enviando…':'Sending…';
            apiPost('/api/admin-email-retry',{notification_id:n.id}).then(function(rr){
              if(rr.status===401){ onUnauthorized(); return; }
              adminToast(rr.ok&&rr.data&&rr.data.status==='sent'
                ? (ES?'Correo enviado':'Email sent')
                : (ES?'No se pudo enviar':'Could not send'));
              load();
            }).catch(function(){ rb.disabled=false; rb.textContent=ES?'Reintentar':'Retry'; });
          });
          line.appendChild(rb);
        }
        list.appendChild(line);
      });
    }).catch(function(){ list.innerHTML='<div class="bk-sub-msg err">'+(ES?'No se pudo cargar.':'Could not load.')+'</div>'; });
  }
  load();
  return box;
}

/* Detalle de OWNER/ADMIN: información completa + cambio de booking_status. */
function bkAdminDetail(b, onUpdated){
  const m=bkModal(), body=m.querySelector('.bk-modal-body');
  const isQuote=b.request_type==='quote';
  body.innerHTML='<h3>'+escapeHtml(b.booking_code||'')+'</h3>'
    +'<div class="bk-dls">'
      +bkDl('Tour', escapeHtml(b.tour_name||'—'))
      +bkDl(ES?'Tipo':'Type', isQuote?(ES?'Cotización':'Quote request'):(ES?'Reserva':'Booking'))
      +bkDl(ES?'Fecha':'Date', escapeHtml(b.booking_date||'—'))
      +bkDl(ES?'Viajeros':'Guests', escapeHtml(b.guests))
      +bkDl(ES?'Cliente':'Customer', escapeHtml(b.customer_name||'—'))
      +bkDl('Email', bkMailTo(b.customer_email))
      +bkDl(ES?'Teléfono':'Phone', bkTelTo(b.customer_phone))
      +bkDl(ES?'Importe':'Amount', isQuote?(ES?'Cotización':'Quote'):bkMoney(b.amount_cents,b.currency))
      +bkDl(ES?'Pago':'Payment', bkBadge(b.payment_status, BK_PAY_KIND[b.payment_status]))
      +bkDl(ES?'Reserva':'Booking', bkBadge(b.booking_status, BK_BOOK_KIND[b.booking_status]))
      +bkDl(ES?'Canal':'Channel', b.sales_channel==='agency'?(ES?'Agencia (venta directa)':'Agency (direct sale)'):'Web (Stripe)')
      +(b.payment_method?bkDl(ES?'Método de pago':'Payment method', escapeHtml(b.payment_method)):'')
      +(b.created_by_name?bkDl(ES?'Registró':'Recorded by', escapeHtml(b.created_by_name)):'')
      +(b.sold_at?bkDl(ES?'Fecha de venta':'Sold at', bkFmtDT(b.sold_at)):'')
      +bkDl(ES?'Pagada':'Paid at', bkFmtDT(b.paid_at))
      +bkDl(ES?'Creada':'Created', bkFmtDT(b.created_at))
      +(b.notes?bkDl(ES?'Notas':'Notes', escapeHtml(b.notes)):'')
    +'</div>';
  /* QR y notificaciones: solo para reservas pagadas y confirmadas/completadas.
     Ambos bloques son exclusivos de owner/admin (este detalle no se usa en staff). */
  if(b.payment_status==='paid' && (b.booking_status==='confirmed'||b.booking_status==='completed')){
    body.appendChild(bkQrPanel(b));
    body.appendChild(bkNotifPanel(b));
  }

  const ctrl=el('<div class="bk-modal-actions"></div>');
  const sel=document.createElement('select');
  ['new','pending_payment','confirmed','cancelled','completed','failed'].forEach(function(s){
    const o=document.createElement('option'); o.value=s; o.textContent=s; if(b.booking_status===s)o.selected=true; sel.appendChild(o);
  });
  const btn=el('<button class="btn btn-gold btn-sm" type="button">'+(ES?'Actualizar estado':'Update status')+'</button>');
  btn.addEventListener('click',function(){
    const ns=sel.value; if(ns===b.booking_status){ bkCloseModal(); return; }
    if(b.payment_status==='paid' && ns==='cancelled'){
      if(!confirm(ES?'Cancelar esta reserva no reembolsará el pago de Stripe. ¿Deseas continuar?':'Canceling this booking will not refund the Stripe payment. Continue?')){ sel.value=b.booking_status; return; }
    }
    btn.disabled=true; const lbl=btn.textContent; btn.textContent=ES?'Guardando…':'Saving…';
    apiPost('/api/admin-booking-update',{booking_id:b.id,booking_status:ns}).then(function(r){
      if(r.status===401){ onUnauthorized(); return; }
      if(!r.ok || !r.data || !r.data.booking){ btn.disabled=false; btn.textContent=lbl; adminToast(ES?'No se pudo actualizar. Inténtalo nuevamente.':'Could not update. Please try again.'); return; }
      adminToast(ES?'Reserva actualizada':'Booking updated');
      bkCloseModal(); if(onUpdated) onUpdated(r.data.booking);
    }).catch(function(){ btn.disabled=false; btn.textContent=lbl; adminToast(ES?'No se pudo actualizar. Inténtalo nuevamente.':'Could not update. Please try again.'); });
  });
  ctrl.appendChild(sel); ctrl.appendChild(btn); body.appendChild(ctrl);
  m.classList.add('open');
}

/* ---- venta directa (agencia / teléfono / presencial) ----
   Disponible para owner, admin y staff. El servidor fija vendedor,
   fecha contable, canal y estados: aquí solo se capturan los datos. */
const BK_METHODS=[['cash',ES?'Efectivo':'Cash'],['card',ES?'Tarjeta':'Card'],['bank_transfer',ES?'Transferencia':'Bank transfer'],['zelle','Zelle'],['other',ES?'Otro':'Other']];
function bkAgencyForm(onCreated){
  const m=bkModal(), body=m.querySelector('.bk-modal-body');
  const rid=(window.crypto&&crypto.randomUUID)?crypto.randomUUID():String(Date.now())+'-'+Math.random().toString(16).slice(2);
  function fld(label,input){ const w=el('<div class="ed-field"><label>'+label+'</label></div>'); w.appendChild(input); return w; }
  function inp(type,attrs){ const i=document.createElement('input'); i.type=type||'text'; Object.keys(attrs||{}).forEach(function(k){ i[k]=attrs[k]; }); return i; }

  body.innerHTML='<h3>'+(ES?'Añadir venta directa':'Add agency booking')+'</h3>';
  const name=inp('text',{maxLength:120}), phone=inp('tel',{maxLength:40}), mail=inp('email',{maxLength:254});
  const tourSel=document.createElement('select');
  const optCustom=document.createElement('option'); optCustom.value='custom'; optCustom.textContent=ES?'Otro destino (escribir)':'Other destination (type it)';
  tourSel.appendChild(optCustom);
  (window.GHA_DEFAULT?[].concat(GHA_DEFAULT.packages||[],GHA_DEFAULT.tours||[],(GHA_DEFAULT.fishing&&GHA_DEFAULT.fishing.trips)||[]):[]).forEach(function(t){
    if(!t||!t.id) return; const o=document.createElement('option'); o.value=t.id;
    o.textContent=(t.name&&(t.name.en||t.name.es))||t.id; tourSel.appendChild(o);
  });
  const tourFree=inp('text',{maxLength:160, placeholder:ES?'Destino personalizado':'Custom destination'});
  const date=inp('date'), guests=inp('number',{min:1,max:50,value:2});
  const amount=inp('number',{min:0,step:'0.01',placeholder:'0.00'});
  const method=document.createElement('select');
  BK_METHODS.forEach(function(x){ const o=document.createElement('option'); o.value=x[0]; o.textContent=x[1]; method.appendChild(o); });
  const notes=document.createElement('textarea'); notes.maxLength=1000; notes.style.minHeight='64px';

  const g=el('<div class="bk-dls"></div>');
  g.appendChild(fld((ES?'Cliente':'Customer')+' *',name));
  g.appendChild(fld((ES?'Teléfono':'Phone')+' *',phone));
  g.appendChild(fld('Email ('+(ES?'opcional':'optional')+')',mail));
  g.appendChild(fld((ES?'Tour / destino':'Tour / destination')+' *',tourSel));
  g.appendChild(fld(ES?'Destino personalizado':'Custom destination',tourFree));
  g.appendChild(fld((ES?'Fecha del tour':'Tour date')+' *',date));
  g.appendChild(fld((ES?'Viajeros':'Guests')+' *',guests));
  g.appendChild(fld((ES?'Importe cobrado (USD)':'Amount received (USD)')+' *',amount));
  g.appendChild(fld((ES?'Método de pago':'Payment method')+' *',method));
  body.appendChild(g);
  const nw=fld(ES?'Notas':'Notes',notes); nw.style.marginTop='10px'; body.appendChild(nw);

  function syncTour(){ tourFree.parentNode.style.display = (tourSel.value==='custom')?'':'none'; }
  tourSel.addEventListener('change',syncTour); syncTour();

  const acts=el('<div class="bk-modal-actions"></div>');
  const err=el('<span class="bk-form-err"></span>');
  const save=el('<button class="btn btn-gold btn-sm" type="button">'+(ES?'Registrar venta':'Record booking')+'</button>');
  save.addEventListener('click',function(){
    err.textContent='';
    const cents=Math.round(parseFloat(amount.value||'0')*100);
    if(!name.value.trim()||name.value.trim().length<2){ err.textContent=ES?'Indica el nombre del cliente.':'Customer name is required.'; return; }
    if(!phone.value.trim()||phone.value.trim().length<5){ err.textContent=ES?'Indica el teléfono.':'Phone is required.'; return; }
    if(tourSel.value==='custom' && tourFree.value.trim().length<2){ err.textContent=ES?'Indica el destino.':'Destination is required.'; return; }
    if(!date.value){ err.textContent=ES?'Indica la fecha del tour.':'Tour date is required.'; return; }
    const gN=parseInt(guests.value||'0',10);
    if(!(gN>=1&&gN<=50)){ err.textContent=ES?'Viajeros entre 1 y 50.':'Guests must be between 1 and 50.'; return; }
    if(!(cents>=1&&cents<=100000000)){ err.textContent=ES?'Importe inválido.':'Invalid amount.'; return; }

    // Solo campos autorizados: los estados, el vendedor y la fecha contable los pone el servidor.
    const payload={ request_id:rid, customer_name:name.value.trim(), customer_phone:phone.value.trim(),
      booking_date:date.value, guests:gN, amount_cents:cents, payment_method:method.value };
    if(mail.value.trim()) payload.customer_email=mail.value.trim();
    if(notes.value.trim()) payload.notes=notes.value.trim();
    if(tourSel.value==='custom'){ payload.tour_id='custom'; payload.tour_name=tourFree.value.trim(); }
    else { payload.tour_id=tourSel.value; }

    save.disabled=true; const lbl=save.textContent; save.textContent=ES?'Guardando…':'Saving…';
    apiPost('/api/admin-agency-booking-create',payload).then(function(r){
      if(r.status===401){ onUnauthorized(); return; }
      if(!r.ok||!r.data||!r.data.booking){
        save.disabled=false; save.textContent=lbl;
        err.textContent=ES?'No se pudo registrar la venta. Revisa los datos.':'Could not record the booking. Please check the details.';
        return;
      }
      const code=r.data.booking.booking_code||'';
      adminToast((ES?'Venta registrada correctamente. Código de reserva: ':'Agency booking recorded successfully. Booking code: ')+code);
      bkCloseModal(); if(onCreated) onCreated();
    }).catch(function(){
      save.disabled=false; save.textContent=lbl;
      err.textContent=ES?'Error de conexión. Inténtalo nuevamente.':'Connection error. Please try again.';
    });
  });
  acts.appendChild(save); acts.appendChild(err); body.appendChild(acts);
  m.classList.add('open');
  setTimeout(function(){ name.focus(); },80);
}

/* ---- filas de la tabla (una fila por reserva, sin tarjetas) ---- */
function bkAdminRow(b, open){
  const tr=document.createElement('tr');
  const isQuote=b.request_type==='quote';
  tr.innerHTML='<td>'+bkFmtDate(b.booking_date)+'</td>'
    +'<td class="mono">'+escapeHtml(b.booking_code||'')+'</td>'
    +'<td class="ell">'+escapeHtml(b.tour_name||'')+'</td>'
    +'<td class="ell">'+escapeHtml(b.customer_name||'')+'</td>'
    +'<td>'+escapeHtml(b.customer_phone||'—')+'</td>'
    +'<td class="num">'+escapeHtml(b.guests)+'</td>'
    +'<td class="num">'+(isQuote?(ES?'Cotización':'Quote'):bkMoney(b.amount_cents,b.currency))+'</td>'
    +'<td>'+bkBadge(b.payment_status, BK_PAY_KIND[b.payment_status])+'</td>'
    +'<td>'+bkBadge(b.booking_status, BK_BOOK_KIND[b.booking_status])+'</td>'
    +'<td>'+(b.sales_channel==='agency'
        ? bkBadge(ES?'agencia':'agency','info')+(b.payment_method?' <small class="bk-meth">'+escapeHtml(b.payment_method)+'</small>':'')
        : bkBadge('web','muted'))+'</td>';
  const td=document.createElement('td');
  const btn=el('<button class="mini-btn" type="button">'+(ES?'Ver':'View')+'</button>');
  btn.addEventListener('click',function(e){ e.stopPropagation(); open(b); });
  td.appendChild(btn); tr.appendChild(td);
  tr.addEventListener('dblclick',function(){ open(b); });
  return tr;
}
/* Fila de STAFF: sin columnas financieras y SIN botones ni selects. */
function bkStaffRow(b, open){
  const tr=document.createElement('tr');
  tr.innerHTML='<td>'+bkFmtDate(b.booking_date)+'</td>'
    +'<td class="mono">'+escapeHtml(b.booking_code||'')+'</td>'
    +'<td class="ell">'+escapeHtml(b.tour_name||'')+'</td>'
    +'<td class="ell">'+escapeHtml(b.customer_name||'')+'</td>'
    +'<td>'+escapeHtml(b.customer_phone||'—')+'</td>'
    +'<td class="num">'+escapeHtml(b.guests)+'</td>'
    +'<td class="ell">'+escapeHtml(b.notes||'')+'</td>';
  tr.addEventListener('dblclick',function(){ open(b); });
  return tr;
}

/* ---- pantalla completa: resumen + calendario + filtros + tabla ---- */
function bkScreen(o){
  const isStaff=!!o.isStaff;
  const p=el('<div class="bk-screen"></div>');
  const now=new Date();
  const state={ y:now.getFullYear(), m:now.getMonth(), selected:null, page:1, limit:25, monthRows:[], busyCal:false, busyTbl:false };
  const weekStart=ES?1:0;
  const DOW=ES?['Do','Lu','Ma','Mi','Ju','Vi','Sá']:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  /* --- resumen del mes --- */
  const summary=el('<div class="bk-sum"></div>');
  const finance=el('<div class="bk-sum bk-fin"></div>');   // vacío para staff: nunca se rellena
  function chip(label,val){ return '<span class="bk-chip"><i>'+label+'</i><b>'+val+'</b></span>'; }

  /* --- calendario --- */
  const monthTitle=el('<b class="bk-cal-title"></b>');
  const prevB=el('<button class="mini-btn" type="button" aria-label="'+(ES?'Mes anterior':'Previous month')+'">‹</button>');
  const todayB=el('<button class="mini-btn" type="button">'+(ES?'Hoy':'Today')+'</button>');
  const nextB=el('<button class="mini-btn" type="button" aria-label="'+(ES?'Mes siguiente':'Next month')+'">›</button>');
  const calHead=el('<div class="bk-cal-head"></div>');
  const navL=el('<div class="bk-cal-nav"></div>'); navL.appendChild(prevB); navL.appendChild(todayB); navL.appendChild(nextB);
  calHead.appendChild(monthTitle); calHead.appendChild(navL);
  const calDow=el('<div class="bk-cal-dow"></div>');
  for(let i=0;i<7;i++) calDow.appendChild(el('<span>'+DOW[(weekStart+i)%7]+'</span>'));
  const calGrid=el('<div class="bk-cal-grid"></div>');
  const cal=el('<div class="bk-cal"></div>'); cal.appendChild(calHead); cal.appendChild(calDow); cal.appendChild(calGrid);
  p.appendChild(summary); if(!isStaff) p.appendChild(finance); p.appendChild(cal);

  /* --- filtros --- */
  const fcard=el('<div class="bk-filters"></div>');
  const searchWrap=el('<div class="ed-field"><label>'+(ES?'Buscar':'Search')+'</label></div>');
  const searchInput=document.createElement('input'); searchInput.maxLength=100;
  searchInput.placeholder=ES?'Código, cliente o tour':'Code, customer or tour'; searchWrap.appendChild(searchInput);
  const fromF=bkDateField(ES?'Desde':'From'), toF=bkDateField(ES?'Hasta':'To');
  let typeF=null, payF=null, bookF=null, sortF=null, chanF=null, methF=null;
  const row1=el('<div class="bk-frow"></div>'); row1.appendChild(searchWrap); row1.appendChild(fromF.wrap); row1.appendChild(toF.wrap);
  fcard.appendChild(row1);
  if(!isStaff){
    typeF=bkSelectField(ES?'Tipo':'Type',[['',ES?'Todos':'All'],['booking',ES?'Reserva':'Booking'],['quote',ES?'Cotización':'Quote']]);
    payF =bkSelectField(ES?'Estado de pago':'Payment status',[['',ES?'Todos':'All'],['not_required','not_required'],['pending','pending'],['processing','processing'],['paid','paid'],['failed','failed'],['refunded','refunded']]);
    bookF=bkSelectField(ES?'Estado de reserva':'Booking status',[['',ES?'Todos':'All'],['new','new'],['pending_payment','pending_payment'],['confirmed','confirmed'],['cancelled','cancelled'],['completed','completed'],['failed','failed']]);
    sortF=bkSelectField(ES?'Orden':'Sort',[['newest',ES?'Más recientes':'Newest'],['oldest',ES?'Más antiguas':'Oldest'],['booking_date_asc',ES?'Fecha viaje ↑':'Travel date ↑'],['booking_date_desc',ES?'Fecha viaje ↓':'Travel date ↓']]);
    chanF=bkSelectField(ES?'Canal':'Channel',[['',ES?'Todos':'All'],['web','web'],['agency',ES?'agencia':'agency']]);
    methF=bkSelectField(ES?'Método de pago':'Payment method',[['',ES?'Todos':'All'],['stripe','stripe'],['cash','cash'],['card','card'],['bank_transfer','bank_transfer'],['zelle','zelle'],['other','other']]);
    const row2=el('<div class="bk-frow"></div>');
    row2.appendChild(typeF.wrap); row2.appendChild(payF.wrap); row2.appendChild(bookF.wrap); row2.appendChild(sortF.wrap);
    const row3=el('<div class="bk-frow"></div>');
    row3.appendChild(chanF.wrap); row3.appendChild(methF.wrap);
    fcard.appendChild(row2); fcard.appendChild(row3);
  }
  const btns=el('<div class="bk-fbtns"></div>');
  const applyB=el('<button class="btn btn-gold btn-sm" type="button">'+(ES?'Aplicar':'Apply')+'</button>');
  const dayB  =el('<button class="mini-btn" type="button">'+(ES?'Hoy':'Today')+'</button>');
  const monthB=el('<button class="mini-btn" type="button">'+(ES?'Este mes':'This month')+'</button>');
  const allB  =el('<button class="mini-btn" type="button">'+(ES?'Ver todo':'View all')+'</button>');
  btns.appendChild(applyB); btns.appendChild(dayB); btns.appendChild(monthB); btns.appendChild(allB);
  /* Venta directa: disponible para los tres roles. */
  const agencyB=el('<button class="btn btn-gold btn-sm" type="button">+ '+(ES?'Añadir venta directa':'Add agency booking')+'</button>');
  agencyB.style.marginLeft='auto';
  agencyB.addEventListener('click',function(){ bkAgencyForm(function(){ loadCal(); loadTable(); loadFinance(); }); });
  btns.appendChild(agencyB);
  fcard.appendChild(btns);
  p.appendChild(fcard);

  /* --- tabla --- */
  const tblTitle=el('<div class="bk-tbl-title"></div>');
  const COLS = isStaff
    ? [ES?'Fecha':'Date', ES?'Código':'Code', 'Tour', ES?'Cliente':'Customer', ES?'Teléfono':'Phone', ES?'Viajeros':'Guests', ES?'Notas':'Notes']
    : [ES?'Fecha':'Date', ES?'Código':'Code', 'Tour', ES?'Cliente':'Customer', ES?'Teléfono':'Phone', ES?'Viajeros':'Guests', 'Total', ES?'Pago':'Payment', ES?'Reserva':'Booking', ES?'Canal':'Channel', ES?'Acciones':'Actions'];
  const wrap=el('<div class="bk-table-wrap"></div>');
  const table=el('<table class="bk-table"><thead><tr>'+COLS.map(function(c){return '<th>'+c+'</th>';}).join('')+'</tr></thead><tbody></tbody></table>');
  const tbody=table.querySelector('tbody');
  wrap.appendChild(table);
  p.appendChild(tblTitle); p.appendChild(wrap);

  const pager=el('<div class="bk-pager"></div>');
  const prevP=el('<button class="mini-btn" type="button">'+(ES?'‹ Anterior':'‹ Prev')+'</button>');
  const nextP=el('<button class="mini-btn" type="button">'+(ES?'Siguiente ›':'Next ›')+'</button>');
  const pageInfo=el('<span></span>');
  pager.appendChild(prevP); pager.appendChild(pageInfo); pager.appendChild(nextP);
  p.appendChild(pager);

  /* --- estado → parámetros --- */
  function baseParams(){
    const q={};
    const s=searchInput.value.trim().slice(0,100); if(s) q.search=s;
    if(!isStaff){
      if(typeF.select.value) q.request_type=typeF.select.value;
      if(payF.select.value)  q.payment_status=payF.select.value;
      if(bookF.select.value) q.booking_status=bookF.select.value;
      if(chanF.select.value) q.sales_channel=chanF.select.value;
      if(methF.select.value) q.payment_method=methF.select.value;
    }
    return q;
  }
  function tableParams(){
    const q=baseParams();
    q.page=state.page; q.limit=state.limit;
    q.sort = isStaff ? 'booking_date_asc' : (sortF.select.value||'newest');
    if(state.selected){ q.date_from=state.selected; q.date_to=state.selected; }
    else { if(fromF.input.value) q.date_from=fromF.input.value; if(toF.input.value) q.date_to=toF.input.value; }
    return q;
  }

  /* --- render del calendario + resumen --- */
  function renderCal(){
    monthTitle.textContent=bkMonthLabel(state.y,state.m);
    const agg={};
    state.monthRows.forEach(function(b){
      const k=b.booking_date; if(!k) return;
      const a=agg[k]||(agg[k]={n:0,g:0,q:0});
      if(b.request_type==='quote') a.q++; else { a.n++; a.g+=(+b.guests||0); }
    });
    const first=new Date(state.y,state.m,1);
    const offset=(first.getDay()-weekStart+7)%7;
    const start=new Date(state.y,state.m,1-offset);
    const today=bkToday();
    calGrid.innerHTML='';
    for(let i=0;i<42;i++){
      const d=new Date(start.getFullYear(),start.getMonth(),start.getDate()+i);
      const key=bkYmd(d), out=d.getMonth()!==state.m, a=agg[key];
      const cell=el('<button type="button" class="bk-cal-day'+(out?' out':'')+(key===today?' today':'')+(state.selected===key?' sel':'')+'"></button>');
      let h='<span class="d">'+d.getDate()+'</span>';
      if(a&&a.n){ h+='<span class="c">'+a.n+' '+(ES?(a.n===1?'reserva':'reservas'):(a.n===1?'booking':'bookings'))+'</span>'
                   +'<span class="c">'+a.g+' '+(ES?'personas':'guests')+'</span>'; }
      if(!isStaff&&a&&a.q) h+='<span class="c q">'+a.q+' '+(ES?'cotiz.':'quotes')+'</span>';
      cell.innerHTML=h;
      cell.addEventListener('click',function(){ toggleDay(key); });
      calGrid.appendChild(cell);
    }
    renderSummary();
  }
  function renderSummary(){
    const rows=state.monthRows;
    if(isStaff){
      const g=rows.reduce(function(s,b){ return s+(+b.guests||0); },0);
      summary.innerHTML=chip(ES?'Reservas confirmadas':'Confirmed bookings',rows.length)+chip(ES?'Personas':'Guests',g);
      return;
    }
    // Conteos operativos (no financieros) del mes visible.
    const books=rows.filter(function(b){ return b.request_type!=='quote'; });
    const quotes=rows.length-books.length;
    const conf=books.filter(function(b){ return b.booking_status==='confirmed'; }).length;
    const pend=books.filter(function(b){ return b.payment_status==='pending'||b.payment_status==='processing'; }).length;
    summary.innerHTML=chip(ES?'Reservas':'Bookings',books.length)+chip(ES?'Confirmadas':'Confirmed',conf)
      +chip(ES?'Pendientes':'Pending',pend)+chip(ES?'Cotizaciones':'Quotes',quotes);
  }
  /* Importes SIEMPRE del servidor (/api/admin-finance-summary), agregados por
     sold_at = fecha de caja. El navegador nunca suma reservas. */
  function loadFinance(){
    if(isStaff) return;                       // staff no accede a información financiera
    const b=bkMonthBounds(state.y,state.m);
    const q={ date_from: fromF.input.value || b[0], date_to: toF.input.value || b[1] };
    if(chanF.select.value) q.channel=chanF.select.value;
    if(methF.select.value) q.payment_method=methF.select.value;
    apiGet('/api/admin-finance-summary?'+bkQS(q)).then(function(r){
      if(r.status===401){ onUnauthorized(); return; }
      if(!r.ok||!r.data||!r.data.revenue){ finance.innerHTML=''; return; }
      const d=r.data, m=d.by_method||{};
      function meth(k,label){ const v=m[k]||{amount_cents:0,count:0}; return v.count?chip(label,bkMoney(v.amount_cents,'usd')):''; }
      finance.innerHTML='<span class="bk-fin-lab">'+(ES?'Caja del período (por fecha de venta)':'Period revenue (by sale date)')+'</span>'
        +chip(ES?'Web':'Web',bkMoney(d.revenue.web,'usd'))
        +chip(ES?'Agencia':'Agency',bkMoney(d.revenue.agency,'usd'))
        +chip(ES?'Total':'Total',bkMoney(d.revenue.total,'usd'))
        +chip(ES?'Ventas':'Sales',d.counts.total)
        +meth('cash',ES?'Efectivo':'Cash')+meth('card',ES?'Tarjeta':'Card')
        +meth('bank_transfer',ES?'Transferencia':'Transfer')+meth('zelle','Zelle')+meth('other',ES?'Otro':'Other');
    }).catch(function(){ finance.innerHTML=''; });
  }

  /* --- carga --- */
  function loadCal(){
    if(state.busyCal) return; state.busyCal=true;
    const b=bkMonthBounds(state.y,state.m);
    const q=baseParams(); q.date_from=b[0]; q.date_to=b[1]; q.sort='booking_date_asc';
    bkFetchAll(q,6).then(function(res){
      state.busyCal=false; if(!res) return;
      state.monthRows=res.rows; renderCal();
    }).catch(function(){ state.busyCal=false; state.monthRows=[]; renderCal(); });
  }
  function openDetail(b){ if(isStaff) bkStaffDetail(b); else bkAdminDetail(b,function(){ loadTable(); loadCal(); }); }
  function loadTable(){
    if(state.busyTbl) return; state.busyTbl=true;
    applyB.disabled=true; prevP.disabled=true; nextP.disabled=true;
    tblTitle.textContent = state.selected
      ? (ES?('Reservas del '+bkDayLabel(state.selected)):('Bookings for '+bkDayLabel(state.selected)))
      : (ES?'Todas las reservas':'All bookings');
    tbody.innerHTML='<tr><td class="bk-empty" colspan="'+COLS.length+'">'+(ES?'Cargando…':'Loading…')+'</td></tr>';
    apiGet('/api/admin-bookings?'+bkQS(tableParams())).then(function(r){
      state.busyTbl=false; applyB.disabled=false;
      if(r.status===401){ onUnauthorized(); return; }
      if(!r.ok){ tbody.innerHTML='<tr><td class="bk-empty err" colspan="'+COLS.length+'">'+(ES?'No pudimos cargar las reservas. Inténtalo nuevamente.':'We could not load the bookings. Please try again.')+'</td></tr>'; return; }
      const list=(r.data&&r.data.bookings)||[]; const pg=(r.data&&r.data.pagination)||{page:1,totalPages:1,total:0};
      tbody.innerHTML='';
      if(!list.length){ tbody.innerHTML='<tr><td class="bk-empty" colspan="'+COLS.length+'">'+(ES?'Sin reservas para estos filtros.':'No bookings for these filters.')+'</td></tr>'; }
      else list.forEach(function(b){ tbody.appendChild(isStaff?bkStaffRow(b,openDetail):bkAdminRow(b,openDetail)); });
      state.page=pg.page||1;
      pageInfo.textContent=(ES?'Página ':'Page ')+(pg.page||1)+' / '+(pg.totalPages||1)+' · '+(pg.total||0)+(ES?' registros':' records');
      prevP.disabled=(pg.page||1)<=1; nextP.disabled=(pg.page||1)>=(pg.totalPages||1);
    }).catch(function(){
      state.busyTbl=false; applyB.disabled=false;
      tbody.innerHTML='<tr><td class="bk-empty err" colspan="'+COLS.length+'">'+(ES?'No pudimos cargar las reservas. Inténtalo nuevamente.':'We could not load the bookings. Please try again.')+'</td></tr>';
    });
  }

  /* --- interacción --- */
  function toggleDay(key){
    state.selected = (state.selected===key) ? null : key;   // segundo clic quita el filtro
    if(state.selected){ fromF.input.value=state.selected; toF.input.value=state.selected; }
    else { const b=bkMonthBounds(state.y,state.m); fromF.input.value=b[0]; toF.input.value=b[1]; }
    state.page=1; renderCal(); loadTable();
  }
  function goMonth(y,m){
    state.y=y; state.m=m; state.selected=null; state.page=1;
    const b=bkMonthBounds(y,m); fromF.input.value=b[0]; toF.input.value=b[1];
    loadCal(); loadTable(); loadFinance();
  }
  prevB.addEventListener('click',function(){ const d=new Date(state.y,state.m-1,1); goMonth(d.getFullYear(),d.getMonth()); });
  nextB.addEventListener('click',function(){ const d=new Date(state.y,state.m+1,1); goMonth(d.getFullYear(),d.getMonth()); });
  todayB.addEventListener('click',function(){ const d=new Date(); goMonth(d.getFullYear(),d.getMonth()); });
  monthB.addEventListener('click',function(){ const d=new Date(); goMonth(d.getFullYear(),d.getMonth()); });
  dayB.addEventListener('click',function(){
    const d=new Date(); state.y=d.getFullYear(); state.m=d.getMonth(); state.selected=bkToday();
    fromF.input.value=state.selected; toF.input.value=state.selected; state.page=1;
    loadCal(); loadTable(); loadFinance();
  });
  allB.addEventListener('click',function(){
    state.selected=null; fromF.input.value=''; toF.input.value=''; state.page=1;
    renderCal(); loadTable(); loadFinance();
  });
  applyB.addEventListener('click',function(){ state.selected=null; state.page=1; loadCal(); loadTable(); loadFinance(); });
  searchInput.addEventListener('keydown',function(e){ if(e.key==='Enter'){ state.selected=null; state.page=1; loadCal(); loadTable(); loadFinance(); } });
  [fromF.input,toF.input].forEach(function(i){ i.addEventListener('change',function(){ state.selected=null; state.page=1; loadTable(); loadFinance(); }); });
  prevP.addEventListener('click',function(){ if(state.page>1){ state.page--; loadTable(); } });
  nextP.addEventListener('click',function(){ state.page++; loadTable(); });

  /* --- arranque: mes actual --- */
  (function(){ const b=bkMonthBounds(state.y,state.m); fromF.input.value=b[0]; toF.input.value=b[1]; })();
  loadCal(); loadTable(); loadFinance();
  return p;
}

function panelBookings(){ return bkScreen({isStaff:false}); }
function panelStaffSchedule(){ return bkScreen({isStaff:true}); }

/* ============ FINANZAS (owner/admin) ============
   owner puede gestionar costos y descuentos; admin solo consulta. El
   servidor es la autoridad: aquí solo se muestran totales y se envían
   configuraciones (nunca se recalcula dinero en el navegador). */
function fin$(c){ return bkMoney(c,'usd'); }
function panelFinance(role){
  const canEdit = role==='owner' || role==='admin';
  const wrap=el('<div class="fin-wrap"></div>');

  /* ---- filtros ---- */
  const filters=el('<div class="ed-row fin-filters"></div>');
  const fromF=bkDateField(ES?'Desde (venta)':'From (sale)');
  const toF=bkDateField(ES?'Hasta (venta)':'To (sale)');
  const tourF=bkSelectField('Tour',[['',ES?'Todos':'All']]);
  const chanF=bkSelectField(ES?'Canal':'Channel',[['',ES?'Todos':'All'],['web','web'],['agency',ES?'Agencia':'Agency']]);
  const methF=bkSelectField(ES?'Método':'Method',[['',ES?'Todos':'All'],['stripe','stripe'],['cash','cash'],['card','card'],['bank_transfer','bank_transfer'],['zelle','zelle'],['other','other']]);
  [fromF,toF,tourF,chanF,methF].forEach(function(f){ filters.appendChild(f.wrap); });
  wrap.appendChild(filters);

  /* ---- KPIs + tabla por tour ---- */
  const tiles=el('<div class="fin-tiles"></div>');
  const partial=el('<div class="fin-partial" style="display:none"></div>');
  const tourWrap=el('<div class="bk-table-wrap fin-tourtable"></div>');
  wrap.appendChild(tiles); wrap.appendChild(partial); wrap.appendChild(tourWrap);

  function tile(lab,val,cls){ return '<div class="fin-tile'+(cls?' '+cls:'')+'"><span>'+lab+'</span><b>'+val+'</b></div>'; }
  function loadSummary(){
    const q={};
    if(fromF.input.value) q.date_from=fromF.input.value;
    if(toF.input.value) q.date_to=toF.input.value;
    if(tourF.select.value) q.tour_id=tourF.select.value;
    if(chanF.select.value) q.channel=chanF.select.value;
    if(methF.select.value) q.payment_method=methF.select.value;
    tiles.innerHTML='<div class="bk-sub-hint">'+(ES?'Cargando…':'Loading…')+'</div>';
    apiGet('/api/admin-finance-summary?'+bkQS(q)).then(function(r){
      if(r.status===401){ onUnauthorized(); return; }
      if(r.status===403){ tiles.innerHTML='<div class="bk-sub-hint">'+(ES?'Sin acceso.':'No access.')+'</div>'; return; }
      if(!r.ok||!r.data){ tiles.innerHTML=''; return; }
      const d=r.data;
      tiles.innerHTML=
        tile(ES?'Ingresos brutos':'Gross revenue', fin$(d.gross_revenue_cents))
       +tile(ES?'Descuentos':'Discounts', '−'+fin$(d.discounts_cents))
       +tile(ES?'Ingresos netos':'Net revenue', fin$(d.net_revenue_cents),'strong')
       +tile(ES?'Costos conocidos':'Known costs', fin$(d.known_costs_cents))
       +tile(ES?'Utilidad conocida':'Known profit', fin$(d.gross_profit_cents),'strong')
       +tile(ES?'Margen':'Margin', (d.margin_percent!=null?d.margin_percent+'%':'—'))
       +tile(ES?'Ventas':'Sales', d.total_sales)
       +tile('Pax', d.total_pax)
       +tile(ES?'Ingreso por pax':'Revenue / pax', fin$(d.revenue_per_pax_cents))
       +tile(ES?'Costo por pax':'Cost / pax', fin$(d.known_cost_per_pax_cents))
       +tile(ES?'Utilidad por pax':'Profit / pax', fin$(d.known_profit_per_pax_cents))
       +tile(ES?'Ventas sin costo':'Sales missing cost', d.missing_cost_sales_count, d.missing_cost_sales_count>0?'warn':'');
      partial.style.display=d.profit_is_partial?'':'none';
      partial.textContent=d.profit_is_partial
        ? (ES?'Utilidad PARCIAL: '+d.missing_cost_sales_count+' venta(s) sin costo configurado no se descuentan.'
             :'Profit is PARTIAL: '+d.missing_cost_sales_count+' sale(s) without a configured cost are not deducted.')
        : '';
      /* tabla por tour */
      const rows=(d.by_tour||[]).map(function(t){
        return '<tr><td>'+escapeHtml(t.tour_name)+'</td><td class="num">'+t.sales+'</td><td class="num">'+t.pax+'</td>'
          +'<td class="num">'+fin$(t.gross_revenue_cents)+'</td><td class="num">−'+fin$(t.discounts_cents)+'</td>'
          +'<td class="num">'+fin$(t.net_revenue_cents)+'</td><td class="num">'+fin$(t.known_costs_cents)+'</td>'
          +'<td class="num">'+fin$(t.known_profit_cents)+'</td>'
          +'<td class="num">'+(t.missing_cost_sales_count>0?('<span class="bdg bdg-warn">'+t.missing_cost_sales_count+'</span>'):'0')+'</td></tr>';
      }).join('');
      tourWrap.innerHTML='<table class="bk-table"><thead><tr>'
        +'<th>Tour</th><th>'+(ES?'Ventas':'Sales')+'</th><th>Pax</th><th>'+(ES?'Bruto':'Gross')+'</th><th>'+(ES?'Desc.':'Disc.')+'</th>'
        +'<th>'+(ES?'Neto':'Net')+'</th><th>'+(ES?'Costo':'Cost')+'</th><th>'+(ES?'Utilidad':'Profit')+'</th><th>'+(ES?'Sin costo':'No cost')+'</th></tr></thead>'
        +'<tbody>'+(rows||'<tr><td colspan="9" class="bk-sub-hint">'+(ES?'Sin ventas en el período.':'No sales in range.')+'</td></tr>')+'</tbody></table>';
    }).catch(function(){ tiles.innerHTML=''; });
  }
  [fromF.input,toF.input].forEach(function(i){ i.addEventListener('change',loadSummary); });
  [tourF.select,chanF.select,methF.select].forEach(function(s){ s.addEventListener('change',loadSummary); });

  /* ---- COSTOS por tour ---- */
  const costSec=el('<div class="fin-sec"><h3>'+(ES?'Costos por tour':'Costs per tour')+'</h3>'
    +'<p class="bk-sub-hint">'+(canEdit?(ES?'Cambiar un costo NO altera reservas ya creadas; solo afecta a las nuevas.':'Changing a cost does NOT alter existing bookings; only new ones.')
                                        :(ES?'Solo lectura.':'Read-only.'))+'</p></div>');
  const costWrap=el('<div class="bk-table-wrap"></div>'); costSec.appendChild(costWrap);
  wrap.appendChild(costSec);

  function loadTours(){
    apiGet('/api/admin-finance-settings').then(function(r){
      if(r.status===401){ onUnauthorized(); return; }
      if(!r.ok||!r.data){ costWrap.innerHTML=''; return; }
      const list=r.data.settings||[];
      /* filtro y select de descuentos usan estos tours */
      const opts=list.map(function(t){ return [t.tour_id, (t.tour_name&&(t.tour_name.en||t.tour_name.es||t.tour_name))||t.tour_id]; });
      const cur=tourF.select.value;
      tourF.select.innerHTML=''; [['',ES?'Todos':'All']].concat(opts).forEach(function(o){ const op=document.createElement('option'); op.value=o[0]; op.textContent=o[1]; tourF.select.appendChild(op); });
      tourF.select.value=cur;
      if(discTourSel){ const dc=discTourSel.value; discTourSel.innerHTML=''; [['',ES?'Todos los tours':'All tours']].concat(opts).forEach(function(o){ const op=document.createElement('option'); op.value=o[0]; op.textContent=o[1]; discTourSel.appendChild(op); }); discTourSel.value=dc; }
      const head='<table class="bk-table"><thead><tr><th>Tour</th><th>'+(ES?'Costo fijo':'Fixed cost')+'</th><th>'+(ES?'Costo/pax':'Cost/pax')+'</th><th>'+(ES?'Activo':'Active')+'</th>'+(canEdit?'<th></th>':'')+'</tr></thead><tbody></tbody></table>';
      costWrap.innerHTML=head;
      const tbody=costWrap.querySelector('tbody');
      list.forEach(function(t){
        const name=(t.tour_name&&(t.tour_name.en||t.tour_name.es||t.tour_name))||t.tour_id;
        const tr=document.createElement('tr');
        if(canEdit){
          const fixed=el('<input type="number" min="0" step="1" style="width:110px" value="'+(t.fixed_cost_cents/100)+'">');
          const perp=el('<input type="number" min="0" step="1" style="width:110px" value="'+(t.cost_per_pax_cents/100)+'">');
          const act=el('<input type="checkbox" '+(t.active?'checked':'')+'>');
          const save=el('<button class="mini-btn" type="button">'+(ES?'Guardar':'Save')+'</button>');
          save.addEventListener('click',function(){
            save.disabled=true;
            apiPost('/api/admin-finance-settings-save',{tour_id:t.tour_id, fixed_cost_cents:Math.round((parseFloat(fixed.value)||0)*100), cost_per_pax_cents:Math.round((parseFloat(perp.value)||0)*100), active:act.checked}).then(function(rr){
              save.disabled=false;
              if(rr.status===401){ onUnauthorized(); return; }
              if(!rr.ok){ adminToast(ES?'No se pudo guardar.':'Could not save.'); return; }
              adminToast(ES?'Costo guardado':'Cost saved'); loadSummary();
            }).catch(function(){ save.disabled=false; adminToast(ES?'Error de conexión.':'Connection error.'); });
          });
          const td1=document.createElement('td'); td1.textContent=name;
          const td2=document.createElement('td'); td2.appendChild(fixed);
          const td3=document.createElement('td'); td3.appendChild(perp);
          const td4=document.createElement('td'); td4.appendChild(act);
          const td5=document.createElement('td'); td5.appendChild(save);
          tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3); tr.appendChild(td4); tr.appendChild(td5);
        } else {
          tr.innerHTML='<td>'+escapeHtml(name)+'</td><td>'+fin$(t.fixed_cost_cents)+'</td><td>'+fin$(t.cost_per_pax_cents)+'</td><td>'+(t.active?(ES?'Sí':'Yes'):'—')+'</td>';
        }
        tbody.appendChild(tr);
      });
    }).catch(function(){ costWrap.innerHTML=''; });
  }

  /* ---- DESCUENTOS ---- */
  let discTourSel=null;
  const discSec=el('<div class="fin-sec"><h3>'+(ES?'Reglas de descuento':'Discount rules')+'</h3>'
    +'<p class="bk-sub-hint">'+(ES?'El servidor aplica UNA regla por reserva (nunca acumula). No se borran: se activan o desactivan.'
                                  :'The server applies ONE rule per booking (never stacked). Rules are not deleted: toggle active.')+'</p></div>');
  const discList=el('<div class="bk-table-wrap"></div>'); discSec.appendChild(discList);
  wrap.appendChild(discSec);

  function loadDiscounts(){
    apiGet('/api/admin-discount-rules').then(function(r){
      if(r.status===401){ onUnauthorized(); return; }
      if(!r.ok||!r.data){ discList.innerHTML=''; return; }
      const rules=r.data.rules||[];
      const head='<table class="bk-table"><thead><tr><th>'+(ES?'Nombre':'Name')+'</th><th>Tour</th><th>'+(ES?'Tipo':'Type')+'</th><th>'+(ES?'Valor':'Value')+'</th><th>Pax</th><th>'+(ES?'Prio':'Prio')+'</th><th>'+(ES?'Activa':'Active')+'</th>'+(canEdit?'<th></th>':'')+'</tr></thead><tbody></tbody></table>';
      discList.innerHTML=head;
      const tbody=discList.querySelector('tbody');
      if(!rules.length){ tbody.innerHTML='<tr><td colspan="'+(canEdit?8:7)+'" class="bk-sub-hint">'+(ES?'Sin reglas. '+(canEdit?'Crea una abajo.':''):'No rules. '+(canEdit?'Create one below.':''))+'</td></tr>'; return; }
      rules.forEach(function(rule){
        const val= rule.discount_type==='percentage' ? (rule.percentage_bps/100)+'%' : fin$(rule.amount_cents)+(rule.discount_type==='fixed_per_pax'?'/pax':'');
        const pax= rule.min_guests+(rule.max_guests?('–'+rule.max_guests):'+');
        const tr=document.createElement('tr');
        tr.innerHTML='<td>'+escapeHtml(rule.name)+'</td><td>'+escapeHtml(rule.tour_id||(ES?'Todos':'All'))+'</td><td>'+rule.discount_type+'</td><td>'+val+'</td><td>'+pax+'</td><td class="num">'+rule.priority+'</td>'
          +'<td>'+(rule.active?'<span class="bdg bdg-ok">'+(ES?'Sí':'Yes')+'</span>':'<span class="bdg bdg-muted">'+(ES?'No':'No')+'</span>')+'</td>';
        if(canEdit){
          const td=document.createElement('td');
          const tg=el('<button class="mini-btn" type="button">'+(rule.active?(ES?'Desactivar':'Disable'):(ES?'Activar':'Enable'))+'</button>');
          tg.addEventListener('click',function(){
            tg.disabled=true;
            apiPost('/api/admin-discount-rule-toggle',{id:rule.id, active:!rule.active}).then(function(rr){
              tg.disabled=false;
              if(rr.status===401){ onUnauthorized(); return; }
              if(!rr.ok){ adminToast(ES?'No se pudo cambiar.':'Could not change.'); return; }
              adminToast(ES?'Regla actualizada':'Rule updated'); loadDiscounts(); loadSummary();
            }).catch(function(){ tg.disabled=false; });
          });
          td.appendChild(tg); tr.appendChild(td);
        }
        tbody.appendChild(tr);
      });
    }).catch(function(){ discList.innerHTML=''; });
  }

  /* owner: formulario de nueva regla + probar precio */
  if(canEdit){
    const form=el('<div class="fin-sec fin-discform"><h4>'+(ES?'Nueva regla':'New rule')+'</h4></div>');
    const row1=el('<div class="ed-row"></div>');
    const nameF=el('<div class="ed-field"><label>'+(ES?'Nombre':'Name')+'</label><input type="text" maxlength="120"></div>');
    const dsel=bkSelectField('Tour',[['',ES?'Todos los tours':'All tours']]); discTourSel=dsel.select;
    const typeF=bkSelectField(ES?'Tipo':'Type',[['percentage',ES?'Porcentaje':'Percentage'],['fixed_total',ES?'Monto fijo total':'Fixed total'],['fixed_per_pax',ES?'Monto fijo por pax':'Fixed per pax']]);
    row1.appendChild(nameF); row1.appendChild(dsel.wrap); row1.appendChild(typeF.wrap);
    const row2=el('<div class="ed-row"></div>');
    const valF=el('<div class="ed-field"><label>'+(ES?'Valor (% o $)':'Value (% or $)')+'</label><input type="number" min="0" step="0.01"></div>');
    const minF=el('<div class="ed-field"><label>'+(ES?'Pax mín':'Min pax')+'</label><input type="number" min="1" value="1"></div>');
    const maxF=el('<div class="ed-field"><label>'+(ES?'Pax máx (opcional)':'Max pax (optional)')+'</label><input type="number" min="1"></div>');
    row2.appendChild(valF); row2.appendChild(minF); row2.appendChild(maxF);
    const row3=el('<div class="ed-row"></div>');
    const startF=bkDateField(ES?'Inicio (opcional)':'Start (optional)');
    const endF=bkDateField(ES?'Fin (opcional)':'End (optional)');
    const prioF=el('<div class="ed-field"><label>'+(ES?'Prioridad':'Priority')+'</label><input type="number" min="0" value="0"></div>');
    row3.appendChild(startF.wrap); row3.appendChild(endF.wrap); row3.appendChild(prioF);
    const saveBtn=el('<button class="btn btn-gold btn-sm" type="button">'+(ES?'Crear regla':'Create rule')+'</button>');
    saveBtn.addEventListener('click',function(){
      const type=typeF.select.value; const raw=parseFloat(valF.querySelector('input').value)||0;
      const payload={ name:(nameF.querySelector('input').value||'').trim(), tour_id:discTourSel.value||null, discount_type:type,
        min_guests:parseInt(minF.querySelector('input').value||'1',10), active:true, priority:parseInt(prioF.querySelector('input').value||'0',10) };
      if(type==='percentage'){ payload.percentage_bps=Math.round(raw*100); } else { payload.amount_cents=Math.round(raw*100); }
      const mx=maxF.querySelector('input').value; if(mx) payload.max_guests=parseInt(mx,10);
      if(startF.input.value) payload.starts_at=new Date(startF.input.value+'T00:00:00Z').toISOString();
      if(endF.input.value) payload.ends_at=new Date(endF.input.value+'T00:00:00Z').toISOString();
      saveBtn.disabled=true;
      apiPost('/api/admin-discount-rule-save',payload).then(function(rr){
        saveBtn.disabled=false;
        if(rr.status===401){ onUnauthorized(); return; }
        if(!rr.ok){ adminToast(ES?'Revisa los campos de la regla.':'Check the rule fields.'); return; }
        adminToast(ES?'Regla creada':'Rule created'); nameF.querySelector('input').value=''; valF.querySelector('input').value=''; loadDiscounts(); loadSummary();
      }).catch(function(){ saveBtn.disabled=false; });
    });
    form.appendChild(row1); form.appendChild(row2); form.appendChild(row3); form.appendChild(saveBtn);

    /* probar precio (usa el motor del servidor: refleja las reglas activas) */
    const test=el('<div class="fin-sec"><h4>'+(ES?'Probar precio':'Test price')+'</h4></div>');
    const trow=el('<div class="ed-row"></div>');
    const tSel=bkSelectField('Tour',[]); const tG=el('<div class="ed-field"><label>Pax</label><input type="number" min="1" value="4"></div>');
    const tBtn=el('<button class="mini-btn" type="button">'+(ES?'Calcular':'Calculate')+'</button>');
    const tOut=el('<div class="bk-sub-hint" style="align-self:center"></div>');
    trow.appendChild(tSel.wrap); trow.appendChild(tG); const tbw=el('<div class="ed-field"><label>&nbsp;</label></div>'); tbw.appendChild(tBtn); trow.appendChild(tbw); trow.appendChild(tOut);
    tBtn.addEventListener('click',function(){
      const g=parseInt(tG.querySelector('input').value||'1',10);
      apiPost('/api/pricing-preview',{tour_id:tSel.select.value, guests:g}).then(function(rr){
        if(rr.ok&&rr.data){ tOut.innerHTML=(ES?'Bruto ':'Gross ')+fin$(rr.data.grossAmountCents)+' · '+(ES?'Desc ':'Disc ')+'−'+fin$(rr.data.discountCents)+' · '+(ES?'Final ':'Final ')+'<b>'+fin$(rr.data.amountCents)+'</b>'+(rr.data.discountLabel?(' ('+escapeHtml(rr.data.discountLabel)+')'):''); }
        else { tOut.textContent=ES?'No se pudo calcular.':'Could not calculate.'; }
      }).catch(function(){ tOut.textContent=ES?'Error.':'Error.'; });
    });
    test.appendChild(trow);
    /* poblar el select de "probar" con los tours pagables al cargar */
    const origLoadTours=loadTours;
    loadTours=function(){ origLoadTours(); apiGet('/api/admin-finance-settings').then(function(r){ if(r.ok&&r.data){ tSel.select.innerHTML=''; (r.data.settings||[]).forEach(function(t){ const op=document.createElement('option'); op.value=t.tour_id; op.textContent=(t.tour_name&&(t.tour_name.en||t.tour_name.es||t.tour_name))||t.tour_id; tSel.select.appendChild(op); }); } }); };
    discSec.appendChild(form); discSec.appendChild(test);
  }

  loadSummary(); loadTours(); loadDiscounts();
  return wrap;
}

/* Los paneles se CONSTRUYEN según el rol: para staff el array contiene una sola
   entrada, así los paneles de contenido nunca se invocan ni entran al DOM. */
/* ============ NOTIFICACIONES (owner + admin) ============ */
function notifBadge(st){ return '<span class="notif-badge notif-'+escapeHtml(st)+'">'+escapeHtml(st)+'</span>'; }
function panelNotifications(role){
  const p=el('<div class="bk-screen"></div>');
  const state={ page:1, limit:25, rows:[], totalPages:1 };

  const intro=el('<p class="td-hint"></p>');
  intro.textContent=ES?'Estado de los correos automáticos. Reintenta los que quedaron en fallido.':'Status of automated emails. Retry the ones that failed.';
  p.appendChild(intro);

  const fcard=el('<div class="bk-filters"></div>');
  const searchWrap=el('<div class="ed-field"><label>'+(ES?'Buscar':'Search')+'</label></div>');
  const searchInput=document.createElement('input'); searchInput.maxLength=100; searchInput.placeholder=ES?'Código o email':'Code or email'; searchWrap.appendChild(searchInput);
  const fromF=bkDateField(ES?'Desde':'From'), toF=bkDateField(ES?'Hasta':'To');
  const statusF=bkSelectField(ES?'Estado':'Status',[['',ES?'Todos':'All'],['sent','sent'],['failed','failed'],['pending','pending'],['sending','sending'],['skipped','skipped']]);
  const typeF=bkSelectField(ES?'Tipo':'Type',[['',ES?'Todos':'All'],['customer_booking_confirmation','customer_booking_confirmation'],['owner_booking_notification','owner_booking_notification'],['customer_quote_acknowledgement','customer_quote_acknowledgement'],['owner_quote_notification','owner_quote_notification'],['customer_agency_confirmation','customer_agency_confirmation'],['owner_agency_notification','owner_agency_notification']]);
  const row1=el('<div class="bk-frow"></div>'); row1.appendChild(searchWrap); row1.appendChild(fromF.wrap); row1.appendChild(toF.wrap);
  const row2=el('<div class="bk-frow"></div>'); row2.appendChild(statusF.wrap); row2.appendChild(typeF.wrap);
  fcard.appendChild(row1); fcard.appendChild(row2);
  const btns=el('<div class="bk-fbtns"></div>');
  const applyB=el('<button class="btn btn-gold btn-sm" type="button">'+(ES?'Aplicar':'Apply')+'</button>');
  const retryB=el('<button class="btn btn-ink btn-sm" type="button">'+(ES?'Reintentar fallidos seleccionados':'Retry selected failed')+'</button>'); retryB.style.marginLeft='auto';
  btns.appendChild(applyB); btns.appendChild(retryB); fcard.appendChild(btns);
  p.appendChild(fcard);

  const COLS=['', ES?'Código':'Code', ES?'Tipo':'Type', ES?'Destinatario':'Recipient', ES?'Estado':'Status', ES?'Intentos':'Attempts', ES?'Fecha':'Date', 'Error', ES?'Acciones':'Actions'];
  const wrap=el('<div class="bk-table-wrap"></div>');
  const table=el('<table class="bk-table"><thead><tr>'+COLS.map(function(c){return '<th>'+escapeHtml(c)+'</th>';}).join('')+'</tr></thead><tbody></tbody></table>');
  const tbody=table.querySelector('tbody'); wrap.appendChild(table); p.appendChild(wrap);
  const pager=el('<div class="bk-pager"></div>');
  const prevP=el('<button class="mini-btn" type="button">'+(ES?'‹ Anterior':'‹ Prev')+'</button>');
  const nextP=el('<button class="mini-btn" type="button">'+(ES?'Siguiente ›':'Next ›')+'</button>');
  const pageInfo=el('<span></span>'); pager.appendChild(prevP); pager.appendChild(pageInfo); pager.appendChild(nextP); p.appendChild(pager);

  function params(){ const q={page:state.page,limit:state.limit}; const s=searchInput.value.trim(); if(s)q.search=s; if(fromF.input.value)q.date_from=fromF.input.value; if(toF.input.value)q.date_to=toF.input.value; if(statusF.select.value)q.status=statusF.select.value; if(typeF.select.value)q.notification_type=typeF.select.value; return q; }
  function load(){
    tbody.innerHTML='<tr><td colspan="9" class="bk-empty">'+(ES?'Cargando…':'Loading…')+'</td></tr>';
    apiGet('/api/admin-notifications?'+bkQS(params())).then(function(r){
      if(r.status===401){ onUnauthorized(); return; }
      if(!r.ok){ tbody.innerHTML='<tr><td colspan="9" class="bk-empty">'+(ES?'Error al cargar':'Failed to load')+'</td></tr>'; return; }
      state.rows=(r.data&&r.data.rows)||[]; const pg=(r.data&&r.data.pagination)||{}; state.totalPages=pg.totalPages||1;
      render(); pageInfo.textContent=(ES?'Página ':'Page ')+(pg.page||1)+' / '+state.totalPages+' · '+(pg.total||0);
      prevP.disabled=(state.page<=1); nextP.disabled=(state.page>=state.totalPages);
    });
  }
  function render(){
    if(!state.rows.length){ tbody.innerHTML='<tr><td colspan="9" class="bk-empty">'+(ES?'Sin notificaciones':'No notifications')+'</td></tr>'; return; }
    tbody.innerHTML='';
    state.rows.forEach(function(n){
      const canRetry=(n.status==='failed');
      const tr=el('<tr></tr>');
      tr.innerHTML=
        '<td>'+(canRetry?'<input type="checkbox" class="nf-ck" data-id="'+escapeHtml(n.id)+'">':'')+'</td>'
        +'<td class="mono">'+escapeHtml(n.booking_code||'—')+'</td>'
        +'<td class="ell">'+escapeHtml(n.notification_type||'')+'</td>'
        +'<td class="ell">'+escapeHtml(n.recipient_email||'—')+'</td>'
        +'<td>'+notifBadge(n.status)+'</td>'
        +'<td class="num">'+escapeHtml(n.attempts)+'</td>'
        +'<td>'+bkFmtDT(n.created_at)+'</td>'
        +'<td class="ell">'+(n.last_error?escapeHtml(n.last_error):'—')+'</td>'
        +'<td class="nf-actions"></td>';
      const actions=tr.querySelector('.nf-actions');
      if(canRetry){ const rb=el('<button class="mini-btn" type="button">'+(ES?'Reintentar':'Retry')+'</button>'); rb.addEventListener('click',function(){ retryOne(n.id, rb); }); actions.appendChild(rb); }
      if(n.booking_code){ const ob=el('<button class="mini-btn" type="button">'+(ES?'Abrir':'Open')+'</button>'); ob.addEventListener('click',function(){ openBooking(n.booking_code); }); actions.appendChild(ob); }
      tbody.appendChild(tr);
    });
  }
  function retryOne(id, btn){
    if(btn){ btn.disabled=true; btn.textContent=ES?'Enviando…':'Sending…'; }
    apiPost('/api/admin-notifications-retry',{notification_id:id}).then(function(r){
      if(r.status===401){ onUnauthorized(); return; }
      const st=r.data&&r.data.status;
      adminToast(r.ok&&st==='sent'?(ES?'Correo reenviado':'Email resent'):(ES?'No se pudo reenviar':'Could not resend'));
      load();
    });
  }
  function retryBatch(){
    const ids=Array.prototype.map.call(tbody.querySelectorAll('.nf-ck:checked'),function(c){return c.getAttribute('data-id');});
    if(!ids.length){ adminToast(ES?'Selecciona correos fallidos':'Select failed emails'); return; }
    if(!confirm((ES?'¿Reintentar ':'Retry ')+ids.length+(ES?' correo(s) fallido(s)?':' failed email(s)?'))) return;
    retryB.disabled=true;
    apiPost('/api/admin-notifications-retry-batch',{notification_ids:ids, confirmation:'RETRY FAILED EMAILS'}).then(function(r){
      retryB.disabled=false;
      if(r.status===401){ onUnauthorized(); return; }
      if(!r.ok){ adminToast(ES?'No se pudo procesar':'Could not process'); return; }
      const s=(r.data&&r.data.summary)||{};
      adminToast((ES?'Enviados ':'Sent ')+(s.sent||0)+' · '+(ES?'fallidos ':'failed ')+(s.failed||0)+' · '+(ES?'omitidos ':'skipped ')+(s.skipped||0));
      load();
    });
  }
  function openBooking(code){
    apiGet('/api/admin-bookings?'+bkQS({search:code,limit:5})).then(function(r){
      if(r.status===401){ onUnauthorized(); return; }
      const list=(r.data&&r.data.bookings)||[];
      const b=list.filter(function(x){return x.booking_code===code;})[0]||list[0];
      if(b) bkAdminDetail(b,function(){}); else adminToast(ES?'Reserva no encontrada':'Booking not found');
    });
  }
  applyB.addEventListener('click',function(){ state.page=1; load(); });
  retryB.addEventListener('click',retryBatch);
  prevP.addEventListener('click',function(){ if(state.page>1){ state.page--; load(); } });
  nextP.addEventListener('click',function(){ if(state.page<state.totalPages){ state.page++; load(); } });
  load();
  return p;
}

/* ============ DATOS DE PRUEBA (SOLO owner) ============ */
function tdMoney(c){ return (c==null)?'—':('$'+(Number(c)/100).toFixed(2)); }
function panelTestData(role){
  const p=el('<div class="bk-screen"></div>');
  const state={ page:1, limit:25, rows:[], totalPages:1 };

  const warn=el('<div class="fin-partial td-warn"></div>');
  warn.innerHTML=ES
    ? '⚠️ Solo el owner puede marcar o retirar datos de prueba. <b>Archivar</b> es un borrado lógico con auditoría: no borra pagos, correos ni QR y <b>no realiza reembolsos en Stripe</b>.'
    : '⚠️ Only the owner can mark or remove test data. <b>Archiving</b> is a logged soft-delete: it does not delete payments, emails or QR and <b>does not refund in Stripe</b>.';
  p.appendChild(warn);

  const fcard=el('<div class="bk-filters"></div>');
  const searchWrap=el('<div class="ed-field"><label>'+(ES?'Buscar':'Search')+'</label></div>');
  const searchInput=document.createElement('input'); searchInput.maxLength=100; searchInput.placeholder=ES?'Código, cliente, email o tour':'Code, customer, email or tour'; searchWrap.appendChild(searchInput);
  const fromF=bkDateField(ES?'Desde':'From'), toF=bkDateField(ES?'Hasta':'To');
  const typeF=bkSelectField(ES?'Tipo':'Type',[['',ES?'Todos':'All'],['booking',ES?'Reserva':'Booking'],['quote',ES?'Cotización':'Quote']]);
  const payF=bkSelectField(ES?'Estado de pago':'Payment status',[['',ES?'Todos':'All'],['not_required','not_required'],['pending','pending'],['processing','processing'],['paid','paid'],['failed','failed'],['refunded','refunded']]);
  const chanF=bkSelectField(ES?'Canal':'Channel',[['',ES?'Todos':'All'],['web','web'],['agency',ES?'agencia':'agency']]);
  const testF=bkSelectField(ES?'Marca TEST':'TEST flag',[['',ES?'Todas':'All'],['true',ES?'Solo prueba':'Test only'],['false',ES?'Solo reales':'Real only']]);
  const viewF=bkSelectField(ES?'Vista':'View',[['active',ES?'Activas':'Active'],['all',ES?'Todas':'All'],['only',ES?'Archivadas':'Archived']]);
  const row1=el('<div class="bk-frow"></div>'); row1.appendChild(searchWrap); row1.appendChild(fromF.wrap); row1.appendChild(toF.wrap);
  const row2=el('<div class="bk-frow"></div>'); row2.appendChild(typeF.wrap); row2.appendChild(payF.wrap); row2.appendChild(chanF.wrap);
  const row3=el('<div class="bk-frow"></div>'); row3.appendChild(testF.wrap); row3.appendChild(viewF.wrap);
  fcard.appendChild(row1); fcard.appendChild(row2); fcard.appendChild(row3);
  const btns=el('<div class="bk-fbtns"></div>');
  const applyB=el('<button class="btn btn-gold btn-sm" type="button">'+(ES?'Aplicar':'Apply')+'</button>');
  const markB=el('<button class="btn btn-ink btn-sm" type="button">'+(ES?'Marcar como TEST':'Mark as test')+'</button>');
  const archB=el('<button class="btn btn-ink btn-sm td-danger" type="button">'+(ES?'Archivar pruebas':'Archive test')+'</button>'); archB.style.marginLeft='auto';
  btns.appendChild(applyB); btns.appendChild(markB); btns.appendChild(archB); fcard.appendChild(btns);
  p.appendChild(fcard);

  const COLS=['<input type="checkbox" class="td-all">', ES?'Código':'Code', ES?'Cliente':'Customer', 'Email', 'Tour', ES?'Tipo':'Type', ES?'Fecha':'Date', ES?'Canal':'Channel', ES?'Pago':'Payment', 'Total', 'TEST', ES?'Archivada':'Archived'];
  const wrap=el('<div class="bk-table-wrap"></div>');
  const table=el('<table class="bk-table"><thead><tr>'+COLS.map(function(c){return '<th>'+c+'</th>';}).join('')+'</tr></thead><tbody></tbody></table>');
  const tbody=table.querySelector('tbody'); wrap.appendChild(table); p.appendChild(wrap);
  const selAll=table.querySelector('.td-all');
  const pager=el('<div class="bk-pager"></div>');
  const prevP=el('<button class="mini-btn" type="button">'+(ES?'‹ Anterior':'‹ Prev')+'</button>');
  const nextP=el('<button class="mini-btn" type="button">'+(ES?'Siguiente ›':'Next ›')+'</button>');
  const pageInfo=el('<span></span>'); pager.appendChild(prevP); pager.appendChild(pageInfo); pager.appendChild(nextP); p.appendChild(pager);

  function params(){ const q={page:state.page,limit:state.limit}; const s=searchInput.value.trim(); if(s)q.search=s;
    if(fromF.input.value)q.date_from=fromF.input.value; if(toF.input.value)q.date_to=toF.input.value;
    if(typeF.select.value)q.request_type=typeF.select.value; if(payF.select.value)q.payment_status=payF.select.value;
    if(chanF.select.value)q.sales_channel=chanF.select.value; if(testF.select.value)q.is_test=testF.select.value;
    const v=viewF.select.value; if(v==='all')q.include_archived='true'; else if(v==='only')q.include_archived='only';
    return q; }
  function load(){
    if(selAll) selAll.checked=false;
    tbody.innerHTML='<tr><td colspan="12" class="bk-empty">'+(ES?'Cargando…':'Loading…')+'</td></tr>';
    apiGet('/api/admin-test-data-list?'+bkQS(params())).then(function(r){
      if(r.status===401){ onUnauthorized(); return; }
      if(!r.ok){ tbody.innerHTML='<tr><td colspan="12" class="bk-empty">'+(r.status===403?(ES?'Solo el owner':'Owner only'):(ES?'Error al cargar':'Failed to load'))+'</td></tr>'; return; }
      state.rows=(r.data&&r.data.rows)||[]; const pg=(r.data&&r.data.pagination)||{}; state.totalPages=pg.totalPages||1;
      render(); pageInfo.textContent=(ES?'Página ':'Page ')+(pg.page||1)+' / '+state.totalPages+' · '+(pg.total||0);
      prevP.disabled=(state.page<=1); nextP.disabled=(state.page>=state.totalPages);
    });
  }
  function render(){
    if(!state.rows.length){ tbody.innerHTML='<tr><td colspan="12" class="bk-empty">'+(ES?'Sin registros':'No records')+'</td></tr>'; return; }
    tbody.innerHTML='';
    state.rows.forEach(function(b){
      const archived=!!b.deleted_at;
      const tr=el('<tr'+(archived?' class="td-arch"':'')+'></tr>');
      tr.innerHTML=
        '<td>'+(archived?'':'<input type="checkbox" class="td-ck" data-id="'+escapeHtml(b.id)+'" data-test="'+(b.is_test?'1':'0')+'">')+'</td>'
        +'<td class="mono">'+escapeHtml(b.booking_code||'')+'</td>'
        +'<td class="ell">'+escapeHtml(b.customer_name||'')+'</td>'
        +'<td class="ell">'+escapeHtml(b.customer_email||'—')+'</td>'
        +'<td class="ell">'+escapeHtml(b.tour_name||'')+'</td>'
        +'<td>'+escapeHtml(b.request_type||'')+'</td>'
        +'<td>'+escapeHtml(b.booking_date||'—')+'</td>'
        +'<td>'+escapeHtml(b.sales_channel||'—')+'</td>'
        +'<td>'+escapeHtml(b.payment_status||'—')+'</td>'
        +'<td class="num">'+tdMoney(b.amount_cents)+'</td>'
        +'<td>'+(b.is_test?'<span class="notif-badge notif-test">TEST</span>':'—')+'</td>'
        +'<td>'+(archived?'<span class="notif-badge notif-archived">'+(ES?'archivada':'archived')+'</span>':'—')+'</td>';
      tbody.appendChild(tr);
    });
  }
  function checkedRows(){ return Array.prototype.slice.call(tbody.querySelectorAll('.td-ck:checked')); }
  function doMark(){
    const rows=checkedRows(); if(!rows.length){ adminToast(ES?'Selecciona registros':'Select records'); return; }
    const ids=rows.map(function(c){return c.getAttribute('data-id');});
    if(!confirm(ES?'Revisa cuidadosamente los registros seleccionados. Marcarlos como prueba permitirá retirarlos posteriormente.':'Review the selected records carefully. Marking them as test will allow them to be archived later.')) return;
    markB.disabled=true;
    apiPost('/api/admin-test-data-mark',{booking_ids:ids, confirmation:'MARK AS TEST'}).then(function(r){
      markB.disabled=false;
      if(r.status===401){ onUnauthorized(); return; }
      if(!r.ok){ adminToast(ES?'No se pudo marcar':'Could not mark'); return; }
      adminToast((ES?'Marcadas ':'Marked ')+((r.data&&r.data.marked)||0)); load();
    });
  }
  function doArchive(){
    const rows=checkedRows(); if(!rows.length){ adminToast(ES?'Selecciona registros':'Select records'); return; }
    if(rows.some(function(c){return c.getAttribute('data-test')!=='1';})){ adminToast(ES?'Solo se archivan registros marcados como TEST':'Only records marked as TEST can be archived'); return; }
    const ids=rows.map(function(c){return c.getAttribute('data-id');});
    const reason=prompt(ES?'Motivo del archivado (mínimo 5 caracteres):':'Reason for archiving (min 5 characters):');
    if(reason==null) return;
    if(reason.trim().length<5){ adminToast(ES?'Motivo demasiado corto':'Reason too short'); return; }
    const typed=prompt(ES?'Escribe exactamente:  ARCHIVE TEST DATA':'Type exactly:  ARCHIVE TEST DATA');
    if(typed!=='ARCHIVE TEST DATA'){ adminToast(ES?'Confirmación incorrecta':'Confirmation does not match'); return; }
    if(!confirm(ES?'Esta acción los retirará del calendario, agenda y finanzas. No realiza reembolsos en Stripe. ¿Continuar?':'This will remove them from the calendar, schedule and finance. It does not refund in Stripe. Continue?')) return;
    archB.disabled=true;
    apiPost('/api/admin-test-data-archive',{booking_ids:ids, reason:reason.trim(), confirmation:'ARCHIVE TEST DATA'}).then(function(r){
      archB.disabled=false;
      if(r.status===401){ onUnauthorized(); return; }
      if(!r.ok){ adminToast(ES?'No se pudo archivar':'Could not archive'); return; }
      adminToast((ES?'Archivadas ':'Archived ')+((r.data&&r.data.archived)||0)); load();
    });
  }
  if(selAll) selAll.addEventListener('change',function(){ tbody.querySelectorAll('.td-ck').forEach(function(c){ c.checked=selAll.checked; }); });
  applyB.addEventListener('click',function(){ state.page=1; load(); });
  markB.addEventListener('click',doMark);
  archB.addEventListener('click',doArchive);
  prevP.addEventListener('click',function(){ if(state.page>1){ state.page--; load(); } });
  nextP.addEventListener('click',function(){ if(state.page<state.totalPages){ state.page++; load(); } });
  load();
  return p;
}

/* ============ ETAPA 8 — NOTAS DE PAQUETES (owner + admin) ============ */
function panelPackageNotes(role){
  const p=el('<div class="bk-screen"></div>');
  p.appendChild(el('<p class="bk-sub-hint">'+(ES?'Notas que verá el cliente en el paquete, el checkout, la confirmación y el correo. Si marcas “requiere aceptación”, el cliente debe aceptarlas antes de pagar o cotizar. Cambiarlas no afecta reservas anteriores.':'Notes shown to the customer on the package, checkout, confirmation and email. If you mark “requires acknowledgement”, the customer must accept them before paying or requesting a quote. Editing them does not affect past bookings.')+'</p>'));

  const tourRow=el('<div class="ed-row"></div>');
  const tourIn=el('<div class="ed-field"><label>Tour ID</label><input placeholder="p3, p4, kicker, t360, private, half, full, expedition…"></div>');
  const loadBtn=el('<button class="mini-btn" type="button">'+(ES?'Cargar notas':'Load notes')+'</button>');
  const lbw=el('<div class="ed-field"><label>&nbsp;</label></div>'); lbw.appendChild(loadBtn);
  tourRow.appendChild(tourIn); tourRow.appendChild(lbw); p.appendChild(tourRow);
  const list=el('<div style="margin:8px 0 14px"></div>'); p.appendChild(list);

  const form=el('<div class="fin-sec"><h4>'+(ES?'Nueva / editar nota':'New / edit note')+'</h4></div>');
  const cur={id:null};
  const tEn=el('<div class="ed-field"><label>Title (EN)</label><input></div>');
  const tEs=el('<div class="ed-field"><label>Título (ES)</label><input></div>');
  const cEn=el('<div class="ed-field"><label>Content (EN)</label><textarea style="min-height:64px"></textarea></div>');
  const cEs=el('<div class="ed-field"><label>Contenido (ES)</label><textarea style="min-height:64px"></textarea></div>');
  const ord=el('<div class="ed-field"><label>'+(ES?'Orden':'Order')+'</label><input type="number" value="0" style="max-width:120px"></div>');
  const ack=el('<label style="display:flex;gap:8px;align-items:center;color:var(--ink);font-weight:600;margin:6px 0"><input type="checkbox"> '+(ES?'Requiere aceptación':'Requires acknowledgement')+'</label>');
  const act=el('<label style="display:flex;gap:8px;align-items:center;color:var(--ink);font-weight:600;margin:6px 0"><input type="checkbox" checked> '+(ES?'Activa':'Active')+'</label>');
  const saveBtn=el('<button class="btn btn-gold btn-sm" type="button" style="margin-top:6px">'+(ES?'Guardar nota':'Save note')+'</button>');
  const newBtn=el('<button class="mini-btn" type="button" style="margin-left:8px">'+(ES?'Nueva':'New')+'</button>');
  const r1=el('<div class="ed-row"></div>'); r1.appendChild(tEn); r1.appendChild(tEs);
  form.appendChild(r1); form.appendChild(cEn); form.appendChild(cEs);
  const r2=el('<div class="ed-row"></div>'); r2.appendChild(ord); form.appendChild(r2);
  form.appendChild(ack); form.appendChild(act);
  const bw=el('<div></div>'); bw.appendChild(saveBtn); bw.appendChild(newBtn); form.appendChild(bw);
  p.appendChild(form);

  function tourId(){ return tourIn.querySelector('input').value.trim(); }
  function fillForm(n){
    cur.id=n?n.id:null;
    tEn.querySelector('input').value=n?(n.title_en||''):'';
    tEs.querySelector('input').value=n?(n.title_es||''):'';
    cEn.querySelector('textarea').value=n?(n.content_en||''):'';
    cEs.querySelector('textarea').value=n?(n.content_es||''):'';
    ord.querySelector('input').value=n?(n.display_order||0):0;
    ack.querySelector('input').checked=n?!!n.requires_acknowledgement:false;
    act.querySelector('input').checked=n?!!n.active:true;
  }
  function render(notes){
    list.innerHTML='';
    if(!notes.length){ list.appendChild(el('<p class="bk-sub-hint">'+(ES?'Sin notas para este tour.':'No notes for this tour.')+'</p>')); return; }
    notes.forEach(function(n){
      const c=el('<div class="fin-sec" style="margin-bottom:8px"></div>');
      c.appendChild(el('<div><b>'+escapeHtml(n.title_es||n.title_en||'—')+'</b> '+(n.active?'<span class="notif-badge notif-sent">'+(ES?'activa':'active')+'</span>':'<span class="notif-badge">'+(ES?'inactiva':'inactive')+'</span>')+(n.requires_acknowledgement?' <span class="notif-badge notif-sending">'+(ES?'aceptación':'ack')+'</span>':'')+'</div>'));
      c.appendChild(el('<div class="bk-sub-hint">'+escapeHtml(String(n.content_es||n.content_en||'').slice(0,160))+'</div>'));
      const eb=el('<button class="mini-btn" type="button">'+(ES?'Editar':'Edit')+'</button>');
      eb.addEventListener('click',function(){ fillForm(n); try{form.scrollIntoView({behavior:'smooth'});}catch(e){} });
      c.appendChild(eb); list.appendChild(c);
    });
  }
  function load(){
    const tid=tourId(); if(!tid){ list.innerHTML=''; return; }
    apiGet('/api/admin-tour-notes?tour_id='+encodeURIComponent(tid)).then(function(r){
      if(r.status===401){ onUnauthorized(); return; }
      if(r.ok&&r.data) render(r.data.notes||[]); else list.textContent=(ES?'No se pudo cargar.':'Could not load.');
    });
  }
  loadBtn.addEventListener('click',load);
  newBtn.addEventListener('click',function(){ fillForm(null); });
  saveBtn.addEventListener('click',function(){
    const tid=tourId(); if(!tid){ adminToast(ES?'Escribe el Tour ID.':'Enter the Tour ID.'); return; }
    const body={ id:cur.id||undefined, tour_id:tid,
      title_en:tEn.querySelector('input').value, title_es:tEs.querySelector('input').value,
      content_en:cEn.querySelector('textarea').value, content_es:cEs.querySelector('textarea').value,
      active:act.querySelector('input').checked, requires_acknowledgement:ack.querySelector('input').checked,
      display_order:parseInt(ord.querySelector('input').value||'0',10)||0 };
    saveBtn.disabled=true;
    apiPost('/api/admin-tour-notes-save',body).then(function(r){
      saveBtn.disabled=false;
      if(r.status===401){ onUnauthorized(); return; }
      if(r.ok&&r.data&&r.data.saved){ adminToast(ES?'Nota guardada':'Note saved'); fillForm(null); load(); }
      else adminToast(ES?'Revisa los campos de la nota.':'Check the note fields.');
    }).catch(function(){ saveBtn.disabled=false; });
  });
  return p;
}

/* ============ ETAPA 8 — HOTELES PREFERIDOS (owner + admin) ============ */
function panelHotelPreferences(role){
  const p=el('<div class="bk-screen"></div>');
  p.appendChild(el('<p class="bk-sub-hint">'+(ES?'Hoteles preferidos por destino. El conector de búsqueda intentará primero los de mayor prioridad; si no cumplen, buscará alternativas comparables.':'Preferred hotels by destination. The search connector tries the highest priority first; if they do not fit, it looks for comparable alternatives.')+'</p>'));
  const list=el('<div style="margin:8px 0 14px"></div>'); p.appendChild(list);

  const DESTS=[['quito','Quito'],['guayaquil','Guayaquil'],['san_cristobal','San Cristóbal'],['santa_cruz','Santa Cruz'],['isabela','Isabela']];
  const form=el('<div class="fin-sec"><h4>'+(ES?'Nuevo / editar hotel':'New / edit hotel')+'</h4></div>');
  const cur={id:null};
  const dSel=el('<div class="ed-field"><label>'+(ES?'Destino':'Destination')+'</label><select>'+DESTS.map(function(d){return '<option value="'+d[0]+'">'+d[1]+'</option>';}).join('')+'</select></div>');
  const nm=el('<div class="ed-field"><label>'+(ES?'Nombre del hotel':'Hotel name')+'</label><input></div>');
  const pr=el('<div class="ed-field"><label>'+(ES?'Prioridad':'Priority')+'</label><input type="number" value="1" style="max-width:120px"></div>');
  const nt=el('<div class="ed-field"><label>'+(ES?'Notas':'Notes')+'</label><input></div>');
  const ac=el('<label style="display:flex;gap:8px;align-items:center;color:var(--ink);font-weight:600;margin:6px 0"><input type="checkbox" checked> '+(ES?'Activo':'Active')+'</label>');
  const sb=el('<button class="btn btn-gold btn-sm" type="button" style="margin-top:6px">'+(ES?'Guardar':'Save')+'</button>');
  const nb=el('<button class="mini-btn" type="button" style="margin-left:8px">'+(ES?'Nuevo':'New')+'</button>');
  const r1=el('<div class="ed-row"></div>'); r1.appendChild(dSel); r1.appendChild(pr); form.appendChild(r1);
  form.appendChild(nm); form.appendChild(nt); form.appendChild(ac);
  const bw=el('<div></div>'); bw.appendChild(sb); bw.appendChild(nb); form.appendChild(bw); p.appendChild(form);

  function fill(h){ cur.id=h?h.id:null; dSel.querySelector('select').value=h?h.destination:'quito'; nm.querySelector('input').value=h?h.hotel_name:''; pr.querySelector('input').value=h?(h.priority||1):1; nt.querySelector('input').value=h?(h.preference_notes||''):''; ac.querySelector('input').checked=h?!!h.active:true; }
  function render(rows){
    list.innerHTML='';
    if(!rows.length){ list.appendChild(el('<p class="bk-sub-hint">'+(ES?'Sin hoteles configurados.':'No hotels configured.')+'</p>')); return; }
    rows.forEach(function(h){
      const label=(DESTS.find(function(d){return d[0]===h.destination;})||[])[1]||h.destination;
      const c=el('<div class="fin-sec" style="margin-bottom:8px"></div>');
      c.appendChild(el('<div><b>'+escapeHtml(label)+'</b> · '+escapeHtml(h.hotel_name)+' <span class="notif-badge">#'+escapeHtml(h.priority)+'</span> '+(h.active?'':'<span class="notif-badge">'+(ES?'inactivo':'inactive')+'</span>')+'</div>'));
      if(h.preference_notes) c.appendChild(el('<div class="bk-sub-hint">'+escapeHtml(h.preference_notes)+'</div>'));
      const eb=el('<button class="mini-btn" type="button">'+(ES?'Editar':'Edit')+'</button>'); eb.addEventListener('click',function(){ fill(h); try{form.scrollIntoView({behavior:'smooth'});}catch(e){} });
      c.appendChild(eb); list.appendChild(c);
    });
  }
  function load(){ apiGet('/api/admin-hotel-preferences').then(function(r){ if(r.status===401){ onUnauthorized(); return; } if(r.ok&&r.data) render(r.data.preferences||[]); }); }
  nb.addEventListener('click',function(){ fill(null); });
  sb.addEventListener('click',function(){
    const body={ id:cur.id||undefined, destination:dSel.querySelector('select').value, hotel_name:nm.querySelector('input').value,
      priority:parseInt(pr.querySelector('input').value||'1',10)||1, active:ac.querySelector('input').checked,
      preference_notes:nt.querySelector('input').value||null };
    sb.disabled=true;
    apiPost('/api/admin-hotel-preferences-save',body).then(function(r){ sb.disabled=false;
      if(r.status===401){ onUnauthorized(); return; }
      if(r.ok&&r.data&&r.data.saved){ adminToast(ES?'Hotel guardado':'Hotel saved'); fill(null); load(); }
      else adminToast(ES?'Revisa los campos.':'Check the fields.');
    }).catch(function(){ sb.disabled=false; });
  });
  load();
  return p;
}

/* ============ ETAPA 8 — PASAJEROS Y LOGÍSTICA ============ */
function panelPassengers(role){
  const isStaff=role==='staff';
  const p=el('<div class="bk-screen"></div>');
  const listWrap=el('<div></div>'); p.appendChild(listWrap);

  function backToList(){ p.innerHTML=''; p.appendChild(listWrap); loadList(); }

  function loadList(){
    listWrap.innerHTML='<p class="bk-sub-hint">'+(ES?'Cargando…':'Loading…')+'</p>';
    apiGet('/api/admin-passenger-intakes').then(function(r){
      if(r.status===401){ onUnauthorized(); return; }
      if(!r.ok||!r.data){ listWrap.innerHTML='<p class="bk-sub-hint">'+(ES?'No se pudo cargar.':'Could not load.')+'</p>'; return; }
      renderList(r.data.intakes||[]);
    });
  }
  function alertText(a){ const m={ missing_passengers:(ES?'faltan pasajeros':'missing passengers'), connection_tbd_unresolved:(ES?'ciudad por definir':'city to resolve'), missing_arrival:(ES?'falta llegada':'missing arrival') }; return m[a]||a; }
  function renderList(rows){
    listWrap.innerHTML='';
    if(!rows.length){ listWrap.appendChild(el('<p class="bk-sub-hint">'+(ES?'Aún no hay formularios de pasajeros.':'No passenger forms yet.')+'</p>')); return; }
    rows.forEach(function(it){
      const c=el('<div class="fin-sec" style="margin-bottom:8px;cursor:pointer"></div>');
      const alerts=(it.alerts||[]).map(function(a){ return '<span class="notif-badge notif-failed">'+escapeHtml(alertText(a))+'</span>'; }).join(' ');
      c.appendChild(el('<div><b>'+escapeHtml(it.booking_code||'—')+'</b> · '+escapeHtml(it.customer_name||'')+' <span class="notif-badge">'+escapeHtml(it.status)+'</span></div>'));
      c.appendChild(el('<div class="bk-sub-hint">'+escapeHtml(it.tour_name||'')+' · '+escapeHtml(it.booking_date||'')+' · '+(ES?'Pax ':'Pax ')+it.pax_completed+'/'+it.pax_expected+' · '+(ES?'Ciudad ':'City ')+escapeHtml(it.preferred_connection_city||'—')+' '+alerts+'</div>'));
      c.addEventListener('click',function(){ openDetail(it.form_id); });
      listWrap.appendChild(c);
    });
  }

  function openDetail(formId){
    apiGet('/api/admin-passenger-intake-detail?form_id='+encodeURIComponent(formId)).then(function(r){
      if(r.status===401){ onUnauthorized(); return; }
      if(!r.ok||!r.data){ adminToast(ES?'No se pudo abrir.':'Could not open.'); return; }
      renderDetail(r.data);
    });
  }
  function renderDetail(d){
    p.innerHTML='';
    const back=el('<button class="mini-btn" type="button">‹ '+(ES?'Volver':'Back')+'</button>'); back.addEventListener('click',backToList); p.appendChild(back);
    const f=d.form||{}, b=d.booking||{};
    const head=el('<div class="fin-sec"></div>');
    head.appendChild(el('<div><b>'+escapeHtml(b.booking_code||'')+'</b> · '+escapeHtml(b.customer_name||'')+' <span class="notif-badge">'+escapeHtml(f.status||'')+'</span></div>'));
    head.appendChild(el('<div class="bk-sub-hint">'+escapeHtml(b.tour_name||'')+' · '+escapeHtml(b.booking_date||'')+' · Pax '+escapeHtml(b.guests||'')+' · '+(ES?'Ciudad ':'City ')+escapeHtml(f.preferred_connection_city||'—')+' · '+(ES?'Llegada ':'Arrival ')+escapeHtml(f.ecuador_arrival_date||'—')+' '+escapeHtml(f.arrival_airport||'')+'</div>'));
    p.appendChild(head);

    // pasajeros
    (d.passengers||[]).forEach(function(pax){
      const c=el('<div class="fin-sec" style="margin-bottom:8px"></div>');
      c.appendChild(el('<div><b>'+(ES?'Pasajero ':'Passenger ')+escapeHtml(pax.passenger_number)+'</b> · '+escapeHtml([pax.legal_first_name,pax.legal_last_name].filter(Boolean).join(' ')||'—')+'</div>'));
      const bits=[];
      if(pax.nationality) bits.push((ES?'Nac.: ':'Nat.: ')+escapeHtml(pax.nationality));
      if(pax.document_type) bits.push((ES?'Doc: ':'Doc: ')+escapeHtml(pax.document_type)+(pax.document_masked?(' '+escapeHtml(pax.document_masked)):''));
      if(pax.dietary_requirements) bits.push((ES?'Dieta: ':'Diet: ')+escapeHtml(pax.dietary_requirements));
      if(pax.special_assistance) bits.push((ES?'Asist.: ':'Assist.: ')+escapeHtml(pax.special_assistance));
      if(pax.accessibility_or_mobility_needs) bits.push((ES?'Movilidad: ':'Mobility: ')+escapeHtml(pax.accessibility_or_mobility_needs));
      c.appendChild(el('<div class="bk-sub-hint">'+bits.join(' · ')+'</div>'));
      if(!isStaff && pax.has_document && pax.passenger_id){
        const rv=el('<button class="mini-btn" type="button">'+(ES?'Ver documento':'Reveal document')+'</button>');
        rv.addEventListener('click',function(){ revealDoc(pax.passenger_id, rv); });
        c.appendChild(rv);
      }
      p.appendChild(c);
    });

    // lodging
    if((d.lodging||[]).length){
      const lh=el('<div class="fin-sec"><h4>'+(ES?'Alojamiento':'Lodging')+'</h4></div>');
      (d.lodging||[]).forEach(function(l){
        lh.appendChild(el('<div class="bk-sub-hint"><b>'+escapeHtml(l.destination)+'</b> · '+escapeHtml(l.status)+' · '+(l.lodging_required?(ES?'requiere':'required'):(ES?'no requiere':'not required'))+(l.nights?(' · '+l.nights+(ES?' noches':' nights')):'')+(l.rooms_required?(' · '+l.rooms_required+(ES?' hab':' rooms')):'')+' · '+escapeHtml(l.source)+'</div>'));
      });
      p.appendChild(lh);
    }

    if(!isStaff) renderActions(d, f, b);
  }

  function revealDoc(passengerId, btn){
    const reason=window.prompt(ES?'Motivo para ver el documento (obligatorio):':'Reason to reveal the document (required):');
    if(!reason||!reason.trim()) return;
    btn.disabled=true;
    apiPost('/api/admin-passenger-document-reveal',{passenger_id:passengerId, reason:reason.trim()}).then(function(r){
      btn.disabled=false;
      if(r.status===401){ onUnauthorized(); return; }
      if(r.ok&&r.data&&r.data.document_number){ adminToast((ES?'Documento: ':'Document: ')+r.data.document_number); }
      else if(r.ok&&r.data&&r.data.has_document===false){ adminToast(ES?'Sin documento guardado.':'No document saved.'); }
      else adminToast(ES?'No se pudo revelar.':'Could not reveal.');
    }).catch(function(){ btn.disabled=false; });
  }

  function renderActions(d, f, b){
    const box=el('<div class="fin-sec"><h4>'+(ES?'Acciones':'Actions')+'</h4></div>');
    const noteIn=el('<div class="ed-field"><label>'+(ES?'Nota de cambios (para el cliente)':'Changes note (to the customer)')+'</label><input></div>'); box.appendChild(noteIn);
    const row=el('<div style="display:flex;gap:8px;flex-wrap:wrap"></div>');
    const rc=el('<button class="mini-btn" type="button">'+(ES?'Solicitar cambios':'Request changes')+'</button>');
    const rv=el('<button class="mini-btn" type="button">'+(ES?'Marcar revisado':'Mark reviewed')+'</button>');
    const cp=el('<button class="mini-btn" type="button">'+(ES?'Marcar completo':'Mark complete')+'</button>');
    const rn=el('<button class="mini-btn" type="button">'+(ES?'Renovar enlace':'Renew link')+'</button>');
    row.appendChild(rc); row.appendChild(rv); row.appendChild(cp); row.appendChild(rn); box.appendChild(row);
    p.appendChild(box);
    function act(url, body, okMsg){ apiPost(url, body).then(function(r){ if(r.status===401){ onUnauthorized(); return; } if(r.ok&&r.data&&(r.data.saved||r.data.renewed)){ adminToast(okMsg); if(r.data.form_url) window.prompt(ES?'Nuevo enlace del formulario:':'New form link:', r.data.form_url); openDetail(f.form_id); } else adminToast(ES?'No se pudo aplicar.':'Could not apply.'); }); }
    rc.addEventListener('click',function(){ act('/api/admin-passenger-intake-request-changes',{form_id:f.form_id, note:noteIn.querySelector('input').value||''}, ES?'Cambios solicitados':'Changes requested'); });
    rv.addEventListener('click',function(){ act('/api/admin-passenger-intake-review',{form_id:f.form_id, action:'reviewed'}, ES?'Marcado revisado':'Marked reviewed'); });
    cp.addEventListener('click',function(){ act('/api/admin-passenger-intake-review',{form_id:f.form_id, action:'complete'}, ES?'Marcado completo':'Marked complete'); });
    rn.addEventListener('click',function(){ act('/api/admin-passenger-intake-renew',{form_id:f.form_id}, ES?'Enlace renovado':'Link renewed'); });
  }

  loadList();
  return p;
}

function panelsFor(role){
  if(role==='staff'){
    return [
      {id:'schedule', label:(ES?'Agenda de reservas':'Booking schedule'), build:panelStaffSchedule},
      {id:'passengers', label:(ES?'Pasajeros':'Passengers'), build:function(){ return panelPassengers('staff'); }}
    ];
  }
  const panels=[
    {id:'bookings',label:(ES?'Reservas':'Bookings'), build:panelBookings},
    {id:'finance', label:(ES?'Finanzas':'Finance'), build:function(){ return panelFinance(role); }},
    {id:'notes', label:(ES?'Notas de paquetes':'Package notes'), build:function(){ return panelPackageNotes(role); }},
    {id:'passengers', label:(ES?'Pasajeros y logística':'Passengers & logistics'), build:function(){ return panelPassengers(role); }},
    {id:'hotels', label:(ES?'Hoteles preferidos':'Preferred hotels'), build:function(){ return panelHotelPreferences(role); }},
    {id:'notifications', label:(ES?'Notificaciones':'Notifications'), build:function(){ return panelNotifications(role); }}
  ];
  // Datos de prueba: SOLO owner (no se genera en el DOM para admin ni staff).
  if(role==='owner'){
    panels.push({id:'testdata', label:(ES?'Datos de prueba':'Test data'), build:function(){ return panelTestData(role); }});
  }
  panels.push(
    {id:'site',  label:'Site & Contact', build:panelSite},
    {id:'hero',  label:'Home Hero',      build:panelHero},
    {id:'packages',label:'Packages',     build:panelPackages},
    {id:'tours', label:'Tours',          build:panelTours},
    {id:'fishing',label:'Sport Fishing', build:panelFishing},
    {id:'story', label:'About & Conservation', build:panelStory}
  );
  return panels;
}

/* ============ ADMIN SHELL ============ */
function showAdmin(user){
  user=user||{};
  const isStaff = user.role==='staff';
  const PANELS = panelsFor(user.role);
  const who = escapeHtml(user.full_name||'') + (user.role?(' · '+roleLabel(user.role)):'');
  shell.innerHTML=
   '<div class="admin-top">'
     +'<div class="brand-mini"><img src="assets/img/logo.png"><b>Hook Admin</b></div>'
     +'<div class="actions">'
       +'<span style="color:rgba(255,255,255,.72);font-size:12.5px;font-weight:600">'+who+'</span>'
       +'<div class="lang-mini" id="langToggle" title="'+(ES?'Idioma':'Language')+'">'
          +'<button type="button" data-lang="en" class="'+(ES?'':'on')+'">EN</button>'
          +'<button type="button" data-lang="es" class="'+(ES?'on':'')+'">ES</button>'
        +'</div>'
       // Los controles del editor de contenido NO se generan para staff.
       +(isStaff?'':'<span class="save-state" id="saveState"></span>')
       +'<a class="mini-btn" href="index.html" target="_blank">'+I.eye+' View site</a>'
       +(isStaff?'':'<button class="mini-btn" id="resetBtn">Reset all</button>')
       +'<button class="mini-btn" id="logoutBtn">'+I.out+' Log out</button>'
       +(isStaff?'':'<button class="btn btn-gold btn-sm" id="saveBtn">'+I.save+' Save changes</button>')
     +'</div>'
   +'</div>'
   +'<div class="admin-body">'
     +'<nav class="admin-nav" id="adminNav"></nav>'
     +'<main class="admin-main" id="adminMain"></main>'
   +'</div>';

  const nav=document.getElementById('adminNav');
  const main=document.getElementById('adminMain');
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
  open(PANELS[0].id);

  if(!isStaff){
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
  }
  const langTog=document.getElementById('langToggle');
  if(langTog){
    langTog.querySelectorAll('button[data-lang]').forEach(function(b){
      b.addEventListener('click',function(){
        const want=b.dataset.lang;                 // 'en' | 'es'
        if((want==='es')===ES) return;             // ya está en ese idioma
        if(dirty && !confirm(ES?'Tienes cambios sin guardar. ¿Cambiar de idioma de todos modos?':'You have unsaved changes. Switch language anyway?')) return;
        try{ localStorage.setItem('GHA_LANG', want); }catch(e){}
        dirty=false;                               // evita el aviso beforeunload al recargar
        location.reload();
      });
    });
  }
  document.getElementById('logoutBtn').addEventListener('click',()=>{
    if(dirty && !confirm('You have unsaved changes. Log out anyway?')) return;
    apiPost('/api/admin-logout',{}).then(function(){ showLogin(); }).catch(function(){ showLogin(); });
  });
  window.addEventListener('beforeunload',e=>{ if(dirty){ e.preventDefault(); e.returnValue=''; } });
}

/* ============ boot ============ */
apiGet('/api/admin-session').then(function(r){
  if(r.ok && r.data && r.data.authenticated) showAdmin(r.data.user);
  else showLogin();
}).catch(function(){ showLogin(); });
})();
