// Supabase Edge Function: doc-ingest-batch
// Accepts small text chunks, embeds with 3-small (1536), inserts into doc_sections.
// Request: { dealId, document:{bucket,path,title,file_type}, scope, chunks:[{content,page?,heading?}] }
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const EMBEDDING_MODEL = "text-embedding-3-small"; // 1536 dims — matches your DB
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: cors
  });
  if (req.method !== "POST") return new Response(JSON.stringify({
    error: "Use POST"
  }), {
    status: 405,
    headers: {
      ...cors,
      "Content-Type": "application/json"
    }
  });
  try {
    const body = await req.json();
    const dealIdText = body?.dealId != null ? String(body.dealId) : null;
    const scope = body?.scope ?? null;
    const doc = body?.document || {};
    const chunks = Array.isArray(body?.chunks) ? body.chunks : [];
    if (!doc?.bucket || !doc?.path || !chunks.length) {
      return new Response(JSON.stringify({
        error: "Missing bucket/path or no chunks"
      }), {
        status: 400,
        headers: {
          ...cors,
          "Content-Type": "application/json"
        }
      });
    }
    // Upsert/find documents row by bucket+path
    const { data: existing, error: selErr } = await db.from("documents").select("id").eq("bucket", doc.bucket).eq("path", doc.path).maybeSingle();
    if (selErr) throw selErr;
    let doc_id = existing?.id ?? null;
    if (!doc_id) {
      const { data: ins, error: insErr } = await db.from("documents").insert({
        deal_id: dealIdText ?? null,
        title: doc.title || doc.path.split("/").pop(),
        filename: doc.title || doc.path.split("/").pop(),
        file_type: doc.file_type || "pdf",
        bucket: doc.bucket,
        path: doc.path
      }).select("id").single();
      if (insErr) throw insErr;
      doc_id = ins.id;
    }
    // Embed batch (≤ 32 inputs recommended client-side)
    const inputs = chunks.map((c)=>c.content || "");
    const openaiRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: inputs
      })
    });
    if (!openaiRes.ok) {
      return new Response(JSON.stringify({
        error: await openaiRes.text()
      }), {
        status: openaiRes.status,
        headers: {
          ...cors,
          "Content-Type": "application/json"
        }
      });
    }
    const vecData = await openaiRes.json();
    const vecs = (vecData?.data || []).map((d)=>d.embedding);
    // Insert sections
    const rows = chunks.map((c, i)=>({
        doc_id,
        deal_id: dealIdText ?? null,
        scope,
        heading: c.heading ?? null,
        section_id: c.page != null ? `page-${c.page}` : null,
        page: c.page ?? null,
        content: c.content,
        embedding: vecs[i]
      }));
    const { error: insErr2 } = await db.from("doc_sections").insert(rows);
    if (insErr2) throw insErr2;
    return new Response(JSON.stringify({
      ok: true,
      inserted: rows.length
    }), {
      headers: {
        ...cors,
        "Content-Type": "application/json"
      }
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({
      error: String(e)
    }), {
      status: 500,
      headers: {
        ...cors,
        "Content-Type": "application/json"
      }
    });
  }
});
