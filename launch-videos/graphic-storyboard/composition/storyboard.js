// Timeline driver. window.renderFrame(t) lays out every layer for time t (seconds).
(function () {
  const C = window.CONFIG;
  const UI = window.UI;

  // ---------- easing + interpolation ----------
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const lerp = (a, b, k) => a + (b - a) * k;
  const lerpArr = (a, b, k) => a.map((v, i) => lerp(v, b[i], k));
  const span = (t, t0, t1, ease = easeInOut) => ease(clamp01((t - t0) / (t1 - t0)));

  // Interpolate a keyframe list; missing fields inherit from the previous key.
  function sample(keys, t) {
    const filled = [];
    let prev = null;
    for (const k of keys) {
      const f = Object.assign({ o: 1, z: 1, r: C.panelRadius, clip: [0, 0, 0, 0] }, prev || {}, k);
      filled.push(f);
      prev = f;
    }
    if (t <= filled[0].t) return Object.assign({}, filled[0], { pre: true });
    for (let i = 0; i < filled.length - 1; i++) {
      const a = filled[i], b = filled[i + 1];
      if (t >= a.t && t <= b.t) {
        const k = span(t, a.t, b.t);
        return {
          rect: lerpArr(a.rect, b.rect, k),
          o: lerp(a.o, b.o, k),
          z: lerp(a.z, b.z, k),
          r: lerp(a.r, b.r, k),
          f: lerpArr(a.f, b.f, k),
          clip: lerpArr(a.clip, b.clip, k),
        };
      }
    }
    return Object.assign({}, filled[filled.length - 1], { post: true });
  }

  // ---------- DOM ----------
  const stage = document.getElementById("stage");
  const panelsEl = document.getElementById("panels");
  const titleEl = document.getElementById("title");
  const headlineEl = document.getElementById("headline");
  const endEl = document.getElementById("end");
  const captionsEl = document.getElementById("captions");
  headlineEl.textContent = C.text.headline;
  endEl.querySelector(".url").textContent = C.text.endUrl;

  const panels = {};
  for (const [name, def] of Object.entries(C.panels)) {
    const el = document.createElement("div");
    el.className = "panel";
    el.dataset.name = name;
    const content = document.createElement("div");
    content.className = "content";
    content.style.width = def.content[0] + "px";
    content.style.height = def.content[1] + "px";
    el.appendChild(content);
    panelsEl.appendChild(el);
    panels[name] = { el, content, def, html: null };
  }

  // Static content built once; dynamic panels rebuilt when their inputs change.
  function setHtml(p, html) {
    if (p.html !== html) {
      p.content.innerHTML = html;
      p.html = html;
    }
  }
  setHtml(panels.mac, UI.session("mac", "macImg", false));
  setHtml(panels.iphone, UI.session("iphone", "iphoneImg", false));
  setHtml(panels.final, UI.session("mac", "finalImg", true));

  for (const c of C.captions) {
    const el = document.createElement("div");
    el.className = "caption";
    el.textContent = c.text;
    el.style.left = c.x + "px";
    captionsEl.appendChild(el);
    c.el = el;
  }

  const pad = (n) => String(n).padStart(4, "0");
  const frameSrc = (dir, count, seconds) => dir + pad(Math.min(count, Math.max(1, Math.round(seconds * C.fps) + 1))) + ".jpg";

  // Cover-fit content into the panel rect, zoomed around a focus point.
  function fitContent(p, s) {
    const [W, H] = p.def.content;
    const [, , w, h] = s.rect;
    const scale = Math.max(w / W, h / H) * s.z;
    let tx = w / 2 - s.f[0] * scale;
    let ty = h / 2 - s.f[1] * scale;
    tx = Math.min(0, Math.max(w - W * scale, tx));
    ty = Math.min(0, Math.max(h - H * scale, ty));
    p.content.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  }

  function layoutPanel(p, t) {
    const s = sample(p.def.keys, t);
    const visible = !(s.pre || s.post) || s.o > 0;
    p.el.style.display = visible && s.o > 0.001 ? "block" : "none";
    if (!visible) return s;
    const [x, y, w, h] = s.rect;
    p.el.style.left = x + "px";
    p.el.style.top = y + "px";
    p.el.style.width = w + "px";
    p.el.style.height = h + "px";
    p.el.style.borderRadius = s.r + "px";
    p.el.style.opacity = s.o;
    const [ct, cr, cb, cl] = s.clip;
    p.el.style.clipPath = ct || cr || cb || cl ? `inset(${ct}px ${cr}px ${cb}px ${cl}px round ${s.r}px)` : "none";
    fitContent(p, s);
    return s;
  }

  const pending = [];
  function setFrame(id, src) {
    const img = document.getElementById(id);
    if (!img || img.getAttribute("src") === src) return;
    img.src = src;
    pending.push(img.decode().catch(() => {}));
  }

  window.renderFrame = async function (t) {
    pending.length = 0;

    // Title
    {
      const { t0, t1 } = C.title;
      const inK = span(t, t0 + 0.1, t0 + 1.0, easeOut);
      const outK = span(t, t1 - 0.7, t1);
      const drift = 1 + 0.03 * clamp01((t - t0) / (t1 - t0));
      titleEl.style.opacity = inK * (1 - outK);
      titleEl.style.transform = `translateY(${lerp(40, 0, inK) - 90 * outK}px) scale(${lerp(0.97, 1, inK) * drift})`;
      titleEl.style.display = t < t1 ? "flex" : "none";
    }

    // Panels
    const prompt = layoutPanel(panels.prompt, t);
    const code = layoutPanel(panels.code, t);
    const mac = layoutPanel(panels.mac, t);
    const iphone = layoutPanel(panels.iphone, t);
    const verified = layoutPanel(panels.verified, t);
    const fin = layoutPanel(panels.final, t);

    // Composer typing
    {
      const { t0, t1 } = C.typing.prompt;
      const k = clamp01((t - t0) / (t1 - t0));
      const n = Math.round(k * C.text.prompt.length);
      const caret = t < t1 + 0.4 && Math.floor(t * 2.5) % 2 === 0 || (t >= t0 && t < t1);
      setHtml(panels.prompt, UI.composer(C.text.prompt.slice(0, n), caret && t < t1 + 0.6));
    }

    // Swift typing
    {
      const { t0, t1 } = C.typing.code;
      const k = clamp01((t - t0) / (t1 - t0));
      setHtml(panels.code, UI.editor(easeOut(k)));
    }

    // Verified checks stagger
    {
      const start = 18.9;
      const step = Math.floor(clamp01((t - start) / 1.5) * 3.999);
      setHtml(panels.verified, UI.verified(step));
    }

    // Footage frames
    const macT0 = C.panels.mac.keys[0].t;
    const iphT0 = C.panels.iphone.keys[0].t;
    const finT0 = C.panels.final.keys[0].t;
    if (mac.o > 0) setFrame("macImg", frameSrc(C.media.macFrames, C.media.macFrameCount, C.footage.macStart + Math.max(0, t - macT0)));
    if (iphone.o > 0) setFrame("iphoneImg", frameSrc(C.media.iphoneFrames, C.media.iphoneFrameCount, C.footage.iphoneStart + Math.max(0, t - iphT0)));
    if (fin.o > 0) setFrame("finalImg", frameSrc(C.media.macFrames, C.media.macFrameCount, C.footage.macFinalStart + Math.max(0, t - finT0)));

    // Captions
    for (const c of C.captions) {
      const inK = span(t, c.t0, c.t0 + 0.5, easeOut);
      const outK = span(t, c.t1 - 0.4, c.t1);
      const o = inK * (1 - outK);
      c.el.style.opacity = o;
      c.el.style.transform = `translateY(${lerp(16, 0, inK) - 10 * outK}px)`;
      c.el.style.display = o > 0.001 ? "block" : "none";
    }

    // End card
    {
      const { t0, t1 } = C.end;
      const inK = span(t, t0, t0 + 0.9, easeOut);
      const drift = 1 + 0.025 * clamp01((t - t0) / (t1 - t0));
      endEl.style.opacity = inK;
      endEl.style.transform = `scale(${lerp(0.96, 1, inK) * drift})`;
      endEl.style.display = t >= t0 - 0.01 ? "flex" : "none";
    }

    await Promise.all(pending);
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  };

  // Preview in a browser: ?t=12.5 renders one moment; no query plays it back.
  const q = new URLSearchParams(location.search);
  if (q.has("t")) {
    renderFrame(parseFloat(q.get("t")));
  } else if (!q.has("render")) {
    const start = performance.now();
    (function loop() {
      const t = ((performance.now() - start) / 1000) % C.duration;
      renderFrame(t).then(() => requestAnimationFrame(loop));
    })();
  }
})();
