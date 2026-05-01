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
    loading.style.display = "block";
    if (!capturedBlob)              { loading.style.display = "none"; showErr("Take a picture first."); return; }
    if (!isValidEmail(capturedEmail)){ loading.style.display = "none"; showErr("No valid email — please retake."); return; }
    const fd = new FormData();
    fd.append("image", capturedBlob, safeName(capturedEmail) + ".jpg");
    fd.append("email", capturedEmail);
    try {
      const r = await fetch("/api/banana", { method: "POST", body: fd });
      if (!r.ok) throw new Error(await r.text() || `HTTP ${r.status}`);
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
      loading.style.display = "none";
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
    startBtn.disabled = on;
    stopBtn.disabled  = !on;
  }

  startBtn.addEventListener("click", async () => {
    setStatus("Connecting…");
    const Conversation = await loadConvai();
    if (!Conversation) { setStatus("Could not load voice SDK. Check your connection."); return; }
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        await navigator.mediaDevices.getUserMedia({ audio: true });
      }
    } catch (e) { setStatus("Microphone permission is required."); return; }
    try {
      convo = await Conversation.startSession({
        agentId: AGENT_ID,
        connectionType: "websocket",
        onConnect:    () => { setActive(true);  setStatus("Connected. Speak whenever you like."); },
        onDisconnect: () => { setActive(false); setStatus("Conversation ended."); },
        onError:      (err) => { console.error(err); setStatus("Something went wrong. Tap Start to retry."); setActive(false); },
        onModeChange: m => {
          const mode = (m && m.mode) || m;
          if      (mode === "speaking")  setStatus("🔊 Concierge speaking…");
          else if (mode === "listening") setStatus("🎙️ Listening…");
        },
      });
    } catch (e) {
      console.error(e);
      setStatus("Could not start the voice agent. Please try again.");
      setActive(false);
    }
  });

  stopBtn.addEventListener("click", async () => {
    if (convo) { try { await convo.endSession(); } catch (_) {} convo = null; }
    setActive(false);
    setStatus("Tap <strong>Start</strong> to begin again.");
  });

  // Tap orb = start
  orb.addEventListener("click", () => { if (!startBtn.disabled) startBtn.click(); });

  return {
    onHide: async () => {
      if (convo) { try { await convo.endSession(); } catch (_) {} convo = null; setActive(false); }
    },
  };
})();

/* ─────────────────────────────  FAST LAP  ───────────────────────── */

