// index.ts  (Function: allowlist-add)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const URL = Deno.env.get("SUPABASE_URL");
const ANON = Deno.env.get("SUPABASE_ANON_KEY");
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const cors = {
  // tighten for dev; add your prod origin later
  "Access-Control-Allow-Origin": "https://altaris.netlify.app",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};
serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: cors
  });
  if (req.method !== "POST") return new Response("Method Not Allowed", {
    status: 405,
    headers: cors
  });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(URL, ANON, {
      global: {
        headers: {
          Authorization: authHeader
        }
      },
      auth: {
        persistSession: false
      }
    });
    const adminClient = createClient(URL, SERVICE, {
      auth: {
        persistSession: false
      }
    });
    const { data: { user }, error: getUserErr } = await userClient.auth.getUser();
    if (getUserErr || !user?.email) return new Response("Unauthorized", {
      status: 401,
      headers: cors
    });
    // admin check
    const { data: isAdmin } = await adminClient.from("admins").select("email").eq("email", user.email.toLowerCase()).maybeSingle();
    if (!isAdmin) return new Response("Forbidden (not admin)", {
      status: 403,
      headers: cors
    });
    const { email, org_name, org_id } = await req.json();
    if (!email || !(org_name || org_id)) return new Response("email and org_name|org_id required", {
      status: 400,
      headers: cors
    });
    let orgId = org_id;
    if (!orgId) {
      const { data: org, error: orgErr } = await adminClient.from("orgs").select("id").eq("name", String(org_name)).single();
      if (orgErr || !org) return new Response("Org not found", {
        status: 400,
        headers: cors
      });
      orgId = org.id;
    }
    const { error } = await adminClient.from("allowlist").upsert({
      email: String(email).toLowerCase(),
      org_id: orgId
    });
    if (error) return new Response(`Upsert failed: ${error.message}`, {
      status: 400,
      headers: cors
    });
    return new Response(JSON.stringify({
      ok: true
    }), {
      status: 200,
      headers: {
        ...cors,
        "content-type": "application/json"
      }
    });
  } catch (e) {
    return new Response(`error: ${e?.message || e}`, {
      status: 500,
      headers: cors
    });
  }
});
