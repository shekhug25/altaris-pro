// doc-ingest-client.js
window.ingestDealDocs = async function ingestDealDocs({
  dealId,
  bucket,        // e.g. "deals"
  path,          // e.g. `${dealId}/Credit Memo.pdf`
  filename,      // file.name
  mime           // file.type (e.g., "application/pdf")
}) {
  const endpoint = "https://volftexuyqyykrnewewa.supabase.co/functions/v1/doc-ingest";

  // We send bucket+path so the function can create a signed URL server-side.
  const body = {
    dealId,
    files: [{ bucket, path, filename, mime }]
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const txt = await res.text().catch(()=> "");
    throw new Error(`doc-ingest failed (${res.status}): ${txt}`);
  }

  return res.json(); // { ok: true, vector_store_id: "vs_..." }
};
