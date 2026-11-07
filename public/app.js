(function () {
  let ALLOW_HOSTS = [];
  const allowedList = document.getElementById('allowedList');
  const urlInput = document.getElementById('urlInput');
  const viewer = document.getElementById('viewer');
  const resultViewer = document.getElementById('resultViewer');
  const openNew = document.getElementById('openNew');
  const searchForm = document.getElementById('searchForm');
  const searchInput = document.getElementById('searchInput');
  const searchStatus = document.getElementById('searchStatus');
  const searchResults = document.getElementById('searchResults');
  const notice = document.getElementById('notice');
  const browseStatus = document.getElementById('browseStatus');
  const browseTab = document.getElementById('browseTab');
  const resultTab = document.getElementById('resultTab');
  const browsePane = document.getElementById('browsePane');
  const resultPane = document.getElementById('resultPane');

  function switchTab(which) {
    const showResult = which === 'result';
    browseTab.classList.toggle('active', !showResult);
    resultTab.classList.toggle('active', showResult);
    browseTab.setAttribute('aria-selected', String(!showResult));
    resultTab.setAttribute('aria-selected', String(showResult));
    browsePane.hidden = showResult;
    resultPane.hidden = !showResult;
    browsePane.classList.toggle('active', !showResult);
    resultPane.classList.toggle('active', showResult);
  }
  browseTab.addEventListener('click', () => switchTab('browse'));
  resultTab.addEventListener('click', () => switchTab('result'));

  function normalize(value) {
    const input = value.trim();
    if (!input) return null;
    try { return new URL(input).href; }
    catch {
      try { return new URL('https://' + input).href; }
      catch { return null; }
    }
  }

  function isAllowed(url) {
    const host = new URL(url).hostname.toLowerCase();
    return ALLOW_HOSTS.some(domain => host === domain || host.endsWith('.' + domain));
  }

  function proxyUrl(url) {
    return '/proxy?url=' + encodeURIComponent(url);
  }

  async function loadAllowlist() {
    try {
      const response = await fetch('/api/admin/allowlist');
      if (!response.ok) throw new Error('Could not load the configured allowlist.');
      const list = await response.json();
      if (!Array.isArray(list)) throw new Error('The configured allowlist is invalid.');
      ALLOW_HOSTS = list.map(host => String(host).trim().toLowerCase()).filter(Boolean);
      allowedList.textContent = ALLOW_HOSTS.length ? ALLOW_HOSTS.join(', ') : 'No hosts configured';
    } catch (error) {
      allowedList.textContent = 'Could not load allowlist';
      browseStatus.textContent = error.message;
    }
  }
  loadAllowlist();

  window.goProxy = function () {
    const normalized = normalize(urlInput.value);
    if (!normalized || !['http:', 'https:'].includes(new URL(normalized).protocol)) {
      browseStatus.textContent = 'Please enter a valid HTTP or HTTPS website address.';
      return false;
    }
    const host = new URL(normalized).hostname.toLowerCase();
    if (!isAllowed(normalized)) {
      browseStatus.textContent = 'That site is not on the configured allowlist. Ask the administrator to add ' + host + '.';
      return false;
    }
    const proxied = proxyUrl(normalized);
    viewer.src = proxied;
    openNew.dataset.url = proxied;
    browseStatus.textContent = '';
    notice.textContent = 'Loading ' + host + '…';
    switchTab('browse');
    return false;
  };

  openNew.addEventListener('click', function () {
    if (!this.dataset.url) {
      browseStatus.textContent = 'Enter an allowed website address and choose Browse site first.';
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
      searchStatus.textContent = 'Search results for “' + query + '”. Click a result to open it in the in-app Search result tab.';
      data.results.forEach(result => {
        const article = document.createElement('article');
        article.className = 'result-card';
        const title = document.createElement('a');
        title.className = 'result-title';
        title.href = result.url;
        title.textContent = result.title;
        title.addEventListener('click', event => {
          event.preventDefault();
          const normalized = normalize(result.url);
          if (!normalized || !isAllowed(normalized)) {
            searchStatus.textContent = 'This result is outside your configured allowlist. Ask the administrator to add its host before browsing it.';
            return;
          }
          resultViewer.src = proxyUrl(normalized);
          notice.textContent = 'Loading search result: ' + new URL(normalized).hostname + '…';
          switchTab('result');
        });
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
