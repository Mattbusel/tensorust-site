// Free evidence-sample request endpoint.
//
// Configure LEAD_WEBHOOK_URL in the Vercel project to forward a validated request
// to the owner's chosen inbox or automation. No lead data is written to the
// serverless filesystem. If no relay is configured, the browser falls back to a
// prefilled mailto request instead of pretending the form was captured.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value, limit) {
  return String(value || "").replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, limit);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const email = clean(body.email, 254).toLowerCase();
  const topic = clean(body.topic, 220);
  const role = clean(body.role, 100);
  const honeypot = clean(body.company, 120);

  if (!email || !EMAIL.test(email) || !topic) {
    res.status(400).json({ error: "A valid work email and topic are required." });
    return;
  }

  // Quietly accept obvious bot submissions without forwarding any data.
  if (honeypot) {
    res.status(202).json({ accepted: true });
    return;
  }

  const endpoint = process.env.LEAD_WEBHOOK_URL;
  if (!endpoint) {
    res.status(200).json({ accepted: false, delivery: "mailto" });
    return;
  }

  const payload = {
    event: "tensorust_mini_brief_request",
    requested_at: new Date().toISOString(),
    email,
    topic,
    role: role || "Not specified",
    source: "https://tensorust-site.vercel.app/#sample",
  };

  try {
    const forwarded = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.LEAD_WEBHOOK_TOKEN
          ? { Authorization: `Bearer ${process.env.LEAD_WEBHOOK_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    if (!forwarded.ok) {
      res.status(502).json({ error: "Lead relay rejected the request." });
      return;
    }
    res.status(202).json({ accepted: true });
  } catch {
    res.status(502).json({ error: "Lead relay is unavailable." });
  }
};
