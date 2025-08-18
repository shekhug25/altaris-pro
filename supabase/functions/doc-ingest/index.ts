import OpenAI from "npm:openai@4";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const openai = new OpenAI({
  apiKey: Deno.env.get("OPENAI_API_KEY")
});
const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
// ---- REST helpers for Vector Stores (beta) ----
const OA_BASE = "https://api.openai.com/v1";
const OA_AUTH = {
  Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`
};
const OA_BETA = {
  "OpenAI-Beta": "assistants=v2"
}; // required
async function oaFetch(path, init = {}) {
  const headers = {
    ...OA_AUTH,
    ...OA_BETA,
    "Content-Type": "application/json",
    ...init.headers || {}
  };
  const res = await fetch(`${OA_BASE}${path}`, {
    ...init,
    headers
  });
  if (!res.ok) {
    const txt = await res.text().catch(()=>"");
    throw new Error(`OpenAI ${path} ${res.status}: ${txt}`);
  }
  return res.json();
}
async function createVectorStore(name) {
  const data = await oaFetch("/vector_stores", {
    method: "POST",
    body: JSON.stringify({
      name
    })
  });
  return data.id;
}
async function attachFileToStore(vectorStoreId, fileId) {
  const data = await oaFetch(`/vector_stores/${vectorStoreId}/files`, {
    method: "POST",
    body: JSON.stringify({
      file_id: fileId
    })
  });
  // Poll until ingestion completes
  const fileRefId = data.id;
  let tries = 0;
  while(tries++ < 30){
    const s = await oaFetch(`/vector_stores/${vectorStoreId}/files/${fileRefId}`, {
      method: "GET"
    });
    const status = s.status;
    if (status === "completed") return;
    if (status === "failed") throw new Error(`Vector store ingestion failed for file_id=${fileId}`);
    await new Promise((r)=>setTimeout(r, 2000));
  }
  throw new Error("Vector store ingestion timed out");
}
async function toFetchableUrl(f) {
  if ("url" in f && f.url) {
    return {
      url: f.url,
      name: f.filename ?? "document.pdf",
      mime: f.mime ?? "application/pdf"
    };
  }
  const { data, error } = await supabase.storage.from(f.bucket).createSignedUrl(f.path, 60);
  if (error) throw new Error(`createSignedUrl failed: ${error.message}`);
  return {
    url: data.signedUrl,
    name: f.filename ?? "document.pdf",
    mime: f.mime ?? "application/pdf"
  };
}
async function getOrCreateStoreId(dealId) {
  const { data: deal, error } = await supabase.from("deals").select("vector_store_id").eq("id", dealId).single();
  if (error) throw new Error(`DB read error: ${error.message}`);
  if (deal?.vector_store_id) return deal.vector_store_id;
  const id = await createVectorStore(`deal-${dealId}`);
  const { error: upErr } = await supabase.from("deals").update({
    vector_store_id: id
  }).eq("id", dealId);
  if (upErr) throw new Error(`DB update error: ${upErr.message}`);
  return id;
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: corsHeaders
  });
  let stage = "start";
  try {
    if (req.method !== "POST") {
      return new Response("POST only", {
        status: 405,
        headers: corsHeaders
      });
    }
    stage = "env";
    if (!Deno.env.get("OPENAI_API_KEY")) throw new Error("Missing OPENAI_API_KEY");
    if (!Deno.env.get("SUPABASE_URL")) throw new Error("Missing SUPABASE_URL");
    if (!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
    stage = "parse";
    const { dealId, files } = await req.json();
    if (!dealId || !Array.isArray(files) || files.length === 0) {
      return new Response(JSON.stringify({
        ok: false,
        stage,
        error: "dealId and files[] are required"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    stage = "store";
    const vectorStoreId = await getOrCreateStoreId(dealId);
    const uploadedIds = [];
    for (const f of files){
      stage = "resolve-url";
      const { url, name, mime } = await toFetchableUrl(f);
      stage = `download:${name}`;
      const res = await fetch(url);
      if (!res.ok) {
        return new Response(JSON.stringify({
          ok: false,
          stage,
          error: `Could not fetch ${name} (${res.status})`
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      stage = `upload-file:${name}`;
      const ab = await res.arrayBuffer();
      const file = new File([
        ab
      ], name, {
        type: mime || "application/pdf"
      });
      const uploaded = await openai.files.create({
        file,
        purpose: "assistants"
      });
      uploadedIds.push(uploaded.id);
      stage = `attach:${uploaded.id}`;
      await attachFileToStore(vectorStoreId, uploaded.id);
    }
    return new Response(JSON.stringify({
      ok: true,
      vector_store_id: vectorStoreId,
      attached_files: uploadedIds.length
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (e) {
    const msg = typeof e?.message === "string" ? e.message : String(e);
    console.error("doc-ingest error", {
      stage,
      msg
    });
    return new Response(JSON.stringify({
      ok: false,
      stage,
      error: msg
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
