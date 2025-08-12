import { serve } from "https://deno.land/std/http/server.ts";

const SHARED_SECRET = Deno.env.get("ALTARIS_WEBHOOK_SECRET") || "";
const SLACK_WEBHOOK_URL = Deno.env.get("SLACK_WEBHOOK_URL") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";

async function sendSlack(text: string) {
  if (!SLACK_WEBHOOK_URL) return;
  await fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

async function sendEmail(subject: string, html: string) {
  if (!RESEND_API_KEY) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Altaris Alerts <alerts@yourdomain.com>",
      to: ["you@company.com"],
      subject,
      html,
    }),
  });
}

serve(async (req) => {
  const sig = req.headers.get("x-altaris-secret") || "";
  if (!SHARED_SECRET || sig !== SHARED_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  let payload: any = {};
  try { payload = await req.json(); } catch (_e) {}

  const { type, record, old_record } = payload || {};
  if (
    type === "UPDATE" &&
    old_record?.stage === "active" &&
    record?.stage === "closing"
  ) {
    const name = record?.name ?? "(unknown deal)";
    const msg = `🔔 Deal moved to Closing: ${name} (Active → Closing)`;
    await Promise.all([
      sendSlack(msg),
      sendEmail(`Deal moved to Closing: ${name}`, `<p>${msg}</p>`),
    ]);
  }

  return new Response("ok", { status: 200 });
});
