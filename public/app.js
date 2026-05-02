/* ================================================================
 *  MXU Circuit Kiosk · F1 Miami · SPA controller
 *  Portrait-mobile · Photo Booth + Voice Concierge + Fast Lap
 * ================================================================ */

const AGENT_ID = "agent_6101kqg738wzewvb3291v6f5d027";

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const show = el => el && el.removeAttribute("hidden");
const hide = el => el && el.setAttribute("hidden", "");

/* ───────────────────────────  KIOSK LOCKDOWN  ───────────────────── */

(function lockKiosk(){
  // 1. Block right-click / context menu
  document.addEventListener("contextmenu", e => e.preventDefault(), { capture: true });

  // 2. Block dangerous keyboard shortcuts (new tab/window/refresh/etc.)
  const blockKeys = new Set(["t","n","w","r","p","s","u","j","h","l","o","f"]);
  document.addEventListener("keydown", e => {
    const k = (e.key || "").toLowerCase();
    if ((e.ctrlKey || e.metaKey) && blockKeys.has(k)) { e.preventDefault(); e.stopPropagation(); }
    if (e.key === "F11" || e.key === "F5") e.preventDefault();
  }, { capture: true });

  // 3. Disable text-drag, image-drag, free selection (allow inputs)
  document.addEventListener("dragstart", e => e.preventDefault());
  document.addEventListener("selectstart", e => {
    if (!e.target.closest("input, textarea, [contenteditable]")) e.preventDefault();
  });

  // 4. Kill window.open and target=_blank navigation
  try { window.open = () => null; } catch (_) {}

  // 5. Hijack ALL anchor clicks. Internal hashes route via tabs;
  //    external links open in our in-app iframe modal.
  document.addEventListener("click", e => {
    const a = e.target.closest("a");
    if (!a) return;
    if (a.dataset.tab) { e.preventDefault(); activateTab(a.dataset.tab); return; }
    const href = a.getAttribute("href") || "";
    if (!href) return;
    if (href.startsWith("#")) {
      e.preventDefault();
      const name = href.slice(1);
      if (name && document.querySelector(`[data-panel="${name}"]`)) activateTab(name);
      return;
    }
    if (/^https?:/i.test(href)) {
      e.preventDefault();
      openIframe(href, a.dataset.label || a.textContent.trim());
    }
  }, { capture: true });

  // 6. Disable pinch-zoom gesture events (Safari)
  ["gesturestart","gesturechange","gestureend"].forEach(ev =>
    document.addEventListener(ev, e => e.preventDefault())
  );
})();

/* ───────────────────────────  TAB ROUTER  ───────────────────────── */

function activateTab(name){
  $$(".tab").forEach(t => {
    const on = t.dataset.tab === name;
    t.classList.toggle("is-active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
  });
  $$(".panel").forEach(p => {
    const on = p.dataset.panel === name;
    p.classList.toggle("is-active", on);
    p.setAttribute("aria-hidden", on ? "false" : "true");
  });
  if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
  window.scrollTo({ top: 0, behavior: "smooth" });

  if (name === "booth")   booth.onShow();   else booth.onHide();
  if (name === "fastlap") fastlap.onShow(); else fastlap.onHide();
  if (name !== "voice")   voice.onHide();
}

document.addEventListener("click", e => {
  const t = e.target.closest("[data-tab]");
  if (!t) return;
  e.preventDefault();
  activateTab(t.dataset.tab);
});

window.addEventListener("hashchange", () => {
  const h = location.hash.replace("#","");
  if (h && document.querySelector(`[data-panel="${h}"]`)) activateTab(h);
});

/* ──────────────────────────  IFRAME MODAL  ──────────────────────── */

function openIframe(url, title){
  const modal = $("#iframeModal");
  $("#iframeTitle").textContent = title || "External";
  $("#iframeFrame").src = url;
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
}
function closeIframe(){
  const modal = $("#iframeModal");
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
  $("#iframeFrame").src = "about:blank";
}
$("#iframeClose")?.addEventListener("click", closeIframe);

/* ──────────────────────────  EMAIL MODAL  ───────────────────────── */
/* Replaces native prompt() — kiosk-friendly */

const emailModal = (() => {
  const modal  = $("#emailModal");
  const input  = $("#emailModalInput");
  const errEl  = $("#emailModalErr");
  const okBtn  = $("#emailModalOk");
  const cancel = $("#emailModalCancel");
  let resolver = null;

  const isValid = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  function open(){
    return new Promise(res => {
      resolver = res;
      input.value = "";
      errEl.textContent = "";
      modal.classList.add("is-open");
      modal.setAttribute("aria-hidden", "false");
      setTimeout(() => input.focus(), 30);
    });
  }
  function close(value){
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    const r = resolver; resolver = null;
    r && r(value);
  }
  okBtn.addEventListener("click", () => {
    const v = (input.value || "").trim();
    if (!isValid(v)) { errEl.textContent = "Please enter a valid email address."; return; }
    close(v);
  });
  cancel.addEventListener("click", () => close(null));
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); okBtn.click(); }
    if (e.key === "Escape") close(null);
  });
  return { open };
})();

