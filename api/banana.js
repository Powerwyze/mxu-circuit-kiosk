/**
 * MXU Photo Booth — F1 Driver Restyle
 *
 * Receives multipart/form-data with `image` (jpeg blob) + `email` (string)
 * Calls OpenAI Image Edit (gpt-image-1) with an MXU F1 portrait prompt.
 * Returns the generated image as a binary blob (image/png).
 *
 * Env:
 *   OPENAI_API_KEY        (required)
 *   OPENAI_IMAGE_MODEL    (default: "gpt-image-1")
 *   OPENAI_IMAGE_SIZE     (default: "1024x1024")
 *   OPENAI_IMAGE_QUALITY  (default: "high")
 */

const formidableModule = require("formidable");
const formidable = formidableModule.default || formidableModule;
const fs = require("node:fs");

const OPENAI_URL = "https://api.openai.com/v1/images/edits";

const PROMPT = [
  "Reimagine the person in the photo as a stylized animated Formula 1 driver character — NOT photorealistic.",
  "Render style: bold 2D animated illustration with clean inked outlines, cel-shaded lighting, semi-realistic anime / modern cartoon proportions, painterly highlights — think high-end animated film key art or stylized motorsport poster. Absolutely NOT a photograph.",
  "Wardrobe: sleek MXU Formula 1 racing suit in black and red with white accents, MXU sponsor patches and racing stripes, gloves, helmet either held under one arm or resting on a bench beside them.",
  "Pose & styling: confident magazine-cover hero pose, athletic build, tailored race suit. If the subject reads as female, lean into a fashion-editorial pose — strong stance, hair catching motion, glamorous and powerful (tasteful, never sexualized). If the subject reads as male, lean into an action stance — squared shoulders, slight low-angle hero framing, commanding presence. Either way: cinematic, brand-safe, magazine cover energy.",
  "Setting: the MXU private jet hangar at night — a sleek MXU-branded Formula 1 race car parked prominently next to a sleek private jet in the background (both clearly visible — the F1 car in the mid-ground, the jet just behind it), polished concrete floor with subtle reflections, dramatic red and white spotlights cutting through light haze, the Miami skyline visible through the open hangar doors at dusk.",
  "Color palette: deep blacks, MXU racing red, crisp whites, with warm red rim light and subtle red light streaks for motion.",
  "Mood: confident hero pose, magazine cover energy, cinematic composition.",
  "IMPORTANT: keep the person's face shape, hair style and color, skin tone, ethnicity and overall identity clearly recognizable — but rendered in the animated illustration style described above (stylized, not realistic).",
].join(" ");

function setCors(res){
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

module.exports = async function handler(req, res){
  setCors(res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST")    { res.statusCode = 405; return res.end("Method not allowed"); }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { res.statusCode = 500; return res.end("OPENAI_API_KEY not configured"); }

  const model    = process.env.OPENAI_IMAGE_MODEL   || "gpt-image-1";
  const size     = process.env.OPENAI_IMAGE_SIZE    || "1024x1536";
  const quality  = process.env.OPENAI_IMAGE_QUALITY || "medium";

  // Parse multipart
  let imagePath = null, email = "";
  try {
    const form = formidable({ multiples: false, maxFileSize: 25 * 1024 * 1024 });
    const [fields, files] = await form.parse(req);
    email = String(fields.email?.[0] || "").trim();
    const f = files.image?.[0];
    if (!f) { res.statusCode = 400; return res.end("Missing image"); }
    imagePath = f.filepath;
  } catch (e) {
    console.error("parse error", e);
    res.statusCode = 400; return res.end("Invalid form data: " + e.message);
  }

  // Build OpenAI multipart body using global FormData / Blob (Node 20+)
  let upstream;
  try {
    const fileBuf = fs.readFileSync(imagePath);
    const fd = new FormData();
    fd.append("model",   model);
    fd.append("prompt",  PROMPT);
    fd.append("size",    size);
    fd.append("quality", quality);
    fd.append("n",       "1");
    fd.append("image",   new Blob([fileBuf], { type: "image/jpeg" }), "input.jpg");

    upstream = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: fd,
    });
  } catch (e) {
    console.error("openai fetch error", e);
    res.statusCode = 502; return res.end("Upstream error: " + e.message);
  } finally {
    try { fs.unlinkSync(imagePath); } catch (_) {}
  }

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => "");
    console.error("openai error", upstream.status, errText);
    res.statusCode = upstream.status;
    return res.end(errText || `Upstream HTTP ${upstream.status}`);
  }

  const data = await upstream.json();
  const item = data?.data?.[0];
  let buffer;
  if (item?.b64_json) {
    buffer = Buffer.from(item.b64_json, "base64");
  } else if (item?.url) {
    const r = await fetch(item.url);
    buffer = Buffer.from(await r.arrayBuffer());
  } else {
    res.statusCode = 502; return res.end("No image in OpenAI response");
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-MXU-Email", encodeURIComponent(email).slice(0, 256));
  return res.end(buffer);
};

module.exports.config = {
  api: { bodyParser: false },
};
