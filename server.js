const express = require('express');
const fs = require('fs').promises;
const fsSync = require('fs');
const https = require('https');
const got = require('got');
const cheerio = require('cheerio');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieSession = require('cookie-session');
const { URL } = require('url');
const path = require('path');
const { CookieJar } = require('tough-cookie');

const app = express();
app.use(helmet());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/static', express.static(path.join(__dirname, 'public')));

app.use(cookieSession({
  name: 'session',
  keys: [process.env.SESSION_SECRET || 'change_this_secret'],
  maxAge: 24 * 60 * 60 * 1000
}));

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: process.env.RATE_LIMIT_PER_MIN ? parseInt(process.env.RATE_LIMIT_PER_MIN, 10) : 60
}));

const DATA_DIR = path.join(__dirname, 'data');
const ALLOW_FILE = path.join(DATA_DIR, 'allowlist.json');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
if (!fsSync.existsSync(DATA_DIR)) fsSync.mkdirSync(DATA_DIR, { recursive: true });

async function loadAllowlist() {
  try { return JSON.parse(await fs.readFile(ALLOW_FILE, 'utf8')); }
  catch {
    const defaults = ['spotify.com', 'youtube.com', 'yahoo.com', 'mail.yahoo.com', 'amazon.com'];
    await fs.writeFile(ALLOW_FILE, JSON.stringify(defaults, null, 2));
    return defaults;
  }
}
async function saveAllowlist(list) {
  await fs.writeFile(ALLOW_FILE, JSON.stringify(list, null, 2));
}
async function loadStats() {
  try { return JSON.parse(await fs.readFile(STATS_FILE, 'utf8')); }
  catch {
    const initial = { totalRequests: 0, bytes: 0, byHost: {}, events: [] };
    await fs.writeFile(STATS_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
}
async function saveStats(stats) {
  await fs.writeFile(STATS_FILE, JSON.stringify(stats, null, 2));
}

let ALLOW_HOSTS = [];
let STATS = { totalRequests: 0, bytes: 0, byHost: {}, events: [] };
loadAllowlist().then(list => { ALLOW_HOSTS = list; }).catch(console.error);
loadStats().then(stats => { STATS = stats; }).catch(console.error);

function isAllowedHost(hostname) {
  return Boolean(hostname) && ALLOW_HOSTS.some(host => hostname === host || hostname.endsWith('.' + host));
}

const sessionJars = new Map();
function getSessionId(req) {
  if (!req.session.sessionId) req.session.sessionId = Math.random().toString(36).slice(2);
  return req.session.sessionId;
}
function getJarForSession(req) {
  const sid = getSessionId(req);
  if (!sessionJars.has(sid)) sessionJars.set(sid, new CookieJar());
  return sessionJars.get(sid);
}
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.redirect('/login');
}
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.redirect('/login?admin=1');
}

app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.post('/login', (req, res) => {
  const password = (req.body.password || '').toString();
  const userPassword = process.env.PROXY_PASSWORD || '';
  const adminPassword = process.env.ADMIN_PASSWORD || '';
  if (!userPassword) return res.status(500).send('PROXY_PASSWORD not set in environment/secrets');
  if (password === userPassword || (adminPassword && password === adminPassword)) {
    req.session.authenticated = true;
    req.session.isAdmin = Boolean(adminPassword && password === adminPassword);
    return res.redirect('/');
  }
  res.status(401).send('Invalid password. <a href="/login">Try again</a>');
});
app.get('/logout', (req, res) => { req.session = null; res.redirect('/login'); });
app.get('/', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));
app.get('/admin', requireAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.get('/api/admin/allowlist', requireAdmin, (req, res) => res.json(ALLOW_HOSTS));
app.post('/api/admin/allowlist', requireAdmin, async (req, res) => {
  if (!Array.isArray(req.body.list)) return res.status(400).send('Invalid list');
  const list = req.body.list.map(value => String(value).trim().toLowerCase()).filter(Boolean);
  if (list.some(host => !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(host))) {
    return res.status(400).send('Enter hostnames only, such as example.com');
  }
  ALLOW_HOSTS = [...new Set(list)];
  await saveAllowlist(ALLOW_HOSTS);
  res.json({ ok: true, list: ALLOW_HOSTS });
});
app.get('/api/admin/stats', requireAdmin, (req, res) => res.json(STATS));

function fetchDuckDuckGo(query) {
  const searchUrl = new URL('https://html.duckduckgo.com/html/');
  searchUrl.searchParams.set('q', query);
  return new Promise((resolve, reject) => {
    const request = https.get(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PrivateSearch/1.0)', Accept: 'text/html' }
    }, response => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        return reject(new Error(`Search provider returned ${response.statusCode}`));
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; if (body.length > 1024 * 1024) request.destroy(new Error('Search response too large')); });
      response.on('end', () => resolve(body));
      response.on('error', reject);
    });
    request.setTimeout(8000, () => request.destroy(new Error('Search timed out')));
    request.on('error', reject);
  });
}
app.get('/api/search', requireAuth, async (req, res) => {
  const query = String(req.query.q || '').trim().slice(0, 200);
  if (query.length < 2) return res.status(400).json({ error: 'Enter at least 2 characters to search.' });
  try {
    const html = await fetchDuckDuckGo(query);
    const $ = cheerio.load(html);
    const results = [];
    $('.result').each((_, element) => {
      if (results.length >= 10) return;
      const link = $(element).find('.result__a').first();
      const title = link.text().trim();
      let href = link.attr('href');
      const snippet = $(element).find('.result__snippet').first().text().trim();
      if (!title || !href) return;
      try {
        const parsed = new URL(href, 'https://html.duckduckgo.com');
        const destination = parsed.searchParams.get('uddg');
        href = destination ? decodeURIComponent(destination) : parsed.href;
        const safeUrl = new URL(href);
        if (!['http:', 'https:'].includes(safeUrl.protocol)) return;
        results.push({ title, snippet, url: safeUrl.href });
      } catch { /* Skip malformed search result links. */ }
    });
    res.json({ results });
  } catch (error) {
    console.error('Search error:', error.message);
    res.status(502).json({ error: 'Search is temporarily unavailable. Please try again.' });
  }
});