/* ─────────────────────────────  BOOTH  ──────────────────────────── */

const booth = (() => {
  const cam        = $("#boothCam");
  const preview    = $("#boothPreview");
  const canvas     = $("#boothCanvas");
  const startCamBtn= $("#boothStart");
  const switchBtn  = $("#boothSwitch");
  const captureBtn = $("#boothCapture");
  const retakeBtn  = $("#boothRetake");
  const generateBtn= $("#boothGenerate");
  const countdown  = $("#boothCountdown");
  const flashEl    = $("#boothFlash");
  const emailPill  = $("#boothEmailPill");
  const loading    = $("#boothLoading");
  const loadingVideo = $("#boothLoadingVideo");

  function showLoading(on) {
    loading.style.display = on ? "block" : "none";
    if (!loadingVideo) return;
    if (on) {
      try { loadingVideo.currentTime = 0; } catch(_) {}
      const p = loadingVideo.play();
      if (p && typeof p.catch === "function") p.catch(() => { /* autoplay blocked — poster still shows */ });
    } else {
      loadingVideo.pause();
    }
  }
  const errEl      = $("#boothErr");
  const out        = $("#boothOut");
  const result     = $("#boothResult");
  const emailBtn   = $("#boothEmail");
  const emailStat  = $("#boothEmailStatus");

  let stream = null, capturedBlob = null, capturedEmail = "", facing = "user";
  let generatedBlob = null, generatedMime = "image/png";

  const isValidEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const safeName = e => e.trim().toLowerCase().replace(/[^a-z0-9@._-]/g,"_").replace(/@/g,"_at_");
  const showErr = m => { errEl.textContent = m; errEl.style.display = "block"; };
  const clearErr = () => { errEl.textContent = ""; errEl.style.display = "none"; };

  async function stop(){ if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } }

  function videoReady(timeoutMs = 1800){
    return new Promise(res => {
      const t0 = Date.now();
      const tick = () => {
        if (cam.videoWidth > 0 && cam.videoHeight > 0) return res(true);
        if (Date.now() - t0 > timeoutMs) return res(false);
        requestAnimationFrame(tick);
      };
      tick();
    });
  }

  async function start(autoFlip = true){
    try {
      clearErr();
      await stop();
      const order = [facing, facing === "user" ? "environment" : "user"];
      let booted = false, lastErr;
      for (const f of order) {
        const tries = [
          { video: { facingMode: { ideal: f }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
          { video: { facingMode: f }, audio: false },
          { video: true, audio: false },
        ];
        for (const c of tries) {
          try {
            stream = await navigator.mediaDevices.getUserMedia(c);
            cam.srcObject = stream;
            cam.muted = true;
            cam.setAttribute("playsinline","");
            await cam.play();
            const ok = await videoReady(1800);
            if (ok) { facing = f; booted = true; break; }
            await stop();
          } catch (e) { lastErr = e; }
        }
        if (booted) break;
      }
      if (!booted) throw lastErr || new Error("Unable to access camera");
      show(cam); hide(preview);
      hide(retakeBtn); hide(generateBtn);
    } catch (e) {
      if (autoFlip) { facing = facing === "user" ? "environment" : "user"; return start(false); }
      showErr(`Camera unavailable. Tap Switch then Start Camera. (${e.message})`);
    }
  }

  async function runCountdown(seconds = 5){
    countdown.style.display = "flex";
    for (let i = seconds; i >= 1; i--) {
      countdown.textContent = i;
      await new Promise(r => setTimeout(r, 1000));
    }
    countdown.textContent = "📸";
    await new Promise(r => setTimeout(r, 220));
    countdown.style.display = "none";
  }

  function flash(){
    flashEl.classList.add("on");
    setTimeout(() => flashEl.classList.remove("on"), 170);
  }

  function capture(){
    if (!cam.videoWidth || !cam.videoHeight){
      showErr("Camera is not ready yet. Wait a moment and try again.");
      return;
    }
    canvas.width = cam.videoWidth;
    canvas.height = cam.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(cam, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      capturedBlob = blob;
      preview.src = URL.createObjectURL(blob);
      hide(cam); show(preview);
      show(retakeBtn); show(generateBtn);
    }, "image/jpeg", 0.95);
  }

  async function captureFlow(){
    clearErr();
    const email = await emailModal.open();
    if (!email) return;
    capturedEmail = email.trim();
    emailPill.textContent = `📧 ${capturedEmail}`;
    emailPill.style.display = "block";
    await runCountdown(5);
    flash();
    capture();
  }

  function retake(){
    capturedBlob = null;
    hide(preview); show(cam);
    hide(retakeBtn); hide(generateBtn);
  }

  async function generate(){
    clearErr();
    out.style.display = "none";
    showLoading(true);
    if (!capturedBlob)              { showLoading(false); showErr("Take a picture first."); return; }
    if (!isValidEmail(capturedEmail)){ showLoading(false); showErr("No valid email — please retake."); return; }
    const fd = new FormData();
    fd.append("image", capturedBlob, safeName(capturedEmail) + ".jpg");
    fd.append("email", capturedEmail);
    try {
      const r = await fetch("/api/banana", { method: "POST", body: fd });
      if (!r.ok) {
        const ctype = r.headers.get("content-type") || "";
        let msg = `HTTP ${r.status}`;
        if (ctype.includes("application/json")) {
          try { const j = await r.json(); msg = j.error || j.message || msg; } catch(_) {}
        } else {
          // Vercel error pages are HTML — surface a friendly summary instead of raw HTML
          if (r.status === 504 || r.status === 408) msg = "The portrait took too long to generate. Please try again.";
          else if (r.status === 502 || r.status === 503) msg = "The image service is busy. Please try again in a moment.";
          else if (r.status >= 500) msg = "Something went wrong on our end. Please try again.";
        }
        throw new Error(msg);
      }
      const blob = await r.blob();
      generatedBlob = blob;
      generatedMime = blob.type || "image/png";
      result.src = URL.createObjectURL(blob);
      emailStat.textContent = "";
      out.style.display = "block";
      // Reset capture state but keep result visible for next guest
      capturedBlob = null;
      hide(preview); show(cam);
      hide(retakeBtn); hide(generateBtn);
      await start();
    } catch (e) {
      showErr(`Failed: ${e.message}`);
    } finally {
      showLoading(false);
    }
  }

  async function compress(blob){
    const img = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d");
    const max = 768;
    const s = Math.min(1, max / Math.max(img.width, img.height));
    c.width  = Math.max(1, Math.round(img.width  * s));
    c.height = Math.max(1, Math.round(img.height * s));
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const toBlob = q => new Promise(r => c.toBlob(r, "image/jpeg", q));
    const b64FromBlob = async b => {
      const arr = await b.arrayBuffer();
      let bin = ""; const bytes = new Uint8Array(arr);
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    };
    let q = 0.8, o = await toBlob(q), b64 = await b64FromBlob(o);
    while (b64.length > 220000 && q > 0.35){ q -= 0.1; o = await toBlob(q); b64 = await b64FromBlob(o); }
    return { b64, mimeType: "image/jpeg" };
  }

  async function sendEmail(){
    clearErr();
    if (!generatedBlob)              { showErr("Generate a portrait first."); return; }
    if (!isValidEmail(capturedEmail)){ showErr("No valid email saved.");      return; }
    emailStat.textContent = "Sending…";
    emailBtn.disabled = true;
    try {
      const { b64, mimeType } = await compress(generatedBlob);
      const r = await fetch("/api/send-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: capturedEmail,
          filename: safeName(capturedEmail) + "-mxu-f1-miami.jpg",
          mimeType: mimeType || generatedMime || "image/jpeg",
          imageBase64: b64,
        }),
      });
      if (!r.ok) throw new Error(await r.text() || `HTTP ${r.status}`);
      emailStat.textContent = "✅ Sent. Check your inbox.";
    } catch (e) {
      emailStat.textContent = `Send failed: ${e.message}`;
    } finally {
      emailBtn.disabled = false;
    }
  }

  startCamBtn.addEventListener("click",  () => start(false));
  switchBtn  .addEventListener("click",  () => { facing = facing === "user" ? "environment" : "user"; start(false); });
  captureBtn .addEventListener("click",  captureFlow);
  retakeBtn  .addEventListener("click",  retake);
  generateBtn.addEventListener("click",  generate);
  emailBtn   .addEventListener("click",  sendEmail);

  return {
    onShow: () => { if (navigator.mediaDevices?.getUserMedia) start(); },
    onHide: () => { stop(); },
  };
})();

