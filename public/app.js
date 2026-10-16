(function(){
  const ALLOW_HOSTS = ['spotify.com','youtube.com','yahoo.com','mail.yahoo.com','amazon.com'];
  const allowedListEl = document.getElementById('allowedList');
  if (allowedListEl) allowedListEl.textContent = ALLOW_HOSTS.join(', ');

  const urlInput = document.getElementById('urlInput');
  const viewer = document.getElementById('viewer');
  const openNew = document.getElementById('openNew');

  function normalize(u){
    try{ return new URL(u).href }catch(e){
      try{ return new URL('https://'+u).href }catch(e){ return null }
    }
  }

  window.goProxy = function(){
    const raw = urlInput.value.trim();
    const n = normalize(raw);
    if (!n){ alert('Please enter a valid URL (e.g. https://youtube.com)'); return false }
    try{
      const host = new URL(n).hostname;
      const allowed = ALLOW_HOSTS.some(a => host === a || host.endsWith('.'+a));
      if (!allowed){ if(!confirm('That host is not on the allowlist and will be blocked by the proxy. Continue?')) return false }
    }catch(e){}
    const prox = '/proxy?url=' + encodeURIComponent(n);
    // try to load in iframe
    viewer.src = prox;
    // update open-in-new button href using data attribute
    openNew.setAttribute('data-url', prox);
    return false;
  }

  openNew.addEventListener('click', function(){
    const href = this.getAttribute('data-url');
    if (!href) return alert('No URL to open');
    window.open(href, '_blank');
  });

})();
