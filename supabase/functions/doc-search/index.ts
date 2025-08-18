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
function extract(resp) {
  const items = Array.isArray(resp.output) ? resp.output : [];
  const msg = [
    ...items
  ].reverse().find((x)=>x.type === "message");
  const answer = msg?.content?.[0]?.text ?? "No answer.";
  const annotations = [];
  for (const it of items){
    const c = it?.content;
    if (Array.isArray(c)) {
      for (const p of c)if (Array.isArray(p?.annotations)) annotations.push(...p.annotations);
    }
  }
  const citations = annotations.map((a)=>({
      title: a.filename || a.file_id || "Document",
      page: a.page,
      snippet: a.quote || a.text
    }));
  return {
    answer,
    citations
  };
}
Deno.serve(async (req)=>{
  // CORS preflight
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: corsHeaders
  });
  try {
    if (req.method !== "POST") return new Response("POST only", {
      status: 405,
      headers: corsHeaders
    });
    const { dealId, query, topK = 6 } = await req.json();
    if (!dealId || !query) {
      return new Response(JSON.stringify({
        answer: "Missing dealId or query.",
        citations: []
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const { data: deal, error } = await supabase.from("deals").select("vector_store_id").eq("id", dealId).single();
    if (error) return new Response(error.message, {
      status: 500,
      headers: corsHeaders
    });
    if (!deal?.vector_store_id) {
      return new Response(JSON.stringify({
        answer: "No documents are indexed for this deal yet.",
        citations: []
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const resp = await openai.responses.create({
      model: "gpt-4o-mini",
      input: query,
      tools: [
        {
          type: "file_search",
          vector_store_ids: [
            deal.vector_store_id
          ],
          max_num_results: topK
        }
      ],
      temperature: 0.2
    });
    const { answer, citations } = extract(resp);
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
    return new Response(`doc-search error: ${e}`, {
      status: 500,
      headers: corsHeaders
    });
  }
});