const fastlap = (() => {
  const canvas = $("#lapCanvas");
  const ctx = canvas.getContext("2d");
  const overlay = $("#lapOverlay");
  const msgTitle = $("#lapMsgTitle");
  const msgSub   = $("#lapMsgSub");
  const startBtn = $("#lapStart");
  const timeEl   = $("#lapTime");
  const bestEl   = $("#lapBest");
  const speedEl  = $("#lapSpeed");

  const carImg   = new Image(); carImg.src   = "/assets/mxu_f1_car_sprite.png";
  const trackImg = new Image(); trackImg.src = "/assets/mxu_track_overlay.png";
  let trackReady = false; trackImg.onload = () => trackReady = true;
  let carReady   = false;   carImg.onload = () => carReady = true;

  const W = 1000, H = 600;

  // Track centerline (looped)
  const TRACK = [
    [180, 470],[140, 400],[140, 280],[210, 200],[330, 170],
    [470, 200],[560, 260],[640, 230],[760, 180],[860, 220],
    [880, 320],[820, 410],[700, 440],[600, 420],[510, 470],
    [380, 510],[260, 510]
  ];
  const TRACK_W = 78;
  const START_IDX = 0;
  const HALFWAY_IDX = Math.floor(TRACK.length / 2);

  let car = { x: 200, y: 470, angle: 0, v: 0 };
  let keys = { left:false, right:false, gas:false, brake:false };
  let running = false, startedAt = 0, elapsed = 0, lapDone = false;
  let crossedHalf = false;
  let raf = 0;

  const bestKey = "mxu_fast_lap_v1";
  const readBest = () => { const v = +localStorage.getItem(bestKey); return Number.isFinite(v) && v > 0 ? v : null; };
  const writeBest = t => localStorage.setItem(bestKey, String(t));
  const showBest = () => { const b = readBest(); bestEl.textContent = b ? b.toFixed(2) + "s" : "—"; };

  function distToSeg(px, py, ax, ay, bx, by){
    const dx = bx-ax, dy = by-ay;
    const t = Math.max(0, Math.min(1, ((px-ax)*dx + (py-ay)*dy) / (dx*dx + dy*dy || 1)));
    const cx = ax + t*dx, cy = ay + t*dy;
    return Math.hypot(px-cx, py-cy);
  }
  function trackInfo(px, py){
    let min = Infinity, idx = 0;
    for (let i = 0; i < TRACK.length; i++){
      const a = TRACK[i], b = TRACK[(i+1) % TRACK.length];
      const d = distToSeg(px, py, a[0], a[1], b[0], b[1]);
      if (d < min) { min = d; idx = i; }
    }
    return { dist: min, segIdx: idx };
  }

  function drawTrack(){
    if (trackReady) {
      ctx.drawImage(trackImg, 0, 0, W, H);
      // semi-transparent overlay so the track-line we draw still pops
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(0,0,W,H);
    } else {
      // Stylized fallback
      const g = ctx.createLinearGradient(0,0,0,H);
      g.addColorStop(0, "#0d2114"); g.addColorStop(1, "#06120a");
      ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
    }

    ctx.lineCap = "round"; ctx.lineJoin = "round";

    // Outer kerb (red-white motif)
    ctx.beginPath();
    ctx.moveTo(TRACK[0][0], TRACK[0][1]);
    for (let i = 1; i <= TRACK.length; i++) ctx.lineTo(TRACK[i % TRACK.length][0], TRACK[i % TRACK.length][1]);
    ctx.lineWidth = TRACK_W * 2 + 12;
    ctx.strokeStyle = "#e10600";
    ctx.stroke();
    ctx.lineWidth = TRACK_W * 2 + 4;
    ctx.strokeStyle = "#fff";
    ctx.stroke();

    // Asphalt
    ctx.lineWidth = TRACK_W * 2;
    ctx.strokeStyle = "#1a1a1d";
    ctx.stroke();

    // Centerline dashes
    ctx.lineWidth = 3;
    ctx.setLineDash([14, 16]);
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.stroke();
    ctx.setLineDash([]);

    // Start/finish bar
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

  function drawCar(){
    ctx.save();
    ctx.translate(car.x, car.y);
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

  function reset(){
    car.x = TRACK[0][0] + 20; car.y = TRACK[0][1] - 10;
    const next = TRACK[1];
    car.angle = Math.atan2(next[1] - car.y, next[0] - car.x);
    car.v = 0;
    elapsed = 0; lapDone = false; crossedHalf = false;
    timeEl.textContent = "0.00"; speedEl.textContent = "0";
  }

  function frame(){
    raf = requestAnimationFrame(frame);

    const accel = 0.2, reverseAccel = 0.16, maxV = 6.0, maxReverseV = -3.2, friction = 0.985, brakeF = 0.92, turn = 0.055;

    if (running){
      if (keys.gas)   car.v = Math.min(maxV, car.v + accel);
      if (keys.brake) car.v = Math.max(maxReverseV, car.v - reverseAccel);
      if (!keys.gas && !keys.brake)  car.v *= friction;
      if (keys.gas && keys.brake) car.v *= brakeF;
      if (Math.abs(car.v) > 0.1){
        if (keys.left)  car.angle -= turn * (car.v / maxV);
        if (keys.right) car.angle += turn * (car.v / maxV);
      }

      const prevX = car.x, prevY = car.y;
      car.x += Math.cos(car.angle) * car.v;
      car.y += Math.sin(car.angle) * car.v;

      // Hard track borders: bounce back and stop off-track driving
      const info = trackInfo(car.x, car.y);
      if (info.dist > TRACK_W) {
        car.x = prevX;
        car.y = prevY;
        car.v *= -0.25;
      }

      // Halfway gate
      if (!crossedHalf && Math.abs(info.segIdx - HALFWAY_IDX) <= 1) crossedHalf = true;

      // Finish: cross start/finish AFTER halfway
      if (crossedHalf && info.segIdx === START_IDX && info.dist < TRACK_W && elapsed > 1.2) finishLap();

      elapsed = (performance.now() - startedAt) / 1000;
      timeEl.textContent = elapsed.toFixed(2);
      speedEl.textContent = Math.round(car.v * 36) + "";
    }

    ctx.clearRect(0,0,W,H);
    drawTrack();

    if (running){
      // halfway gate marker
      const a = TRACK[HALFWAY_IDX], b = TRACK[(HALFWAY_IDX+1) % TRACK.length];
      ctx.save();
      ctx.strokeStyle = crossedHalf ? "#28d96b" : "#ffd400";
      ctx.lineWidth = 5; ctx.setLineDash([10, 8]);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    drawCar();
  }

  function finishLap(){
    running = false; lapDone = true;
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
    running = true;
    startedAt = performance.now();
  }

  startBtn.addEventListener("click", startRun);

  // Touch pad (handles touch + mouse)
  $$("#lapPad .game__pad-btn").forEach(btn => {
    const k = btn.dataset.key;
    const on  = e => { e.preventDefault(); keys[k] = true;  btn.classList.add("is-pressed"); };
    const off = e => { if (e) e.preventDefault(); keys[k] = false; btn.classList.remove("is-pressed"); };
    btn.addEventListener("touchstart", on,  { passive: false });
    btn.addEventListener("touchend",   off, { passive: false });
    btn.addEventListener("touchcancel",off, { passive: false });
    btn.addEventListener("mousedown",  on);
    btn.addEventListener("mouseup",    off);
    btn.addEventListener("mouseleave", off);
  });

  // Keyboard fallback
  document.addEventListener("keydown", e => {
    if (e.key === "ArrowLeft")  keys.left  = true;
    if (e.key === "ArrowRight") keys.right = true;
    if (e.key === "ArrowUp")    keys.gas   = true;
    if (e.key === "ArrowDown")  keys.brake = true;
  });
  document.addEventListener("keyup", e => {
    if (e.key === "ArrowLeft")  keys.left  = false;
    if (e.key === "ArrowRight") keys.right = false;
    if (e.key === "ArrowUp")    keys.gas   = false;
    if (e.key === "ArrowDown")  keys.brake = false;
  });

  return {
    onShow: () => {
      showBest();
      reset();
      overlay.removeAttribute("hidden");
      msgTitle.textContent = "Ready to race?";
      msgSub.textContent   = "One lap · You must cross the half-track gate for the lap to count.";
      startBtn.textContent = "▶  Start Lap";
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    },
    onHide: () => { cancelAnimationFrame(raf); running = false; },
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
  const target = (h && document.querySelector(`[data-panel="${h}"]`)) ? h : "booth";
  activateTab(target);
}, 0);
