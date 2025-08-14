// supabase/functions/deal-stage-notify/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-altaris-secret, authorization"
};
const SECRET = Deno.env.get("ALTARIS_WEBHOOK_SECRET") || ""; // set this in Supabase
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || ""; // set this in Supabase
const ALERT_EMAIL_TO = Deno.env.get("ALERT_EMAIL_TO") || ""; // set this in Supabase
async function sendEmail(subject, html) {
  if (!RESEND_API_KEY || !ALERT_EMAIL_TO) return {
    ok: false,
    skipped: true,
    reason: "missing RESEND_API_KEY or ALERT_EMAIL_TO"
  };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      // For quick tests you can use Resend's sandbox sender. For production, verify your domain & change this.
      from: "Altaris Alerts <onboarding@resend.dev>",
      to: [
        ALERT_EMAIL_TO
      ],
      subject,
      html
    })
  });
  const text = await r.text().catch(()=>"");
  return {
    ok: r.ok,
    status: r.status,
    statusText: r.statusText,
    body: text?.slice(0, 400)
  };
}
serve(async (req)=>{
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: CORS
    });
  }
  // Log invocation
  console.log("🔔 invoked", {
    method: req.method,
    ua: req.headers.get("user-agent") || "n/a",
    hasSecretHeader: !!req.headers.get("x-altaris-secret")
  });
  // Secret check (works with “Edge Function” destination)
  if (SECRET) {
    const given = req.headers.get("x-altaris-secret") || "";
    if (given !== SECRET) {
      console.warn("❌ secret mismatch");
      return new Response(JSON.stringify({
        ok: false,
        error: "forbidden: bad secret"
      }), {
        status: 403,
        headers: {
          ...CORS,
          "content-type": "application/json"
        }
      });
    }
  }
  let payload = {};
  try {
    payload = await req.json();
  } catch  {}
  console.log("📦 payload", payload);
  const rec = payload?.record ?? {};
  const old = payload?.old_record ?? {};
  const from = String(old?.stage ?? "").toLowerCase().trim();
  const to = String(rec?.stage ?? "").toLowerCase().trim();
  const name = rec?.name ?? `Deal ${rec?.id ?? "?"}`;
  // Only notify on Approval -> Closing
  let emailResult = {
    skipped: true
  };
  let matched = false;
  if (from === "approval" && to === "closing") {
    matched = true;
    const subject = `Deal moved to Closing: ${name}`;
    const html = `
      <div style="font-family:system-ui,Segoe UI,Arial">
        <h2>Deal moved to <em>Closing</em></h2>
        <p><strong>${name}</strong> (id: ${rec?.id ?? "?"})</p>
        <p>From: <code>${from}</code> → To: <code>${to}</code></p>
        <pre style="background:#f6f8fa;padding:12px;border-radius:6px">${JSON.stringify(rec, null, 2)}</pre>
      </div>
    `;
    emailResult = await sendEmail(subject, html);
    console.log("📧 resend", emailResult);
  } else {
    console.log("ℹ️ rule not matched", {
      from,
      to
    });
  }
  // Return a verbose response so you can see details in Deliveries → Response
  const result = {
    ok: true,
    matched,
    from,
    to,
    deal: {
      id: rec?.id,
      name
    },
    emailEnabled: !!RESEND_API_KEY && !!ALERT_EMAIL_TO,
    emailResult
  };
  return new Response(JSON.stringify(result, null, 2), {
    status: 200,
    headers: {
      ...CORS,
      "content-type": "application/json"
    }
  });
});
