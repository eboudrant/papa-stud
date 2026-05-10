/**
 * Wrap any `<img src="/api/images?path=...">` whose target is an APNG with a
 * canvas + control bar (prev / play-pause / next / scrub / counter). Static
 * PNGs are left alone. Decoding uses the vendored UPNG.js (with
 * pako_inflate); the browser doesn't expose any way to pause or seek inside
 * an animated PNG natively.
 */

(function () {
  const META_CACHE = new Map(); // path → {apng,frameCount,plays} promise

  async function fetchMeta(imagePath) {
    if (META_CACHE.has(imagePath)) return META_CACHE.get(imagePath);
    const p = fetch('/api/images/meta?path=' + encodeURIComponent(imagePath))
      .then(r => r.ok ? r.json() : { apng: false })
      .catch(() => ({ apng: false }));
    META_CACHE.set(imagePath, p);
    return p;
  }

  function imagePathFromSrc(src) {
    try {
      const u = new URL(src, window.location.href);
      if (!u.pathname.startsWith('/api/images')) return null;
      return u.searchParams.get('path');
    } catch { return null; }
  }

  function decodeFrames(buffer) {
    const png = window.UPNG.decode(buffer);
    const rgba = window.UPNG.toRGBA8(png);
    return {
      width: png.width,
      height: png.height,
      frames: rgba.map((data, i) => ({
        data: new Uint8ClampedArray(data),
        delay: (png.frames[i] && png.frames[i].delay) || 100,
      })),
    };
  }

  function makeControls() {
    const bar = document.createElement('div');
    bar.className = 'apng-controls';
    bar.innerHTML = `
      <button class="apng-btn apng-prev" title="Previous frame (←)">‹</button>
      <button class="apng-btn apng-play" title="Play / Pause (Space)">▶</button>
      <button class="apng-btn apng-next" title="Next frame (→)">›</button>
      <input type="range" class="apng-scrub" min="0" value="0" step="1">
      <span class="apng-count">0 / 0</span>
    `;
    return bar;
  }

  function enhance(img) {
    const imagePath = imagePathFromSrc(img.getAttribute('src'));
    if (!imagePath) return;
    if (img.dataset.apngEnhanced === 'pending' || img.dataset.apngEnhanced === 'done') return;
    img.dataset.apngEnhanced = 'pending';

    fetchMeta(imagePath).then(async meta => {
      if (!meta.apng || !meta.frameCount || meta.frameCount < 2) {
        img.dataset.apngEnhanced = 'done';
        return;
      }
      // Detached during the await? Bail.
      if (!img.isConnected) return;

      let decoded;
      try {
        const buf = await fetch(img.src).then(r => r.arrayBuffer());
        decoded = decodeFrames(buf);
      } catch (e) {
        console.warn('[apng] decode failed:', e);
        img.dataset.apngEnhanced = 'done';
        return;
      }
      if (!img.isConnected) return;

      const { width, height, frames } = decoded;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      // Inherit the styling/sizing the layout had pinned on the <img>.
      if (img.id) canvas.id = img.id;
      if (img.className) canvas.className = img.className;
      canvas.style.cssText = img.style.cssText;
      const ctx = canvas.getContext('2d');

      const wrap = document.createElement('div');
      wrap.className = 'apng-wrap';
      wrap.appendChild(canvas);
      const controls = makeControls();
      wrap.appendChild(controls);

      const prevBtn = controls.querySelector('.apng-prev');
      const playBtn = controls.querySelector('.apng-play');
      const nextBtn = controls.querySelector('.apng-next');
      const scrub = controls.querySelector('.apng-scrub');
      const count = controls.querySelector('.apng-count');
      scrub.max = String(frames.length - 1);

      let idx = 0;
      let playing = false;
      let timer = null;

      function render(i) {
        idx = ((i % frames.length) + frames.length) % frames.length;
        ctx.putImageData(new ImageData(frames[idx].data, width, height), 0, 0);
        scrub.value = String(idx);
        count.textContent = `${idx + 1} / ${frames.length}`;
      }

      function tick() {
        if (!playing) return;
        timer = setTimeout(() => { render(idx + 1); tick(); }, frames[idx].delay);
      }

      function play() {
        if (playing) return;
        playing = true;
        playBtn.textContent = '⏸';
        tick();
      }

      function pause() {
        playing = false;
        playBtn.textContent = '▶';
        if (timer) { clearTimeout(timer); timer = null; }
      }

      prevBtn.addEventListener('click', () => { pause(); render(idx - 1); });
      nextBtn.addEventListener('click', () => { pause(); render(idx + 1); });
      playBtn.addEventListener('click', () => playing ? pause() : play());
      scrub.addEventListener('input', () => { pause(); render(parseInt(scrub.value, 10)); });

      img.replaceWith(wrap);
      img.dataset.apngEnhanced = 'done';
      render(0);
      play();
    }).catch(() => { img.dataset.apngEnhanced = 'done'; });
  }

  function enhanceAll(root = document) {
    if (!window.UPNG) return; // vendor not loaded
    const imgs = root.querySelectorAll('img[src*="/api/images"]');
    imgs.forEach(enhance);
  }

  window.papastudApng = { enhanceAll };
})();
