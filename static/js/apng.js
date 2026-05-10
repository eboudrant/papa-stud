/**
 * Wrap any `<img src="/api/images?path=...">` whose target is an APNG with a
 * canvas, plus a single shared control bar that drives every APNG in the
 * same `.detail-fullview` in lockstep — so the user can scrub Expected,
 * Diff, and Actual to the same frame for visual diffing. Static PNGs are
 * left alone.
 *
 * Decoding uses the vendored UPNG.js (with pako_inflate); the browser
 * doesn't expose any way to pause or seek inside an animated PNG natively.
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

  // One clock per .detail-fullview. Drives every canvas registered with it
  // to the same frame index. Per-canvas frame counts can differ — each
  // clamps to its own last frame past its end.
  function createClock() {
    const subs = []; // { ctx, frames, width, height }
    let idx = 0;
    let maxFrames = 0;
    let playing = false;
    let timer = null;
    const listeners = { change: [], playState: [] };

    function emit(name, ...args) { for (const fn of listeners[name]) fn(...args); }

    function renderAll() {
      for (const s of subs) {
        const i = Math.min(idx, s.frames.length - 1);
        s.ctx.putImageData(new ImageData(s.frames[i].data, s.width, s.height), 0, 0);
      }
    }

    function setIdx(v) {
      if (!maxFrames) return;
      idx = ((v % maxFrames) + maxFrames) % maxFrames;
      renderAll();
      emit('change', idx, maxFrames);
    }

    // Use the longest delay across active subs so all animations stay
    // roughly aligned to wall-clock time even when their per-frame delays
    // disagree.
    function currentDelay() {
      let d = 100;
      for (const s of subs) {
        const i = Math.min(idx, s.frames.length - 1);
        if (s.frames[i].delay > d) d = s.frames[i].delay;
      }
      return d;
    }

    function tick() {
      if (!playing) return;
      timer = setTimeout(() => { setIdx(idx + 1); tick(); }, currentDelay());
    }

    return {
      add(sub) {
        subs.push(sub);
        if (sub.frames.length > maxFrames) maxFrames = sub.frames.length;
        // Render the new sub at the current idx so it joins in sync.
        const i = Math.min(idx, sub.frames.length - 1);
        sub.ctx.putImageData(new ImageData(sub.frames[i].data, sub.width, sub.height), 0, 0);
        emit('change', idx, maxFrames);
      },
      play() {
        if (playing || !maxFrames) return;
        playing = true;
        emit('playState', true);
        tick();
      },
      pause() {
        if (!playing) return;
        playing = false;
        if (timer) { clearTimeout(timer); timer = null; }
        emit('playState', false);
      },
      setIdx,
      get idx() { return idx; },
      get maxFrames() { return maxFrames; },
      get playing() { return playing; },
      on(name, fn) { listeners[name].push(fn); },
    };
  }

  // Wire one shared control bar to a clock. Returns the bar element.
  function bindControls(clock) {
    const bar = makeControls();
    const prevBtn = bar.querySelector('.apng-prev');
    const playBtn = bar.querySelector('.apng-play');
    const nextBtn = bar.querySelector('.apng-next');
    const scrub = bar.querySelector('.apng-scrub');
    const count = bar.querySelector('.apng-count');

    prevBtn.addEventListener('click', () => { clock.pause(); clock.setIdx(clock.idx - 1); });
    nextBtn.addEventListener('click', () => { clock.pause(); clock.setIdx(clock.idx + 1); });
    playBtn.addEventListener('click', () => clock.playing ? clock.pause() : clock.play());
    scrub.addEventListener('input', () => { clock.pause(); clock.setIdx(parseInt(scrub.value, 10)); });

    clock.on('change', (idx, max) => {
      scrub.max = String(Math.max(0, max - 1));
      scrub.value = String(idx);
      count.textContent = `${idx + 1} / ${max}`;
    });
    clock.on('playState', p => { playBtn.textContent = p ? '⏸' : '▶'; });

    return bar;
  }

  // Replace one <img> with a <canvas>. Doesn't render anything itself —
  // the clock is responsible for that on `add`.
  function buildCanvas(img, width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    if (img.id) canvas.id = img.id;
    if (img.className) canvas.className = img.className;
    canvas.style.cssText = img.style.cssText;
    // Pan/zoom and slider code reads naturalWidth/Height/complete — shim
    // them so swapping in a canvas doesn't require touching those paths.
    canvas.naturalWidth = width;
    canvas.naturalHeight = height;
    canvas.complete = true;
    return canvas;
  }

  // Find or create the host element for the shared control bar.
  function mountBar(fullview, bar) {
    const zoomBar = fullview.querySelector('.zoom-controls');
    if (zoomBar) { zoomBar.appendChild(bar); return; }
    // Layouts without a zoom bar (delta-strip): drop a standalone bar at
    // the bottom of the fullview so it sits below the strip.
    const wrap = document.createElement('div');
    wrap.className = 'apng-strip-bar';
    wrap.appendChild(bar);
    fullview.appendChild(wrap);
  }

  async function enhanceFullview(fullview) {
    const imgs = [...fullview.querySelectorAll('img[src*="/api/images"]')]
      .filter(i => i.dataset.apngEnhanced !== 'done' && i.dataset.apngEnhanced !== 'pending');
    if (!imgs.length) return;
    imgs.forEach(i => { i.dataset.apngEnhanced = 'pending'; });

    // Resolve metas in parallel; keep only APNGs with at least 2 frames.
    const targets = [];
    await Promise.all(imgs.map(async img => {
      const p = imagePathFromSrc(img.getAttribute('src'));
      if (!p) { img.dataset.apngEnhanced = 'done'; return; }
      const meta = await fetchMeta(p);
      if (meta.apng && meta.frameCount >= 2) targets.push(img);
      else img.dataset.apngEnhanced = 'done';
    }));
    if (!targets.length) return;

    let clock = null;
    let bar = null;
    await Promise.all(targets.map(async img => {
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
      const canvas = buildCanvas(img, decoded.width, decoded.height);
      const ctx = canvas.getContext('2d');

      // Lazy-initialize the clock + bar on the first successful decode so we
      // don't mount an empty control bar when every image fails to decode.
      if (!clock) {
        clock = createClock();
        bar = bindControls(clock);
        mountBar(fullview, bar);
      }

      // Slider mode: each img has its own DOM slot we need to preserve. For
      // simple panels (Toggle/Delta strip cells), straight replace.
      img.replaceWith(canvas);
      clock.add({ ctx, frames: decoded.frames, width: decoded.width, height: decoded.height });
      img.dataset.apngEnhanced = 'done';
    }));

    if (clock) clock.play();
  }

  function enhanceAll(root = document) {
    if (!window.UPNG) return;
    // Process each `.detail-fullview` independently so each gets its own clock.
    // If the root itself is the fullview (or has no fullview children), treat
    // it as a single scope.
    const fullviews = root.matches?.('.detail-fullview')
      ? [root]
      : [...root.querySelectorAll('.detail-fullview')];
    if (fullviews.length === 0) {
      // Root has no .detail-fullview — fall back to whole-root scope.
      enhanceFullview(root);
      return;
    }
    for (const fv of fullviews) enhanceFullview(fv);
  }

  window.papastudApng = { enhanceAll };
})();
