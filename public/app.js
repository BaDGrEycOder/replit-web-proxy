(function () {
  let ALLOW_HOSTS = [];
  const DEFAULT_HOSTS = ['spotify.com', 'youtube.com', 'yahoo.com', 'mail.yahoo.com'];
  const allowedList = document.getElementById('allowedList');
  const approvedApps = document.getElementById('approvedApps');
  const urlInput = document.getElementById('urlInput');
  const viewer = document.getElementById('viewer');
  const resultViewer = document.getElementById('resultViewer');
  const openNew = document.getElementById('openNew');
  const openDirect = document.getElementById('openDirect');
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
  const frameTimers = new WeakMap();
  const LOAD_TIMEOUT_MS = 30000;

  function loadInFrame(frame, url, targetUrl, host, label) {
    clearTimeout(frameTimers.get(frame));
    let completed = false;
    notice.textContent = 'Loading ' + label + host + '…';
    if (frame === viewer) {
      openNew.dataset.url = url;
      if (openDirect) {
        openDirect.dataset.url = targetUrl;
        openDirect.hidden = true;
      }
    }
    frame.addEventListener('load', function onLoad() {
      if (completed) return;
      completed = true;
      clearTimeout(frameTimers.get(frame));
      frame.removeEventListener('load', onLoad);
      notice.textContent = label + host + ' responded. If the page is blank or incomplete, the site may block proxy or embedded access.';
    }, { once: true });
    frameTimers.set(frame, setTimeout(() => {
      if (completed) return;
      completed = true;
      notice.textContent = label + host + ' has not responded after 30 seconds. It may be temporarily unavailable or block proxy access.';
      if (openDirect && frame === viewer) {
        openDirect.dataset.url = targetUrl;
        openDirect.hidden = false;
      }
    }, LOAD_TIMEOUT_MS));
    frame.src = url;
  }

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

  function appLabel(host) {
    const knownLabels = {
      'mail.yahoo.com': 'Yahoo Mail',
      'youtube.com': 'YouTube',
      'spotify.com': 'Spotify',
      'yahoo.com': 'Yahoo'
    };
    if (knownLabels[host]) return knownLabels[host];
    return host.split('.')[0].replace(/[-_]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
  }

  function renderApprovedApps() {
    approvedApps.replaceChildren();
    if (!ALLOW_HOSTS.length) {
      const empty = document.createElement('p');
      empty.className = 'muted small';
      empty.textContent = 'No approved apps are configured yet.';
      approvedApps.append(empty);
      return;
    }
    ALLOW_HOSTS.forEach(host => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'app-shortcut';
      button.textContent = appLabel(host);
      button.setAttribute('aria-label', 'Open ' + appLabel(host));
      button.addEventListener('click', () => {
        const url = 'https://' + host;
        urlInput.value = url;
        browseTo(url);
      });
      approvedApps.append(button);
    });
  }

  async function loadAllowlist() {
    try {
      const response = await fetch('/api/admin/allowlist');
      if (!response.ok) throw new Error('Could not load the configured allowlist.');
      const list = await response.json();
      if (!Array.isArray(list)) throw new Error('The configured allowlist is invalid.');
      ALLOW_HOSTS = [...new Set(list.map(host => String(host).trim().toLowerCase()).filter(host => host !== 'amazon.com' && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host)))];
      allowedList.textContent = ALLOW_HOSTS.length ? ALLOW_HOSTS.join(', ') : 'No hosts configured';
      renderApprovedApps();
    } catch (error) {
      // Keep the main approved-site shortcuts usable if the admin-only allowlist
      // endpoint is unavailable to a regular browsing session.
      ALLOW_HOSTS = DEFAULT_HOSTS.slice();
      allowedList.textContent = ALLOW_HOSTS.join(', ') + ' (default list)';
      renderApprovedApps();
      browseStatus.textContent = 'Could not load the saved allowlist; showing the default approved sites.';
    }
  }

  function browseTo(value) {
    const normalized = normalize(value);
    if (!normalized || !['http:', 'https:'].includes(new URL(normalized).protocol)) {
      browseStatus.textContent = 'Please enter a valid HTTP or HTTPS website address.';
      return false;
    }
    const host = new URL(normalized).hostname.toLowerCase();
    if (!isAllowed(normalized)) {
      browseStatus.textContent = 'That site is not on the configured allowlist. Ask the administrator to add ' + host + '.';
      return false;
    }
    loadInFrame(viewer, proxyUrl(normalized), normalized, host, '');
    browseStatus.textContent = '';
    switchTab('browse');
    return true;
  }

  window.goProxy = function () {
    browseTo(urlInput.value);
    return false;
  };

  openNew.addEventListener('click', function () {
    if (!this.dataset.url) {
      browseStatus.textContent = 'Choose an approved app or enter an approved website first.';
      return;
    }
    window.open(this.dataset.url, '_blank', 'noopener,noreferrer');
  });
  if (openDirect) {
    openDirect.addEventListener('click', function () {
      const url = this.dataset.url;
      if (!url || !isAllowed(url)) {
        browseStatus.textContent = 'Choose an approved website first.';
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
    });
  }

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
          const host = new URL(normalized).hostname;
          loadInFrame(resultViewer, proxyUrl(normalized), normalized, host, 'Search result: ');
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

  loadAllowlist();
})();
