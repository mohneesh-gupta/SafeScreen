// SafeScreen content script: finds images and videos, asks the offscreen detector what is in them,
// and covers the regions the user chose to hide. content.css pre-blurs media until it has been
// scanned, so nothing is shown before the detector has looked at it.
(() => {
  if (window.__safeScreenLoaded) return;
  window.__safeScreenLoaded = true;

  const html = document.documentElement;
  // Max side of frames sent for detection. Larger than the detector's 320px input so that
  // face crops for the gender check keep enough detail.
  const SAMPLE_PX = { img: 640, video: 480 };
  const MIN_PX = 24; // skip icons smaller than this on both sides (small face thumbnails are still scanned)
  const VIDEO_INTERVAL_MS = 200;
  const PAD = { img: 0.06, video: 0.15 }; // grow boxes; video content moves between samples
  const VIDEO_HOLD = 3; // keep a video mask for this many missed samples to avoid flicker

  let settings = { ...SS_DEFAULTS };
  let active = false;
  let maskBitmap = null;
  const states = new Map(); // element -> state
  const imageResults = new Map(); // src -> Promise<{detections}|{error}>
  const sampleCanvas = document.createElement("canvas");
  const sampleCtx = sampleCanvas.getContext("2d");

  // ---------- settings ----------
  const topHost = (() => {
    const anc = location.ancestorOrigins;
    try {
      return anc && anc.length ? new URL(anc[anc.length - 1]).hostname : location.hostname;
    } catch {
      return location.hostname;
    }
  })();

  async function applySettings(next) {
    settings = next;
    active = settings.enabled && !settings.pausedSites.includes(topHost);
    html.classList.toggle("ss-off", !active);
    html.classList.toggle("ss-nohide", !settings.hideUntilScanned);
    if (settings.maskStyle === "image") await loadMaskImage();
    if (active) scanDocument();
    scheduleRender();
  }

  async function loadMaskImage() {
    const url = settings.maskImage || (await chrome.runtime.sendMessage({ type: "ss-default-image" }));
    if (!url) return;
    // Decode without a network request so page CSP (img-src/connect-src) can't block it.
    const bin = atob(url.slice(url.indexOf(",") + 1));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    maskBitmap = await createImageBitmap(new Blob([bytes]));
    for (const m of maskPool) m.drawnFor = null;
  }

  ssLoadSettings().then(applySettings);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") ssLoadSettings().then(applySettings);
  });

  // ---------- discovery ----------
  const nearObserver = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const st = states.get(e.target);
        if (!st) continue;
        st.near = e.isIntersecting;
        if (st.near) process(e.target);
      }
    },
    { rootMargin: "100% 0px" }
  );

  // Tracks how much of each element is actually visible (clipped by scroll containers).
  const clipObserver = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const st = states.get(e.target);
        if (!st) continue;
        const b = e.boundingClientRect, r = e.intersectionRect;
        st.clip = e.isIntersecting
          ? { l: r.left - b.left, t: r.top - b.top, r: b.right - r.right, b: b.bottom - r.bottom }
          : null;
      }
      scheduleRender();
    },
    { threshold: Array.from({ length: 21 }, (_, i) => i / 20) }
  );

  function track(el) {
    if (states.has(el)) return;
    const kind = el.tagName === "VIDEO" ? "video" : "img";
    states.set(el, { kind, src: null, detections: [], near: false, clip: null, busy: false, hold: [] });
    nearObserver.observe(el);
    clipObserver.observe(el);
    if (kind === "video") {
      for (const ev of ["loadeddata", "seeked", "play"]) el.addEventListener(ev, () => process(el));
      el.addEventListener("emptied", () => reset(el));
    }
  }

  function reset(el) {
    const st = states.get(el);
    if (!st) return;
    delete el.dataset.ss;
    st.src = null;
    st.detections = [];
    st.hold = [];
    scheduleRender();
  }

  function scanDocument() {
    document.querySelectorAll("img, video").forEach(track);
    for (const [el, st] of states) if (st.near) process(el);
  }

  new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "attributes") {
        if (m.target.tagName === "IMG") reset(m.target), process(m.target);
        continue;
      }
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.tagName === "IMG" || n.tagName === "VIDEO") track(n);
        else if (n.firstElementChild) n.querySelectorAll("img, video").forEach(track);
      }
    }
  }).observe(html, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "srcset"] });

  // Images finish loading after they are discovered; catch every load in capture phase.
  document.addEventListener(
    "load",
    (e) => {
      if (e.target.tagName === "IMG") track(e.target), process(e.target);
    },
    true
  );

  // ---------- detection ----------
  function process(el) {
    const st = states.get(el);
    if (!st || !active || !st.near) return;
    if (st.kind === "img") processImage(el, st);
    else startVideo(el, st);
  }

  // Draws the element scaled to the detector size. Returns a JPEG data URL, or null if the
  // pixels are cross-origin (tainted) and can't be read.
  function grabFrame(el, w, h, kind) {
    const scale = Math.min(1, SAMPLE_PX[kind] / Math.max(w, h));
    sampleCanvas.width = Math.max(1, Math.round(w * scale));
    sampleCanvas.height = Math.max(1, Math.round(h * scale));
    sampleCtx.drawImage(el, 0, 0, sampleCanvas.width, sampleCanvas.height);
    try {
      return sampleCanvas.toDataURL("image/jpeg", 0.85);
    } catch {
      return null;
    }
  }

  async function processImage(el, st) {
    const src = el.currentSrc || el.src;
    if (!src || !el.complete || !el.naturalWidth) return; // the load listener will retry
    if (st.src === src) return;
    st.src = src;

    const rect = el.getBoundingClientRect();
    const tiny = el.naturalWidth < MIN_PX && el.naturalHeight < MIN_PX;
    const tinyOnScreen = rect.width > 0 && rect.width < MIN_PX && rect.height < MIN_PX;
    if (tiny || tinyOnScreen) {
      el.dataset.ss = "skip";
      return;
    }

    if (!imageResults.has(src)) {
      let payload = grabFrame(el, el.naturalWidth, el.naturalHeight, "img");
      // Cross-origin image: the extension fetches it itself (host permissions bypass CORS).
      if (!payload && /^https?:/.test(src)) payload = src;
      imageResults.set(
        src,
        payload ? detect(payload) : Promise.resolve({ error: "unreadable image" })
      );
    }
    const result = await imageResults.get(src);
    if (result.error) imageResults.delete(src); // allow a retry next time it is processed
    if (st.src !== src) return; // image changed while we waited
    finish(el, st, result);
  }

  // Retries while the extension's detector is still starting up (e.g. right after install/update).
  async function detect(src, video = false) {
    for (let attempt = 0; ; attempt++) {
      const result = await chrome.runtime
        .sendMessage({ type: "ss-detect", src, video })
        .catch((e) => ({ error: String(e?.message || e) }));
      if (!result?.error?.includes("Receiving end does not exist") || attempt >= 4) return result ?? { error: "no response" };
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }

  function finish(el, st, result) {
    if (result.error) {
      // Fail closed: if we can't check it, keep it hidden.
      console.debug("[SafeScreen] could not scan", st.src || el, result.error);
      el.dataset.ss = "full";
      st.error = result.error;
      st.detections = [];
    } else {
      st.detections = result.detections;
      el.dataset.ss = "done";
    }
    scheduleRender();
  }

  function startVideo(el, st) {
    if (st.timer) return;
    const tick = async () => {
      if (!states.has(el) || !el.isConnected) return stopVideo(st);
      if (!active || !st.near) return stopVideo(st);
      if (st.busy || el.readyState < 2 || !el.videoWidth) return;
      if (el.paused && st.sampledAt === el.currentTime && el.dataset.ss) return; // still frame, already scanned
      st.busy = true;
      st.sampledAt = el.currentTime;
      const frame = grabFrame(el, el.videoWidth, el.videoHeight, "video");
      if (!frame) {
        st.busy = false;
        stopVideo(st);
        return finish(el, st, { error: "cross-origin video" });
      }
      const result = await detect(frame, true);
      st.busy = false;
      if (result.error) return finish(el, st, result);
      finish(el, st, { detections: holdDetections(st, result.detections) });
    };
    st.timer = setInterval(tick, VIDEO_INTERVAL_MS);
    tick();
  }

  function stopVideo(st) {
    clearInterval(st.timer);
    st.timer = null;
  }

  // Keeps recently seen video detections alive for a few samples so masks don't flicker
  // when the detector briefly misses a frame.
  function holdDetections(st, fresh) {
    const kept = st.hold
      .filter((h) => h.left > 1 && !fresh.some((d) => d.label === h.d.label && overlaps(d, h.d)))
      .map((h) => ({ d: h.d, left: h.left - 1 }));
    st.hold = [...fresh.map((d) => ({ d, left: VIDEO_HOLD })), ...kept];
    return st.hold.map((h) => h.d);
  }

  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  // ---------- rendering ----------
  const layer = document.createElement("div");
  layer.setAttribute("popover", "manual");
  layer.setAttribute("aria-hidden", "true");
  Object.assign(layer.style, {
    position: "fixed", inset: "0", width: "100vw", height: "100vh", maxWidth: "none", maxHeight: "none",
    margin: "0", padding: "0", border: "0", background: "transparent", overflow: "hidden",
    pointerEvents: "none", zIndex: "2147483647", colorScheme: "normal"
  });
  const maskPool = [];
  let renderQueued = false;

  // The popover top layer sits above everything, including fullscreen players.
  function raiseLayer() {
    if (!layer.isConnected) html.appendChild(layer);
    try {
      if (layer.matches(":popover-open")) layer.hidePopover();
      layer.showPopover();
    } catch {
      layer.style.display = "block";
    }
  }
  document.addEventListener("fullscreenchange", raiseLayer);

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(render);
  }

  function wantedLabels() {
    const set = new Set();
    for (const [key, t] of Object.entries(SS_TARGETS)) if (settings.targets[key]) t.labels.forEach((l) => set.add(l));
    return set;
  }

  function render() {
    renderQueued = false;
    let used = 0;
    if (active) {
      const labels = wantedLabels();
      const minScore = SS_THRESHOLDS[settings.sensitivity] ?? SS_THRESHOLDS.medium;
      for (const [el, st] of states) {
        if (!el.isConnected) {
          states.delete(el);
          nearObserver.unobserve(el);
          clipObserver.unobserve(el);
          stopVideo(st);
          continue;
        }
        st.masks = 0;
        if (!st.clip || el.dataset.ss !== "done") continue;
        const hits = st.detections.filter(
          (d) => d.score >= minScore && labels.has(ssFaceLabel(d, settings.sensitivity))
        );
        if (!hits.length) continue;

        const r = el.getBoundingClientRect();
        const box = contentBox(el, r);
        const clip = { l: r.left + st.clip.l, t: r.top + st.clip.t, r: r.right - st.clip.r, b: r.bottom - st.clip.b };
        const pad = PAD[st.kind];
        for (const d of hits) {
          const px = d.w * pad, py = d.h * pad;
          const l = Math.max(clip.l, box.left + (d.x - px) * box.width);
          const t = Math.max(clip.t, box.top + (d.y - py) * box.height);
          const rr = Math.min(clip.r, box.left + (d.x + d.w + px) * box.width);
          const bb = Math.min(clip.b, box.top + (d.y + d.h + py) * box.height);
          if (rr - l < 1 || bb - t < 1) continue;
          drawMask(used++, l, t, rr - l, bb - t);
          st.masks++;
        }
      }
    }
    for (let i = used; i < maskPool.length; i++) maskPool[i].el.style.display = "none";
    if (used) {
      if (!layer.matches(":popover-open")) raiseLayer();
      requestAnimationFrame(() => scheduleRender()); // follow scrolling and video playback
    }
  }

  // Where the media content actually sits inside the element (object-fit letterboxing/cropping).
  function contentBox(el, r) {
    const nw = el.naturalWidth || el.videoWidth, nh = el.naturalHeight || el.videoHeight;
    const fit = getComputedStyle(el).objectFit;
    if (!nw || !nh || fit === "fill" || !r.width || !r.height) return r;
    const s = fit === "cover" ? Math.max(r.width / nw, r.height / nh) : Math.min(r.width / nw, r.height / nh);
    const w = nw * s, h = nh * s;
    return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h };
  }

  function drawMask(i, l, t, w, h) {
    let m = maskPool[i];
    if (!m) {
      const el = document.createElement("div");
      el.style.position = "absolute";
      el.style.borderRadius = "12px";
      el.style.overflow = "hidden";
      const canvas = document.createElement("canvas");
      Object.assign(canvas.style, { width: "100%", height: "100%", display: "block" });
      el.appendChild(canvas);
      layer.appendChild(el);
      m = maskPool[i] = { el, canvas, drawnFor: null };
    }
    const s = m.el.style;
    s.display = "block";
    s.transform = `translate(${l}px, ${t}px)`;
    s.width = `${w}px`;
    s.height = `${h}px`;

    const style = settings.maskStyle === "image" && !maskBitmap ? "blur" : settings.maskStyle; // image not decoded yet
    s.backdropFilter = style === "blur" ? "blur(28px) saturate(0.6)" : "none";
    s.background = style === "blur" ? "rgba(120,120,120,0.25)" : style === "solid" ? settings.maskColor : "#f8e8ee";
    m.canvas.style.display = style === "image" ? "block" : "none";
    if (style === "image") paintImage(m, Math.round(w), Math.round(h));
  }

  function paintImage(m, w, h) {
    const key = `${w}x${h}`;
    if (m.drawnFor === key) return;
    m.drawnFor = key;
    m.canvas.width = w;
    m.canvas.height = h;
    const ctx = m.canvas.getContext("2d");
    const s = Math.max(w / maskBitmap.width, h / maskBitmap.height);
    const dw = maskBitmap.width * s, dh = maskBitmap.height * s;
    ctx.drawImage(maskBitmap, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  addEventListener("scroll", scheduleRender, { passive: true, capture: true });
  addEventListener("resize", scheduleRender, { passive: true });

  // Exposed for automated tests only.
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.type !== "safescreen-test-state") return;
    const items = [];
    for (const [el, st] of states) items.push({ id: el.id, ss: el.dataset.ss || null, detections: st.detections, error: st.error, masks: st.masks || 0, src: st.src, w: el.naturalWidth, h: el.naturalHeight });
    window.postMessage({ type: "safescreen-test-result", items, masks: maskPool.filter((m) => m.el.style.display === "block").length }, "*");
  });
})();
