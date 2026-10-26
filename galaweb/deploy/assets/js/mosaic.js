/* ====================================================
   MOSAICO "SÍGUENOS"
   Reparte content.mosaic en columnas con bloques de color y el logo, duplica
   cada columna para que el recorrido de -50 % cierre sin salto y decide
   cuántas columnas caben. Las fotos se piden recién cuando la sección se acerca.
   ==================================================== */
(function(){
  const box = document.getElementById('mosaic');
  const S = window.GHA && window.GHA.content;   // app.js expone el contenido así
  if(!box || !S || !S.mosaic) return;
  const grid = box.querySelector('.mz-grid');
  const stage = box.querySelector('.mz-stage');
  const copy = box.querySelector('.mz-copy-in');
  const btn = box.querySelector('.mz-pause');

  const PER_TILE = 2.92;                                  // segundos por tarjeta
  const SOLIDS = ['gold', 'deep', 'sea', 'sand', 'goldsoft'];
  const PHASE = [-0.9, -0.1, -1.8, -0.5, -2.3, -1.3];     // desfase entre columnas, en tarjetas
  const WIDE = 1080;                                      // desde aquí: texto a la izquierda, muro a la derecha
  let n = 0, near = false;

  /* Una foto de cada tres va precedida por un bloque de color (cada columna recorre la paleta
     con su propio desfase, así dos columnas vecinas no repiten color). El logo va arriba en la
     2ª columna (la de menor desfase, así se ve al entrar) y otra vez a mitad de la 1ª */
  function columns(count){
    const cols = Array.from({ length: count }, () => []);
    S.mosaic.forEach((src, k) => cols[k % count].push(src));
    return cols.map((photos, c) => {
      const cells = [];
      let k = 0;
      photos.forEach((src, j) => {
        if((j + c) % 3 === 0) cells.push({ solid: SOLIDS[(k++ + c * 3) % SOLIDS.length] });
        cells.push({ src });
      });
      if(c === 1) cells.splice(1, 0, { logo: true });
      if(c === 0 && count > 1) cells.splice(Math.floor(cells.length / 2), 0, { logo: true });
      return cells;
    });
  }
  function cell(it){
    if(it.logo) return '<div class="mz-cell mz-logo"><img src="assets/img/logo.png" alt=""></div>';
    if(it.solid) return '<div class="mz-cell mz-solid mz-' + it.solid + '"></div>';
    return '<div class="mz-cell"><img data-src="' + it.src + '" alt="" decoding="async"></div>';
  }
  function build(count){
    n = count;
    box.style.setProperty('--n', count);
    grid.innerHTML = columns(count).map((cells, c) => {
      const html = cells.map(cell).join('');
      const down = c % 2 === 1;
      return '<div class="mz-col' + (down ? ' is-down' : '') + '" style="--ci:' + c
        + ';--from:' + (down ? '-22%' : '22%')
        + ';--dur:' + (cells.length * PER_TILE).toFixed(2) + 's'
        + ';--delay:' + (PHASE[c % PHASE.length] * PER_TILE).toFixed(2) + 's">'
        + '<div class="mz-track">' + html + html + '</div></div>';
    }).join('');
    if(near) load();
  }
  function load(){
    grid.querySelectorAll('img[data-src]').forEach(img => {
      img.addEventListener('load', () => img.classList.add('is-ready'), { once:true });
      img.src = img.dataset.src;
      img.removeAttribute('data-src');
    });
  }

  /* Cuántas columnas caben sin pisar el texto (3 a 6 en pantalla ancha; 3 o 4 en celular/tablet) */
  function fit(){
    const W = box.clientWidth;
    let count, col;
    if(W >= WIDE){
      const gap = 13, right = Math.min(62, Math.max(28, W * .048));
      col = Math.min(215, Math.max(170, W * .16));
      const textRight = copy.getBoundingClientRect().right - box.getBoundingClientRect().left;
      count = Math.max(3, Math.min(6, Math.floor((W - right - textRight - 24 + gap) / (col + gap))));
    } else {
      const gap = 9;
      count = W >= 640 ? 4 : 3;
      col = (stage.clientWidth - (count - 1) * gap) / count;
    }
    box.style.setProperty('--col', col.toFixed(2) + 'px');
    if(count !== n) build(count);
  }

  fit();
  let t = null;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(fit, 120); });

  // las fotos se piden cuando la sección está a menos de ~900 px
  new IntersectionObserver(ents => ents.forEach(e => {
    if(e.isIntersecting && !near){ near = true; load(); }
  }), { rootMargin:'900px 0px' }).observe(box);
  // se mueve solo mientras se ve (ahorra batería); la entrada ocurre una vez
  new IntersectionObserver(ents => ents.forEach(e => {
    box.classList.toggle('mz-run', e.isIntersecting);
    if(e.isIntersecting && e.intersectionRatio >= .2) box.classList.add('mz-in');
  }), { threshold:[0, .2] }).observe(box);

  btn.addEventListener('click', () => {
    const paused = box.classList.toggle('is-paused');
    btn.setAttribute('aria-pressed', paused ? 'true' : 'false');
  });
})();
