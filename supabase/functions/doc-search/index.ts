// Supabase Edge Function: doc-search
// - CORS enabled
// - Uses text-embedding-3-small (1536 dims)
// - Calls RPC public.match_doc_sections(query_embedding, match_count, p_deal_id, p_scope)
// - Returns { answer, citations[] } with signed links and page deep links
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// ---------------------- ENV ----------------------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing Supabase env (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY).");
}
if (!OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY.");
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
// ---------------------- CONFIG ----------------------
const STORAGE_BUCKET = "deal-docs";
const EMBEDDING_MODEL = "text-embedding-3-small"; // 1536 dims (compatible with IVF_FLAT)
const ANSWER_MODEL = "gpt-4o-mini"; // fast + cheap
// ---------------------- CORS ----------------------
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
// ---------------------- OPENAI HELPERS ----------------------
async function embedQuery(input) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      input,
      model: EMBEDDING_MODEL
    })
  });
  if (!res.ok) throw new Error(`Embedding failed: ${await res.text()}`);
  const data = await res.json();
  return data.data[0].embedding;
}
async function askLLM(prompt) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: ANSWER_MODEL,
      messages: [
        {
          role: "system",
          content: "You are a concise analyst. Answer ONLY using the provided context. If unsure, say you’re unsure."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.2
    })
  });
  if (!res.ok) throw new Error(`LLM failed: ${await res.text()}`);
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || "").trim();
}
// ---------------------- SEARCH ----------------------
async function searchSections(params) {
  // NOTE: parameter names MUST match the SQL function arguments:
  //   p_deal_id, p_scope
  const { data, error } = await supabase.rpc("match_doc_sections", {
    query_embedding: params.queryEmbedding,
    match_count: params.matchCount,
    p_deal_id_text: params.dealId == null ? null : String(params.dealId),
    p_scope: params.scope ?? null
  });
  if (error) {
    console.error("RPC match_doc_sections error:", error);
    return [];
  }
  return data || [];
}
function buildSignedDeepLink(signedUrl, page) {
  // Native PDF viewers support #page=
  return page ? `${signedUrl}#page=${page}` : signedUrl;
}
// ---------------------- HTTP HANDLER ----------------------
serve(async (req)=>{
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({
      error: "Use POST"
    }), {
      status: 405,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  try {
    const body = await req.json();
    const query = String(body.query || "");
    const dealId = body.dealId ?? null;
    const scope = body.scope && body.scope !== "all" ? String(body.scope) : null;
    const topK = Math.max(1, Math.min(10, Number(body.topK) || 5));
    if (!query) {
      return new Response(JSON.stringify({
        answer: "Ask a question to begin.",
        citations: []
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // 1) Embed
    const embedding = await embedQuery(query);
    // 2) Retrieve candidate sections (oversample)
    const hits = await searchSections({
      queryEmbedding: embedding,
      dealId,
      scope,
      matchCount: topK * 5
    });
    // 3) Build citations (unique per doc/path)
    const citations = [];
    const seen = new Set();
    for (const h of hits){
      const bucket = h.bucket || STORAGE_BUCKET;
      const path = h.path || "";
      let file_url = null;
      if (path) {
        const signed = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 15);
        if (signed.error) {
          console.warn("signed url error", signed.error);
          continue;
        }
        file_url = signed.data.signedUrl;
      }
      const dedupeKey = path ? `${bucket}/${path}` : h.doc_id || h.id;
      if (seen.has(String(dedupeKey))) continue;
      seen.add(String(dedupeKey));
      const title = h.title || h.filename || "Document";
      const snippet = h.snippet || (h.content || "").slice(0, 300);
      const page = h.page || null;
      citations.push({
        title,
        snippet,
        page,
        link: file_url ? buildSignedDeepLink(file_url, page) : null,
        file_url,
        section_id: h.section_id || null,
        heading: h.heading || null
      });
      if (citations.length >= topK) break;
    }
    // 4) Compose answer (brief) from context
    const context = hits.slice(0, Math.max(3, topK)).map((h, i)=>`[#${i + 1}] ${h.content}`).join("\n\n");
    const prompt = `Question: ${query}\n\nContext:\n${context}\n\nAnswer briefly, using only the context.`;
    let answer = "Here’s what I found:";
    try {
      answer = await askLLM(prompt);
    } catch (err) {
      console.warn("LLM error (fallback to generic answer):", err);
    }
    return new Response(JSON.stringify({
      answer,
      citations
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({
      error: String(e),
      answer: "Sorry — couldn’t process that.",
      citations: []
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