app.post('/api/clear-cookies', requireAuth, (req, res) => {
  sessionJars.delete(getSessionId(req));
  res.json({ ok: true });
});

app.all('/proxy', requireAuth, async (req, res) => {
  const rawUrl = req.query.url || req.body.url;
  if (!rawUrl) return res.status(400).send('Missing url parameter');
  let target;
  try { target = new URL(rawUrl); }
  catch { return res.status(400).send('Invalid URL'); }
  if (!['http:', 'https:'].includes(target.protocol)) return res.status(400).send('Only HTTP and HTTPS URLs are allowed');
  if (!isAllowedHost(target.hostname)) return res.status(403).send('Host not allowed by proxy policy');

  try {
    const headers = { ...req.headers };
    delete headers.host;
    delete headers['content-length'];
    const upstream = got.stream(target.href, {
      method: req.method,
      headers,
      throwHttpErrors: false,
      cookieJar: getJarForSession(req),
      ...(req.method !== 'GET' && req.method !== 'HEAD' ? { body: req } : {})
    });
    let byteCount = 0;
    upstream.on('response', upstreamRes => {
      res.status(upstreamRes.statusCode);
      const contentType = upstreamRes.headers['content-type'] || '';
      ['content-type', 'cache-control', 'last-modified', 'etag'].forEach(header => {
        if (upstreamRes.headers[header]) res.setHeader(header, upstreamRes.headers[header]);
      });
      if (contentType.includes('text/html')) {
        let html = '';
        upstream.on('data', chunk => { html += chunk.toString('utf8'); byteCount += chunk.length; });
        upstream.on('end', async () => {
          try {
            const $ = cheerio.load(html);
            $('a[href], link[href], script[src], img[src], form[action]').each((_, element) => {
              const attr = element.tagName === 'form' ? 'action' : (element.attribs.href ? 'href' : 'src');
              const value = $(element).attr(attr);
              if (!value) return;
              try { $(element).attr(attr, '/proxy?url=' + encodeURIComponent(new URL(value, target.href).href)); }
              catch { /* Leave invalid/relative special values untouched. */ }
            });
            $('body').prepend('<div style="position:fixed;left:0;right:0;top:0;background:#ffffffaa;backdrop-filter:blur(6px);border-bottom:1px solid #ddd;padding:6px;font-size:13px;z-index:9999;">Proxied via private web proxy</div><div style="height:36px;"></div>');
            res.send($.html());
          } catch { res.send(html); }
          await recordStats(target.hostname, byteCount);
        });
      } else {
        upstream.on('data', chunk => { byteCount += chunk.length; });
        upstream.pipe(res);
        upstream.on('end', () => recordStats(target.hostname, byteCount));
      }
    });
    upstream.on('error', error => {
      console.error('Proxy error:', error.message);
      if (!res.headersSent) res.status(502).send('Upstream connection error');
    });
  } catch (error) {
    console.error('Proxy error:', error.message);
    res.status(500).send('Proxy server error');
  }
});

async function recordStats(hostname, bytes) {
  try {
    STATS.totalRequests = (STATS.totalRequests || 0) + 1;
    STATS.bytes = (STATS.bytes || 0) + (bytes || 0);
    STATS.byHost = STATS.byHost || {};
    STATS.byHost[hostname] = (STATS.byHost[hostname] || 0) + 1;
    STATS.events = STATS.events || [];
    STATS.events.push({ ts: new Date().toISOString(), host: hostname, bytes: bytes || 0 });
    if (STATS.events.length > 500) STATS.events.shift();
    await saveStats(STATS);
  } catch (error) { console.error('Stats save error:', error.message); }
}

app.get('/_health', (req, res) => res.send('ok'));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log('Proxy running on port', port));
