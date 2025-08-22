
// viewer-fallback.js
// Robust viewer selection: tries jsDelivr -> unpkg -> Mozilla GitHub Pages.
// Rewrites citation/“open here” links to the first working PDF.js viewer and
// preserves page + search highlighting. Also supports loading into a side iframe.
(function(){
  const DEFAULTS = [
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/web/viewer.html",
    "https://unpkg.com/pdfjs-dist@3.11.174/web/viewer.html",
    "https://mozilla.github.io/pdf.js/web/viewer.html"
  ];
  const CANDIDATES = (window.DOCS_CHAT_CONFIG && (window.DOCS_CHAT_CONFIG.viewerCandidates || window.DOCS_CHAT_CONFIG.viewer && [window.DOCS_CHAT_CONFIG.viewer])) || DEFAULTS;
  const TRY_TIMEOUT_MS = 2500;

  function parseFromHref(href){
    try{
      const u = new URL(href, window.location.origin);
      const file = u.searchParams.get('file') || u.searchParams.get('src') || u.searchParams.get('url') || href;
      const page = (u.hash.match(/page=(\d+)/) || [])[1] || "";
      const query = decodeURIComponent((u.hash.match(/search=([^&]+)/) || [])[1] || "");
      return { file, page, query };
    }catch(_){ return { file: href, page: "", query: "" }; }
  }

  function buildViewerSrc(base, fileUrl, page, query){
    const q = base + "?file=" + encodeURIComponent(fileUrl || "");
    const hash = [];
    if (page)  hash.push("page=" + encodeURIComponent(page));
    if (query) hash.push("search=" + encodeURIComponent(query));
    // Fit page for consistent highlighting position
    hash.push("zoom=page-fit");
    return q + (hash.length ? "#" + hash.join("&") : "");
  }

  async function canReach(url){
    // We only need to know if the CDN is reachable. A no-cors fetch is fine.
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TRY_TIMEOUT_MS);
    try{
      await fetch(url, { mode: "no-cors", cache: "no-store", signal: ctrl.signal });
      return true; // If it didn't throw/abort, assume reachable.
    }catch(_){ return false; }
    finally{ clearTimeout(t); }
  }

  let RESOLVED_BASE = null;
  let resolving = null;
  async function getViewerBase(){
    if (RESOLVED_BASE) return RESOLVED_BASE;
    if (resolving) return resolving;
    resolving = (async () => {
      for (const base of CANDIDATES){
        if (await canReach(base)) { RESOLVED_BASE = base; return base; }
      }
      // If all fail, fall back to last candidate
      RESOLVED_BASE = CANDIDATES[CANDIDATES.length-1];
      return RESOLVED_BASE;
    })();
    return resolving;
  }

  async function rewriteAnchor(a){
    const href = a.getAttribute("href") || "";
    const dataFile = a.getAttribute("data-file");
    const dataPage = a.getAttribute("data-page");
    const dataQ = a.getAttribute("data-q");
    const parsed = parseFromHref(href);
    const base = await getViewerBase();
    const file = dataFile || parsed.file;
    const page = dataPage || parsed.page;
    const q = dataQ || parsed.query;
    a.setAttribute("href", buildViewerSrc(base, file, page, q));
    if (!a.hasAttribute("target")) a.setAttribute("target", "_blank");
  }

  function scan(root=document){
    root.querySelectorAll('.source-item a, .citation a, a[data-open-here], a.open-here, a[data-viewer], a[data-citation]').forEach(rewriteAnchor);
  }

  function openInSidePanel(file, page, query){
    const iframe = document.querySelector('#doc-viewer iframe, #pdfSideViewer, #pdf-viewer, .doc-viewer iframe, iframe#doc-viewer, iframe.pdf-viewer');
    if (!iframe) return false;
    getViewerBase().then(base => { iframe.src = buildViewerSrc(base, file, page, query); });
    return true;
  }

  document.addEventListener('click', function(e){
    const a = e.target.closest('a');
    if (!a) return;
    if (a.matches('[data-open-here], .open-here')){
      e.preventDefault();
      const parsed = parseFromHref(a.getAttribute('href')||'');
      const file = a.getAttribute('data-file') || parsed.file;
      const page = a.getAttribute('data-page') || parsed.page;
      const q    = a.getAttribute('data-q')    || parsed.query;
      if (!openInSidePanel(file, page, q)){
        getViewerBase().then(base => window.open(buildViewerSrc(base, file, page, q), '_blank'));
      }
    }
  }, true);

  document.addEventListener('DOMContentLoaded', function(){
    scan();
    const obs = new MutationObserver(() => scan());
    obs.observe(document.body, { childList: true, subtree: true });
  });
})();
