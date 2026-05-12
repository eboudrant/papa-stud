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

  // Frame index survives intra-failure re-renders (Toggle T flip, view-mode
  // tab switch) so the user keeps their position when the page rebuilds.
  // Autoplay is one-shot: it fires exactly once per scope (the failure
  // identity), so a Delta open auto-plays but subsequent renders — Toggle,
  // Slider, or even returning to Delta — start paused, ready for frame-by-
  // frame scrubbing. Both reset on scope change. See enhanceAll.
  let SCOPE = null;
  let SCOPE_IDX = 0;
  let SCOPE_AUTOPLAY_FIRED = false;
  // Clocks from prior renders that may still have pending setTimeouts. When
  // detail.js replaces `content.innerHTML`, the old canvases detach but the
  // tick is still in flight — if we don't stop it, the ghost clock advances
  // SCOPE_IDX, and the freshly-built clock hydrates from that bumped value
  // (turning Toggle's T flip into a frame jump).
  const ACTIVE_CLOCKS = new Set();

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
    // Resume at the last frame the same failure was sitting on; the index
    // is later clamped per-canvas based on each sub's own frame count.
    let idx = SCOPE_IDX;
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
      SCOPE_IDX = idx;
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

    const clock = {
      add(sub) {
        subs.push(sub);
        if (sub.frames.length > maxFrames) maxFrames = sub.frames.length;
        // Stale SCOPE_IDX from a longer previous animation could exceed the
        // new maxFrames — clamp so the scrub bar reads correctly.
        if (idx >= maxFrames) { idx = maxFrames - 1; SCOPE_IDX = idx; }
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
      // Permanently stop the clock so an in-flight setTimeout from a prior
      // render can't bump SCOPE_IDX after the canvases have been detached.
      dispose() {
        playing = false;
        if (timer) { clearTimeout(timer); timer = null; }
        subs.length = 0;
        ACTIVE_CLOCKS.delete(clock);
      },
      setIdx,
      get idx() { return idx; },
      get maxFrames() { return maxFrames; },
      get playing() { return playing; },
      on(name, fn) { listeners[name].push(fn); },
    };
    ACTIVE_CLOCKS.add(clock);
    return clock;
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
    // Carry data-* attributes (e.g. data-toggle-title) so callers wired to
    // them keep working post-swap. Skip the apng-loading marker — once we're
    // a canvas, we want to be visible.
    for (const attr of img.attributes) {
      if (attr.name.startsWith('data-') && attr.name !== 'data-apng-enhanced') {
        canvas.setAttribute(attr.name, attr.value);
      }
    }
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

  async function enhanceFullview(fullview, { autoplay = true } = {}) {
    // detail.js renders /api/images imgs with `data-apng-enhanced="pending"`
    // baked in so the CSS hide is synchronous with the innerHTML swap (no
    // window where the browser can paint frame 0 of an APNG). We still
    // re-mark here for any imgs not pre-marked by the caller.
    const imgs = [...fullview.querySelectorAll('img[src*="/api/images"]')]
      .filter(i => i.dataset.apngEnhanced !== 'done');
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

    // One-shot autoplay: Delta's first render in a new scope plays once;
    // Toggle, Slider, and any later Delta re-render start paused so the
    // user can scrub frame-by-frame.
    if (clock && autoplay && !SCOPE_AUTOPLAY_FIRED) {
      clock.play();
      SCOPE_AUTOPLAY_FIRED = true;
    }
  }

  function enhanceAll(root = document, opts = {}) {
    if (!window.UPNG) return;
    // Stop any clocks left over from the previous render before they advance
    // SCOPE_IDX from under us.
    for (const c of ACTIVE_CLOCKS) c.dispose();
    // Reset the resume point + autoplay budget when the failure identity
    // changes; preserve the resume point for intra-failure re-renders so
    // the user keeps their frame when flipping Toggle (T) or view modes.
    if (opts.scope !== undefined && opts.scope !== SCOPE) {
      SCOPE = opts.scope;
      SCOPE_IDX = 0;
      SCOPE_AUTOPLAY_FIRED = false;
    }
    // Process each `.detail-fullview` independently so each gets its own clock.
    // If the root itself is the fullview (or has no fullview children), treat
    // it as a single scope.
    const fullviews = root.matches?.('.detail-fullview')
      ? [root]
      : [...root.querySelectorAll('.detail-fullview')];
    if (fullviews.length === 0) {
      // Root has no .detail-fullview — fall back to whole-root scope.
      enhanceFullview(root, opts);
      return;
    }
    for (const fv of fullviews) enhanceFullview(fv, opts);
  }

  window.papastudApng = { enhanceAll };
})();