/* ─────────────────────────  VOICE CONCIERGE  ────────────────────── */

const voice = (() => {
  const startBtn  = $("#voiceStart");
  const stopBtn   = $("#voiceStop");
  const statusEl  = $("#voiceStatus");
  const orb       = $("#voiceOrb");
  const panel     = $("#voicePanel");

  let convo = null, ConvoClass = null;
  let connecting = false; // guards against double-start (orb + button race)

  async function loadConvai(){
    if (ConvoClass) return ConvoClass;
    const urls = [
      "https://esm.sh/@elevenlabs/client",
      "https://cdn.jsdelivr.net/npm/@elevenlabs/client/+esm",
      "https://unpkg.com/@elevenlabs/client?module",
    ];
    for (const u of urls) {
      try {
        const mod = await import(u);
        if (mod && mod.Conversation) { ConvoClass = mod.Conversation; return ConvoClass; }
      } catch (e) { console.warn("convai CDN failed", u, e); }
    }
    return null;
  }

  function setStatus(m){ statusEl.innerHTML = m; }
  function setActive(on){
    panel.classList.toggle("is-listening", on);
    startBtn.disabled = on || connecting;
    stopBtn.disabled  = !on;
    orb.classList.toggle("is-active", on);
    orb.classList.toggle("is-connecting", connecting);
  }

  async function startVoice(){
    // Hard guard: only ONE session can ever be in flight.
    if (convo || connecting) return;
    connecting = true;
    startBtn.disabled = true;
    orb.classList.add("is-connecting");
    setStatus("Connecting…");

    const Conversation = await loadConvai();
    if (!Conversation) {
      connecting = false;
      orb.classList.remove("is-connecting");
      startBtn.disabled = false;
      setStatus("Could not load voice SDK. Check your connection.");
      return;
    }
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        await navigator.mediaDevices.getUserMedia({ audio: true });
      }
    } catch (e) {
      connecting = false;
      orb.classList.remove("is-connecting");
      startBtn.disabled = false;
      setStatus("Microphone permission is required.");
      return;
    }
    try {
      const session = await Conversation.startSession({
        agentId: AGENT_ID,
        connectionType: "websocket",
        onConnect:    () => { connecting = false; setActive(true);  setStatus("Connected. Speak whenever you like."); },
        onDisconnect: () => { convo = null; connecting = false; setActive(false); setStatus("Conversation ended. Tap <strong>Start</strong> to begin again."); },
        onError:      (err) => { console.error(err); convo = null; connecting = false; setActive(false); setStatus("Something went wrong. Tap Start to retry."); },
        onModeChange: m => {
          const mode = (m && m.mode) || m;
          if      (mode === "speaking")  setStatus("🔊 Concierge speaking…");
          else if (mode === "listening") setStatus("🎙️ Listening…");
        },
      });
      // If a parallel call already created a convo, end this duplicate.
      if (convo) { try { await session.endSession(); } catch (_) {} return; }
      convo = session;
    } catch (e) {
      console.error(e);
      connecting = false;
      setActive(false);
      setStatus("Could not start the voice agent. Please try again.");
    }
  }

  async function stopVoice(){
    if (convo) { try { await convo.endSession(); } catch (_) {} convo = null; }
    connecting = false;
    setActive(false);
    setStatus("Tap <strong>Start</strong> to begin again.");
  }

  startBtn.addEventListener("click", startVoice);
  stopBtn .addEventListener("click", stopVoice);

  // Orb tap toggles: start if idle, stop if active. Never double-fires.
  orb.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (convo)            { stopVoice();  return; }
    if (connecting)       { return; }
    startVoice();
  });

  return {
    onHide: async () => {
      if (convo) { try { await convo.endSession(); } catch (_) {} convo = null; }
      connecting = false;
      setActive(false);
    },
  };
})();

