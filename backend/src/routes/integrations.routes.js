const express = require("express");
const mailer = require("../lib/mailer");

const router = express.Router();

// Settings → Integrations (Admin): qué servicios externos están conectados (por variables de
// entorno en Railway; aquí no se guardan llaves) y un correo de prueba para comprobar el envío.
router.get("/status", (_req, res) => {
  res.json({
    email: mailer.status(),
    sms: {
      configured: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM),
      provider: "twilio",
      from: process.env.TWILIO_FROM || "",
      missing: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"].filter((k) => !process.env[k]),
    },
    cards: {
      configured: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET),
      provider: "stripe",
      mode: String(process.env.STRIPE_SECRET_KEY || "").startsWith("sk_live_") ? "live" : (process.env.STRIPE_SECRET_KEY ? "test" : ""),
      missing: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"].filter((k) => !process.env[k]),
    },
  });
});

router.post("/test-email", async (req, res) => {
  const to = String(req.body?.to || req.user?.email || "").trim();
  try {
    const r = await mailer.sendEmail({
      to,
      subject: "Test email from Reyes Auto Glass CRM",
      html: `<p>This is a test email from the CRM. If you can read this, email sending is working.</p><p style="color:#666;font-size:12px">Sent ${new Date().toISOString()} by ${req.user?.name || "system"}</p>`,
      text: `This is a test email from the CRM. If you can read this, email sending is working. Sent ${new Date().toISOString()}`,
    });
    res.json({ ok: true, to, id: r.id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
