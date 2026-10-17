const express = require('express');
const fs = require('fs').promises;
const fsSync = require('fs');
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

// Serve static UI files from /public
app.use('/static', express.static(path.join(__dirname, 'public')));

// Session cookie for simple login
app.use(cookieSession({
  name: 'session',
  keys: [process.env.SESSION_SECRET || 'change_this_secret'],
  maxAge: 24 * 60 * 60 * 1000 // 1 day
}));

// Basic rate limit (per IP)
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: process.env.RATE_LIMIT_PER_MIN ? parseInt(process.env.RATE_LIMIT_PER_MIN) : 60
});
app.use(limiter);

// Data files
const ALLOW_FILE = path.join(__dirname, 'data', 'allowlist.json');
const STATS_FILE = path.join(__dirname, 'data', 'stats.json');

// Ensure data dir
if (!fsSync.existsSync(path.join(__dirname, 'data'))) fsSync.mkdirSync(path.join(__dirname, 'data'));

// Load or create allowlist
async function loadAllowlist() {
  try {
    const raw = await fs.readFile(ALLOW_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    const defaultList = ['spotify.com','youtube.com','yahoo.com','mail.yahoo.com','amazon.com'];
    await fs.writeFile(ALLOW_FILE, JSON.stringify(defaultList, null, 2));
    return defaultList;
  }
}

async function saveAllowlist(list) {
  await fs.writeFile(ALLOW_FILE, JSON.stringify(list, null, 2));
}

// Load or create stats
async function loadStats() {
  try {
    const raw = await fs.readFile(STATS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    const initial = { totalRequests:0, bytes:0, byHost:{}, events:[] };
    await fs.writeFile(STATS_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
}

async function saveStats(stats) {
  await fs.writeFile(STATS_FILE, JSON.stringify(stats, null, 2));
}

let ALLOW_HOSTS = [];
let STATS = { totalRequests:0, bytes:0, byHost:{}, events:[] };
loadAllowlist().then(list => ALLOW_HOSTS = list);
loadStats().then(s => STATS = s);

function isAllowedHost(hostname) {
  if (!hostname) return false;
  return ALLOW_HOSTS.some(allowed => hostname === allowed || hostname.endsWith('.' + allowed));
}

// In-memory per-session cookie jars
const sessionJars = new Map(); // sessionId -> CookieJar

function getSessionId(req) {
  if (!req.session.sessionId) {
    req.session.sessionId = Math.random().toString(36).slice(2);
  }
  return req.session.sessionId;
}

function getJarForSession(req) {
  const sid = getSessionId(req);
  if (!sessionJars.has(sid)) sessionJars.set(sid, new CookieJar());
  return sessionJars.get(sid);
}

// Auth middleware (simple password protected for users)
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.redirect('/login?admin=1');
}

// UI routes
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const pwd = (req.body.password || '').toString();
  const expected = process.env.PROXY_PASSWORD || '';
  const adminPwd = process.env.ADMIN_PASSWORD || '';
  if (!expected) return res.status(500).send('PROXY_PASSWORD not set in environment/secrets');
  if (pwd === expected) {
    req.session.authenticated = true;
    req.session.isAdmin = (adminPwd && pwd === adminPwd);
    return res.redirect('/');
  }
  res.status(401).send('Invalid password. <a href="/login">Try again</a>');
});

app.get('/logout', (req, res) => {
  req.session = null;
  res.redirect('/login');
});

app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// Admin UI
app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Admin API: get allowlist
app.get('/api/admin/allowlist', requireAdmin, async (req, res) => {
  res.json(ALLOW_HOSTS);
});

// Admin API: update allowlist
app.post('/api/admin/allowlist', requireAdmin, async (req, res) => {
  const list = req.body.list;
  if (!Array.isArray(list)) return res.status(400).send('Invalid list');
  ALLOW_HOSTS = list.map(s => s.trim()).filter(Boolean);
  await saveAllowlist(ALLOW_HOSTS);
  res.json({ok:true, list: ALLOW_HOSTS});
});

// Admin API: stats
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  res.json(STATS);
});

// Clear cookies for session
app.post('/api/clear-cookies', requireAuth, (req, res) => {
  const sid = getSessionId(req);
  sessionJars.delete(sid);
  res.json({ok:true});
});