/* ─────────────────────────────  FAST LAP  ───────────────────────── */
/*
 * Clean rebuild — Bicycle-model steering for predictable, sticky control.
 *
 * PHYSICS MODEL
 * -------------
 * Steering input s ∈ [-1, +1] from a sticky drag-to-rotate wheel.
 * Effective road-wheel angle  δ = s * MAX_STEER_RAD  (≈ ±32°).
 * Each frame, with car speed v and wheelbase L:
 *     car.angle += (v / L) * tan(δ) * dt
 *     car.x     += cos(angle) * v * dt
 *     car.y     += sin(angle) * v * dt
 *
 * Why this works:
 *  - Stationary car ⇒ no rotation (v=0 cancels the term). No phantom turning.
 *  - Slow car ⇒ tight, gentle radius. Fast car ⇒ wider radius. NO spin-out.
 *  - The relationship is fixed and intuitive: more wheel = more turn,
 *    same wheel angle behaves the same way every time.
 *  - Sticky wheel: wheel holds its angle on release; only Start Lap recenters.
 */

const fastlap = (() => {
  /* ── DOM refs ────────────────────────────────────────────────────── */
  const canvas   = $("#lapCanvas");
  const ctx      = canvas.getContext("2d");
  const overlay  = $("#lapOverlay");
  const msgTitle = $("#lapMsgTitle");
  const msgSub   = $("#lapMsgSub");
  const startBtn = $("#lapStart");
  const timeEl   = $("#lapTime");
  const bestEl   = $("#lapBest");
  const speedEl  = $("#lapSpeed");
  const wheelEl  = $("#lapWheel");

  /* ── Assets ──────────────────────────────────────────────────────── */
  const carImg   = new Image(); carImg.src   = "/assets/mxu_f1_car_sprite.png";
  const trackImg = new Image(); trackImg.src = "/assets/mxu_track_overlay.png";
  let trackReady = false; trackImg.onload = () => trackReady = true;
  let carReady   = false;   carImg.onload  = () => carReady   = true;

  /* ── World ──────────────────────────────────────────────────────── */
  const W = 1000, H = 600;

  // Track centerline (looped polyline)
  const TRACK = [
    [180, 470],[140, 400],[140, 280],[210, 200],[330, 170],
    [470, 200],[560, 260],[640, 230],[760, 180],[860, 220],
    [880, 320],[820, 410],[700, 440],[600, 420],[510, 470],
    [380, 510],[260, 510]
  ];
  const TRACK_W    = 78;
  const START_IDX  = 0;
  const HALFWAY_IDX = Math.floor(TRACK.length / 2);

  /* ── Tuning constants (the heart of feel) ───────────────────────── */
  // Speed (units = pixels/frame at 60fps)
  const MAX_V        = 4.6;     // top forward speed
  const MAX_REVERSE  = -2.2;    // top reverse speed (~half of forward)
  const ACCEL        = 0.085;   // gas acceleration per frame
  const REVERSE_ACC  = 0.06;    // reverse acceleration per frame
  const ENGINE_BRAKE = 0.985;   // multiplicative friction when no pedal

  // Steering (bicycle model). The turn radius at full lock is approximately
  // R = WHEELBASE / tan(MAX_STEER_RAD). With these values:
  //   R ≈ 90 / tan(0.55) ≈ 147 px — comfortably wider than the car (60 px)
  //   and well-matched to the inner radius of the track corners.
  // Turn rate at top speed + full lock ≈ 1.9 rad/s — smooth, never whips.
  const MAX_STEER_RAD = 0.55;   // ~32° road-wheel angle at full lock
  const WHEELBASE     = 90;     // pixels — effective front/rear axle distance
  // Visual wheel range: how far the user must drag to reach full lock
  const MAX_WHEEL_DEG = 150;
  // Keyboard nudge per arrow keypress (degrees)
  const KEY_NUDGE_DEG = 15;

  // Border bleed — when the car hits the kerb
  const BORDER_BLEED  = 0.55;

  /* ── State ──────────────────────────────────────────────────────── */
  const car = { x: 200, y: 470, angle: 0, v: 0 };
  // input.steer is the analog wheel value in [-1, +1]. Pedals are booleans.
  const input = { gas: false, reverse: false, steer: 0 };
  let running = false, startedAt = 0, elapsed = 0;
  let crossedHalf = false;
  let raf = 0;
  let lastTs = 0;

  /* ── Best-time persistence ──────────────────────────────────────── */
  const BEST_KEY = "mxu_fast_lap_v1";
  const readBest  = () => { const v = +localStorage.getItem(BEST_KEY); return Number.isFinite(v) && v > 0 ? v : null; };
  const writeBest = t => localStorage.setItem(BEST_KEY, String(t));
  const showBest  = () => { const b = readBest(); bestEl.textContent = b ? b.toFixed(2) + "s" : "—"; };

  /* ── Geometry helpers ───────────────────────────────────────────── */
  function closestOnTrack(px, py){
    let bestD = Infinity, bestX = px, bestY = py, bestIdx = 0;
    for (let i = 0; i < TRACK.length; i++){
      const a = TRACK[i], b = TRACK[(i+1) % TRACK.length];
      const dx = b[0]-a[0], dy = b[1]-a[1];
      const len2 = dx*dx + dy*dy || 1;
      const t = Math.max(0, Math.min(1, ((px-a[0])*dx + (py-a[1])*dy) / len2));
      const cx = a[0] + t*dx, cy = a[1] + t*dy;
      const d = Math.hypot(px-cx, py-cy);
      if (d < bestD){ bestD = d; bestX = cx; bestY = cy; bestIdx = i; }
    }
    return { dist: bestD, cx: bestX, cy: bestY, segIdx: bestIdx };
  }

  /* ── Render ─────────────────────────────────────────────────────── */
  function drawTrack(){
    if (trackReady) {
      ctx.drawImage(trackImg, 0, 0, W, H);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(0,0,W,H);
    } else {
      const g = ctx.createLinearGradient(0,0,0,H);
      g.addColorStop(0, "#0d2114"); g.addColorStop(1, "#06120a");
      ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
    }

    ctx.lineCap = "round"; ctx.lineJoin = "round";

    // Build the closed track path once
    ctx.beginPath();
    ctx.moveTo(TRACK[0][0], TRACK[0][1]);
    for (let i = 1; i <= TRACK.length; i++) {
      ctx.lineTo(TRACK[i % TRACK.length][0], TRACK[i % TRACK.length][1]);
    }

    // Outer red kerb
    ctx.lineWidth = TRACK_W * 2 + 12;
    ctx.strokeStyle = "#e10600";
    ctx.stroke();
    // White kerb stripe
    ctx.lineWidth = TRACK_W * 2 + 4;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    // Asphalt (light grey)
    ctx.lineWidth = TRACK_W * 2;
    ctx.strokeStyle = "#b9bcc3";
    ctx.stroke();
    // Centerline dashes
    ctx.lineWidth = 3;
    ctx.setLineDash([14, 16]);
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.stroke();
    ctx.setLineDash([]);

    // Start/finish — checkered bar
    const a = TRACK[START_IDX], b = TRACK[(START_IDX+1) % TRACK.length];
    const mx = (a[0]+b[0])/2, my = (a[1]+b[1])/2;
    const ang = Math.atan2(b[1]-a[1], b[0]-a[0]) + Math.PI/2;
    ctx.save(); ctx.translate(mx, my); ctx.rotate(ang);
    const tiles = 14, tileW = (TRACK_W*2)/tiles, tileH = 14;
    for (let i = 0; i < tiles; i++){
      ctx.fillStyle = (i % 2) ? "#fff" : "#111";
      ctx.fillRect(-TRACK_W + i*tileW, -tileH/2, tileW, tileH);
    }
    ctx.restore();
  }

  function drawHalfwayGate(){
    const a = TRACK[HALFWAY_IDX], b = TRACK[(HALFWAY_IDX+1) % TRACK.length];
    ctx.save();
    ctx.strokeStyle = crossedHalf ? "#28d96b" : "#ffd400";
    ctx.lineWidth = 5; ctx.setLineDash([10, 8]);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawCar(){
    ctx.save();
    ctx.translate(car.x, car.y);
    // Sprite faces "up" (negative Y); car.angle uses screen convention (0 = +X).
    ctx.rotate(car.angle + Math.PI/2);
    if (carReady) {
      const cw = 60, ch = 96;
      ctx.drawImage(carImg, -cw/2, -ch/2, cw, ch);
    } else {
      ctx.fillStyle = "#e10600"; ctx.fillRect(-12, -22, 24, 44);
      ctx.fillStyle = "#111";    ctx.fillRect(-9,  -10, 18, 14);
    }
    ctx.restore();
  }

  /* ── Step (physics) ─────────────────────────────────────────────── */
  function step(dt){
    // 0. Update analog steering from held arrow buttons / keys.
    updateSteer(dt);

    // 1. Throttle / reverse — apply along the car's current heading.
    if (input.gas && !input.reverse) {
      car.v = Math.min(MAX_V, car.v + ACCEL * dt);
    } else if (input.reverse && !input.gas) {
      car.v = Math.max(MAX_REVERSE, car.v - REVERSE_ACC * dt);
    } else {
      car.v *= Math.pow(ENGINE_BRAKE, dt);
      if (Math.abs(car.v) < 0.02) car.v = 0;
    }

    // 2. Bicycle-model steering.
    //    angle += (v / L) * tan(δ) * dt
    //    Reverse: signed v naturally flips the steering direction (correct).
    const s     = Math.max(-1, Math.min(1, input.steer));
    const delta = s * MAX_STEER_RAD;
    if (Math.abs(car.v) > 0.01) {
      car.angle += (car.v / WHEELBASE) * Math.tan(delta) * dt;
    }

    // 3. Tentative new position.
    let nx = car.x + Math.cos(car.angle) * car.v * dt;
    let ny = car.y + Math.sin(car.angle) * car.v * dt;

    // 4. Hard track borders — clamp inside the asphalt corridor.
    const HALF = TRACK_W - 14;
    const info = closestOnTrack(nx, ny);
    if (info.dist > HALF){
      const nxv = (nx - info.cx) / (info.dist || 1);
      const nyv = (ny - info.cy) / (info.dist || 1);
      nx = info.cx + nxv * HALF;
      ny = info.cy + nyv * HALF;
      car.v *= BORDER_BLEED;
    }
    car.x = nx; car.y = ny;

    // 5. Halfway gate (segment-based, robust to direction).
    if (!crossedHalf && Math.abs(info.segIdx - HALFWAY_IDX) <= 1) {
      crossedHalf = true;
    }

    // 6. Lap finish: must have crossed halfway, be near start, moving forward.
    if (crossedHalf && info.segIdx === START_IDX && info.dist < HALF
        && elapsed > 1.2 && car.v > 0) {
      finishLap();
    }
  }

  function frame(ts){
    raf = requestAnimationFrame(frame);

    // Frame-time normalized to 60fps (so dt ≈ 1 at 60fps).
    // Clamp huge gaps (tab-switch etc.) to keep physics stable.
    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / (1000 / 60);
    lastTs = ts;
    if (!Number.isFinite(dt) || dt <= 0) dt = 1;
    if (dt > 3) dt = 3;

    if (running) {
      step(dt);
      elapsed = (performance.now() - startedAt) / 1000;
      timeEl.textContent  = elapsed.toFixed(2);
      // Display speed: pixels/frame → "km/h" feel (cosmetic only).
      speedEl.textContent = Math.round(Math.abs(car.v) * 36) + "";
    }

    ctx.clearRect(0, 0, W, H);
    drawTrack();
    if (running) drawHalfwayGate();
    drawCar();
  }

  /* ── Lap lifecycle ──────────────────────────────────────────────── */
  function reset(){
    car.x = TRACK[0][0] + 20;
    car.y = TRACK[0][1] - 10;
    const next = TRACK[1];
    car.angle = Math.atan2(next[1] - car.y, next[0] - car.x);
    car.v = 0;
    elapsed = 0;
    crossedHalf = false;
    timeEl.textContent  = "0.00";
    speedEl.textContent = "0";
    // Recenter steering for a fresh lap.
    input.steer = 0;
    heldDir.left = false;
    heldDir.right = false;
  }

  function finishLap(){
    running = false;
    const t = elapsed;
    const prev = readBest();
    const isBest = !prev || t < prev;
    if (isBest) writeBest(t);
    showBest();
    msgTitle.textContent = isBest ? "🏆  New Personal Best" : "Lap complete";
    msgSub.innerHTML = `Time: <strong>${t.toFixed(2)}s</strong>${prev ? ` · Best: <strong>${(isBest ? t : prev).toFixed(2)}s</strong>` : ""}`;
    startBtn.textContent = "↻  Race Again";
    overlay.removeAttribute("hidden");
  }

  function startRun(){
    overlay.setAttribute("hidden", "");
    reset();
    running   = true;
    startedAt = performance.now();
  }

  startBtn.addEventListener("click", startRun);

  /* ── Pedals (GAS + REVERSE) ─────────────────────────────────────── */
  $$("#lapPad .pedal").forEach(btn => {
    const k   = btn.dataset.key;
    const on  = e => { e.preventDefault(); input[k] = true;  btn.classList.add("is-pressed"); };
    const off = e => { if (e) e.preventDefault(); input[k] = false; btn.classList.remove("is-pressed"); };
    btn.addEventListener("touchstart",  on,  { passive: false });
    btn.addEventListener("touchend",    off, { passive: false });
    btn.addEventListener("touchcancel", off, { passive: false });
    btn.addEventListener("mousedown",   on);
    btn.addEventListener("mouseup",     off);
    btn.addEventListener("mouseleave",  off);
  });

  /* ── Steering: hold-to-turn arrow buttons + arrow keys ──────────── */
  // input.steer is an analog value in [-1, +1] that ramps toward the
  // direction held and decays back toward 0 when released. Per-frame
  // ramp/decay rates (per 60fps frame):
  const STEER_RAMP  = 0.085;  // how fast steering builds up while held
  const STEER_DECAY = 0.18;   // how fast it returns to center on release
  const heldDir = { left: false, right: false };

  // Wire on-screen LEFT/RIGHT buttons.
  $$("#lapPad .steerbtn").forEach(btn => {
    const k   = btn.dataset.key; // "left" | "right"
    const on  = e => { e.preventDefault(); heldDir[k] = true;  btn.classList.add("is-pressed"); };
    const off = e => { if (e) e.preventDefault(); heldDir[k] = false; btn.classList.remove("is-pressed"); };
    btn.addEventListener("touchstart",  on,  { passive: false });
    btn.addEventListener("touchend",    off, { passive: false });
    btn.addEventListener("touchcancel", off, { passive: false });
    btn.addEventListener("mousedown",   on);
    btn.addEventListener("mouseup",     off);
    btn.addEventListener("mouseleave",  off);
  });

  // Arrow-key fallback for desktop.
  document.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.key === "ArrowLeft")  { heldDir.left  = true; e.preventDefault(); }
    if (e.key === "ArrowRight") { heldDir.right = true; e.preventDefault(); }
    if (e.key === "ArrowUp")    { input.gas     = true; e.preventDefault(); }
    if (e.key === "ArrowDown")  { input.reverse = true; e.preventDefault(); }
  });
  document.addEventListener("keyup", (e) => {
    if (e.key === "ArrowLeft")  heldDir.left  = false;
    if (e.key === "ArrowRight") heldDir.right = false;
    if (e.key === "ArrowUp")    input.gas     = false;
    if (e.key === "ArrowDown")  input.reverse = false;
  });

  // Per-frame steering update: ramp toward held direction, decay otherwise.
  function updateSteer(dt){
    if (heldDir.left && !heldDir.right) {
      input.steer = Math.max(-1, input.steer - STEER_RAMP * dt);
    } else if (heldDir.right && !heldDir.left) {
      input.steer = Math.min( 1, input.steer + STEER_RAMP * dt);
    } else {
      // Decay toward center
      if (input.steer >  0) input.steer = Math.max(0, input.steer - STEER_DECAY * dt);
      else if (input.steer < 0) input.steer = Math.min(0, input.steer + STEER_DECAY * dt);
    }
  }

  /* ── Public API (preserved exactly) ─────────────────────────────── */
  return {
    onShow: () => {
      showBest();
      reset();
      overlay.removeAttribute("hidden");
      msgTitle.textContent = "Ready to race?";
      msgSub.textContent   = "One lap · You must cross the half-track gate for the lap to count.";
      startBtn.textContent = "▶  Start Lap";
      cancelAnimationFrame(raf);
      lastTs = 0;
      raf = requestAnimationFrame(frame);
    },
    onHide: () => {
      cancelAnimationFrame(raf);
      running = false;
      input.gas = false;
      input.reverse = false;
    },
  };
})();

