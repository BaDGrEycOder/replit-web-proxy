(function () {
  const ALLOW_HOSTS = ['spotify.com', 'youtube.com', 'yahoo.com', 'mail.yahoo.com', 'amazon.com'];
  const allowedList = document.getElementById('allowedList');
  if (allowedList) allowedList.textContent = ALLOW_HOSTS.join(', ');

  const urlInput = document.getElementById('urlInput');
  const viewer = document.getElementById('viewer');
  const openNew = document.getElementById('openNew');
  const searchForm = document.getElementById('searchForm');
  const searchInput = document.getElementById('searchInput');
  const searchStatus = document.getElementById('searchStatus');
  const searchResults = document.getElementById('searchResults');

  function normalize(value) {
    try { return new URL(value).href; }
    catch {
      try { return new URL('https://' + value).href; }
      catch { return null; }
    }
  }

  window.goProxy = function () {
    const normalized = normalize(urlInput.value.trim());
    if (!normalized) {
      document.getElementById('notice').textContent = 'Please enter a valid website address.';
      return false;
    }
    const host = new URL(normalized).hostname;
    const allowed = ALLOW_HOSTS.some(domain => host === domain || host.endsWith('.' + domain));
    if (!allowed) {
      document.getElementById('notice').textContent = 'That site is not on the allowlist. Ask the administrator to add it.';
      return false;
    }
    const proxyPath = '/proxy?url=' + encodeURIComponent(normalized);
    viewer.src = proxyPath;
    openNew.dataset.url = proxyPath;
    document.getElementById('notice').textContent = 'Loading ' + host + '…';
    return false;
  };

  openNew.addEventListener('click', function () {
    if (!this.dataset.url) {
      document.getElementById('notice').textContent = 'Enter a website address and choose Browse site first.';
      return;
    }
    window.open(this.dataset.url, '_blank', 'noopener,noreferrer');
  });

  searchForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    const query = searchInput.value.trim();
    if (query.length < 2) {
      searchStatus.textContent = 'Please enter at least 2 characters.';
      return;
    }
    searchStatus.textContent = 'Searching DuckDuckGo…';
    searchResults.replaceChildren();
    try {
      const response = await fetch('/api/search?q=' + encodeURIComponent(query));
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Search is temporarily unavailable.');
      if (!data.results.length) {
        searchStatus.textContent = 'No results found. Try a different search.';
        return;
      }
      searchStatus.textContent = 'Search results for “' + query + '”';
      data.results.forEach(result => {
        const article = document.createElement('article');
        article.className = 'result-card';
        const title = document.createElement('a');
        title.className = 'result-title';
        title.href = result.url;
        title.target = '_blank';
        title.rel = 'noopener noreferrer';
        title.textContent = result.title;
        const description = document.createElement('p');
        description.className = 'muted result-snippet';
        description.textContent = result.snippet || result.url;
        const source = document.createElement('span');
        source.className = 'result-source';
        source.textContent = new URL(result.url).hostname;
        article.append(title, description, source);
        searchResults.append(article);
      });
    } catch (error) {
      searchStatus.textContent = error.message || 'Search failed. Please try again.';
    }
  });
})();
