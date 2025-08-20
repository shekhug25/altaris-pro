// index.ts (Function: allowlist-remove)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const URL = Deno.env.get("SUPABASE_URL");
const ANON = Deno.env.get("SUPABASE_ANON_KEY");
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const cors = {
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
    const { data: { user } } = await userClient.auth.getUser();
    if (!user?.email) return new Response("Unauthorized", {
      status: 401,
      headers: cors
    });
    const { data: isAdmin } = await adminClient.from("admins").select("email").eq("email", user.email.toLowerCase()).maybeSingle();
    if (!isAdmin) return new Response("Forbidden (not admin)", {
      status: 403,
      headers: cors
    });
    const { email } = await req.json();
    if (!email) return new Response("email required", {
      status: 400,
      headers: cors
    });
    const { error } = await adminClient.from("allowlist").delete().eq("email", String(email).toLowerCase());
    if (error) return new Response(`Delete failed: ${error.message}`, {
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
