/**
 * MXU Photo Booth — Email Delivery
 *
 * POST JSON: { email, filename, mimeType, imageBase64 }
 * Sends the generated F1 portrait to the guest via Gmail SMTP.
 *
 * Env (preferred — wyzer):
 *   WYZER_APP_PASSWORD    Gmail app password for wyzer@powerwyze.com
 *   WYZER_GMAIL_USER      defaults to "wyzer@powerwyze.com"
 *
 * Env (fallback — legacy):
 *   GOOGLE_APP_PASSWORD   Gmail app password
 *   GMAIL_USER            defaults to "spc.bstewart@gmail.com"
 *
 *   FROM_NAME             default: "MXU Circuit"
 */

const nodemailer = require("nodemailer");

function setCors(res){
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function readJson(req){
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", c => { raw += c; if (raw.length > 12 * 1024 * 1024) reject(new Error("Payload too large")); });
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}")); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s || "");

module.exports = async function handler(req, res){
  setCors(res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST")    { res.statusCode = 405; return res.end("Method not allowed"); }

  let body;
  try { body = await readJson(req); }
  catch (e) { res.statusCode = 400; return res.end("Invalid JSON: " + e.message); }

  const { email, filename, mimeType, imageBase64 } = body || {};
  if (!isEmail(email))   { res.statusCode = 400; return res.end("Invalid email"); }
  if (!imageBase64)      { res.statusCode = 400; return res.end("Missing imageBase64"); }

  // Prefer wyzer@powerwyze.com credentials; fall back to legacy if not set
  const pass = process.env.WYZER_APP_PASSWORD || process.env.GOOGLE_APP_PASSWORD;
  if (!pass) { res.statusCode = 500; return res.end("App password not configured (WYZER_APP_PASSWORD)"); }

  const user = process.env.WYZER_GMAIL_USER
            || process.env.GMAIL_USER
            || "wyzer@powerwyze.com";
  const fromName = process.env.FROM_NAME || "MXU Circuit";

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });

  const safeFilename = String(filename || "mxu-f1-portrait.jpg")
    .replace(/[^a-z0-9@._-]/gi, "_")
    .slice(0, 200);

  const html = `<!doctype html><html><body style="font-family:system-ui,Inter,Arial,sans-serif;background:#0a0a0c;color:#f4f4f5;padding:24px">
    <div style="max-width:560px;margin:0 auto;background:#111114;border:1px solid #2a2a2e;border-radius:16px;overflow:hidden">
      <div style="padding:22px 24px;border-bottom:1px solid #2a2a2e;display:flex;align-items:center;gap:10px">
        <div style="width:32px;height:32px;background:#e10600;border-radius:8px;display:inline-block"></div>
        <strong style="font-size:18px;letter-spacing:0.04em">MXU · CIRCUIT</strong>
      </div>
      <div style="padding:24px">
        <h1 style="margin:0 0 8px 0;font-size:24px">Your F1 Miami portrait is ready</h1>
        <p style="margin:0 0 16px 0;color:#a1a1aa;line-height:1.55">Thanks for stopping by the MXU AI Photo Booth at F1 Miami. Your souvenir is attached. See you on the grid.</p>
        <p style="margin:0;color:#71717a;font-size:13px">— ${fromName}</p>
      </div>
    </div>
  </body></html>`;

  try {
    await transporter.sendMail({
      from: `"${fromName}" <${user}>`,
      to: email,
      subject: "Your MXU F1 Miami portrait 🏁",
      text: "Your F1 Miami portrait from the MXU AI Photo Booth is attached. See you on the grid.",
      html,
      attachments: [{
        filename: safeFilename,
        content: Buffer.from(imageBase64, "base64"),
        contentType: mimeType || "image/jpeg",
      }],
    });
  } catch (e) {
    console.error("smtp error", e);
    res.statusCode = 502; return res.end("SMTP error: " + e.message);
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json");
  return res.end(JSON.stringify({ ok: true }));
};