/* ─────────────────────────────  LIVE BADGE  ─────────────────────── */

(function liveBadge(){
  const QUALI_START = new Date("2026-05-02T16:00:00-04:00");
  const RACE_START  = new Date("2026-05-04T16:00:00-04:00");
  const RACE_END    = new Date("2026-05-04T18:30:00-04:00");
  const dayEl = $("#liveDay"), timeEl = $("#liveTime"), badge = $("#liveBadge");

  function tick(){
    const now = new Date();
    let label = "May 1–3", isLive = false;
    if (now < QUALI_START){
      const ms = QUALI_START - now;
      const days = Math.floor(ms / 86400000);
      label = days >= 1 ? `In ${days}d` : "Race week";
      dayEl.textContent = "F1 MIAMI";
    } else if (now >= QUALI_START && now < RACE_START){
      isLive = true; dayEl.textContent = "QUALI WEEKEND"; label = "Live now";
    } else if (now >= RACE_START && now < RACE_END){
      isLive = true; dayEl.textContent = "RACE DAY"; label = "Live now";
    } else {
      dayEl.textContent = "SEE YOU IN '27"; label = "Closed";
    }
    timeEl.textContent = label;
    badge.classList.toggle("is-live", isLive);
  }
  tick(); setInterval(tick, 30000);
})();

/* ────────────────────────────  BOOT  ────────────────────────────── */

setTimeout(() => {
  const h = location.hash.replace("#","");
  const target = (h && document.querySelector(`[data-panel="${h}"]`)) ? h : "home";
  activateTab(target);
}, 0);


