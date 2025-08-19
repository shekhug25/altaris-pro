// /js/doc-ingest-client.js — Browser-first ingest to avoid server timeouts
(function () {
  const BATCH_SIZE = 32;         // keep requests small
  const CHUNK_SIZE = 1000;       // ~1k chars per chunk

  // Load pdf.js lazily if needed
  async function ensurePDFJS() {
    if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) return;
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        resolve();
      };
      s.onerror = () => reject(new Error("Failed to load pdf.js"));
      document.head.appendChild(s);
    });
  }

  function chunkText(str, size = CHUNK_SIZE) {
    const out = [];
    for (let i = 0; i < str.length; i += size) out.push(str.slice(i, i + size));
    return out;
  }

  async function signedUrl(bucket, path) {
    const client = window.supabase?.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    const { data, error } = await client.storage.from(bucket).createSignedUrl(path, 600);
    if (error) throw error;
    return data.signedUrl;
  }

  async function extractPdfPages(url) {
    await ensurePDFJS();
    const pdf = await window.pdfjsLib.getDocument({ url }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const text = textContent.items.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim();
      pages.push({ page: i, text });
    }
    return pages;
  }

  async function postBatch({ dealId, document, scope, parts }) {
    const endpoint = `${window.SUPABASE_URL}/functions/v1/doc-ingest-batch`;
    const headers = {
      "Content-Type": "application/json",
      "apikey": window.SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${window.SUPABASE_ANON_KEY}`,
    };
    const res = await fetch(endpoint, {
      method: "POST", headers,
      body: JSON.stringify({
        dealId,
        document,
        scope: scope || null,
        chunks: parts.map(p => ({ content: p.content, page: p.page, heading: p.heading || null }))
      })
    });
    if (!res.ok) throw new Error(`doc-ingest-batch ${res.status}: ${await res.text()}`);
    return res.json();
  }

  // Called by app.js after uploading to Storage
  window.ingestDealDocs = async function ingestDealDocs({ dealId, bucket, path, filename }) {
    const url = await signedUrl(bucket, path);
    const pages = await extractPdfPages(url);
    if (!pages.length) throw new Error("No extractable text found in PDF");

    const docMeta = { bucket, path, title: filename, file_type: "pdf" };
    const parts = [];
    for (const p of pages) {
      const chunks = chunkText(p.text, CHUNK_SIZE);
      chunks.forEach(c => parts.push({ page: p.page, content: c }));
    }

    for (let i = 0; i < parts.length; i += BATCH_SIZE) {
      const slice = parts.slice(i, i + BATCH_SIZE);
      await postBatch({ dealId, document: docMeta, scope: null, parts: slice });
      await new Promise(r => setTimeout(r, 40)); // yield to UI
    }
    return { ok: true, inserted: parts.length };
  };
})();