// AI endpoint
app.post('/api/ai', requireAuth, async (req, res) => {
  // Expect { prompt: string, includePage: boolean, pageUrl?: string, pageText?: string }
  const { prompt, includePage, pageUrl, pageText } = req.body || {};
  if (!prompt) return res.status(400).send('Missing prompt');
  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(500).send('OPENAI_API_KEY not configured');

  // Build messages
  const system = `You are Copilot: an assistant to help the user browse. Be concise and helpful.`;
  let messages = [{role:'system', content: system}, {role:'user', content: prompt}];
  if (includePage && pageUrl && pageText) {
    messages.push({role:'user', content: `Context from ${pageUrl}: ${pageText}`});
  }

  try {
    const model = process.env.OPENAI_MODEL || 'gpt-3.5-turbo';
    const resp = await got.post('https://api.openai.com/v1/chat/completions', {
      json: { model, messages, max_tokens: 500 },
      headers: { Authorization: `Bearer ${key}` },
      responseType: 'json',
      timeout: { request: 30000 }
    });
    const ans = resp.body.choices && resp.body.choices[0] && resp.body.choices[0].message && resp.body.choices[0].message.content;
    res.json({ok:true, answer: ans});
  } catch (err) {
    console.error('AI error', err && err.response && err.response.body ? err.response.body : err.message);
    res.status(500).send('AI provider error');
  }
});

// Proxy endpoint
app.all('/proxy', requireAuth, async (req, res) => {
  const rawUrl = req.query.url || req.body.url;
  if (!rawUrl) return res.status(400).send('Missing url parameter');

  let target;
  try {
    target = new URL(rawUrl);
  } catch (err) {
    return res.status(400).send('Invalid URL');
  }

  if (!isAllowedHost(target.hostname)) {
    return res.status(403).send('Host not allowed by proxy policy');
  }

  try {
    const method = req.method;
    const headers = { ...req.headers };
    delete headers.host;
    delete headers['content-length'];

    const cookieJar = getJarForSession(req);
    const gotOptions = {
      method,
      headers,
      throwHttpErrors: false,
      isStream: true,
      cookieJar
    };

    if (method !== 'GET' && method !== 'HEAD') {
      gotOptions.body = req;
    }

    const upstream = got.stream(target.href, gotOptions);
    let byteCount = 0;

    upstream.on('response', upstreamRes => {
      res.status(upstreamRes.statusCode);
      const contentType = upstreamRes.headers['content-type'] || '';
      ['content-type', 'content-length', 'cache-control', 'last-modified', 'etag'].forEach(h => {
        if (upstreamRes.headers[h]) res.setHeader(h, upstreamRes.headers[h]);
      });

      if (upstreamRes.headers['content-length']) {
        const n = parseInt(upstreamRes.headers['content-length']);
        if (!isNaN(n)) byteCount += n;
      }

      if (contentType.includes('text/html')) {
        let html = '';
        upstream.on('data', chunk => { html += chunk.toString('utf8'); byteCount += chunk.length; });
        upstream.on('end', async () => {
          try {
            const $ = cheerio.load(html);
            $('a[href], link[href], script[src], img[src], form[action]').each((i, el) => {
              const attr = el.tagName === 'form' ? 'action' : (el.attribs.href ? 'href' : 'src');
              let val = $(el).attr(attr);
              if (!val) return;
              try { val = new URL(val, target.href).href; } catch (e) { return; }
              $(el).attr(attr, '/proxy?url=' + encodeURIComponent(val));
            });
            $('body').prepend('<div style="position:fixed;left:0;right:0;top:0;background:#ffffffaa;backdrop-filter:blur(6px);border-bottom:1px solid #ddd;padding:6px;font-size:13px;z-index:9999;">Proxied via private Replit proxy</div><div style="height:36px;"></div>');
            const out = $.html();
            res.send(out);
          } catch (err) {
            res.send(html);
          }
          await recordStats(target.hostname, byteCount);
        });
        upstream.on('error', e => {
          if (!res.headersSent) res.status(502).send('Upstream read error');
        });
      } else {
        upstream.on('data', chunk => { byteCount += chunk.length; });
        upstream.pipe(res);
        upstream.on('end', async () => { await recordStats(target.hostname, byteCount); });
      }
    });

    upstream.on('error', err => {
      if (!res.headersSent) res.status(502).send('Upstream connection error');
    });

  } catch (err) {
    console.error('Proxy error', err);
    res.status(500).send('Proxy server error');
  }
});

async function recordStats(hostname, bytes) {
  try {
    STATS.totalRequests = (STATS.totalRequests||0) + 1;
    STATS.bytes = (STATS.bytes||0) + (bytes||0);
    STATS.byHost = STATS.byHost || {};
    STATS.byHost[hostname] = (STATS.byHost[hostname]||0) + 1;
    STATS.events = STATS.events || [];
    STATS.events.push({ts:new Date().toISOString(), host:hostname, bytes: bytes||0});
    // keep events short
    if (STATS.events.length > 500) STATS.events.shift();
    await saveStats(STATS);
  } catch (e) { console.error('stat save err', e); }
}

// Health
app.get('/_health', (req, res) => res.send('ok'));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('Proxy running on port', port));
