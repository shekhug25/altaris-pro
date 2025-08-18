
// chat-launcher.js — lazy-loads chat.js and opens the modal on click
(function () {
  function loadDocsChat(deal) {
    if (window.openDocChat) { window.openDocChat(deal); return; }
    const s = document.createElement('script');
    s.src = './chat.js?v=10.4'; // ensure chat.js exists at this path
    s.onload = () => window.openDocChat && window.openDocChat(deal);
    s.onerror = () => alert('Failed to load chat.js');
    document.body.appendChild(s);
  }

  // Delegate clicks from any element with data-action="chat"
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="chat"]');
    if (!btn) return;
    const card = btn.closest('[data-deal-id]') || document;
    const dealId = btn.dataset.dealId || card.dataset.dealId;
    const dealName = btn.dataset.dealName || card.dataset.dealName || btn.title || '';
    if (!dealId) { console.warn('Chat button missing data-deal-id'); return; }
    loadDocsChat({ id: dealId, name: dealName });
  });

  window.loadDocsChat = loadDocsChat; // optional: open from console
})();
