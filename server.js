const express = require('express');
const got = require('got');
const cheerio = require('cheerio');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieSession = require('cookie-session');
const { URL } = require('url');
const path = require('path');

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

// Basic rate limit
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60 // limit each IP to 60 requests per windowMs
});
app.use(limiter);

// Allowlist based on your list
const ALLOW_HOSTS = [
  'spotify.com',
  'youtube.com',
  'yahoo.com',
  'mail.yahoo.com',
  'amazon.com'
];

function isAllowedHost(hostname) {
  if (!hostname) return false;
  return ALLOW_HOSTS.some(allowed => {
    return hostname === allowed || hostname.endsWith('.' + allowed);
  });
}

// Auth middleware (simple password protected)
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.redirect('/login');
}

// UI routes
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const pwd = req.body.password || '';
  const expected = process.env.PROXY_PASSWORD || '';
  if (!expected) return res.status(500).send('PROXY_PASSWORD not set in environment/secrets');
  if (pwd === expected) {
    req.session.authenticated = true;
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

// Proxy endpoint (unchanged, but left here to work with the new UI)
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

    const gotOptions = {
      method,
      headers,
      throwHttpErrors: false,
      isStream: true
    };

    if (method !== 'GET' && method !== 'HEAD') {
      gotOptions.body = req;
    }

    const upstream = got.stream(target.href, gotOptions);

    upstream.on('response', upstreamRes => {
      res.status(upstreamRes.statusCode);
      const contentType = upstreamRes.headers['content-type'] || '';
      ['content-type', 'content-length', 'cache-control', 'last-modified', 'etag'].forEach(h => {
        if (upstreamRes.headers[h]) res.setHeader(h, upstreamRes.headers[h]);
      });

      if (contentType.includes('text/html')) {
        let html = '';
        upstream.on('data', chunk => { html += chunk.toString('utf8'); });
        upstream.on('end', () => {
          try {
            const $ = cheerio.load(html);
            $('a[href], link[href], script[src], img[src], form[action]').each((i, el) => {
              const attr = el.tagName === 'form' ? 'action' : (el.attribs.href ? 'href' : 'src');
              let val = $(el).attr(attr);
              if (!val) return;
              try { val = new URL(val, target.href).href; } catch (e) { return; }
              $(el).attr(attr, '/proxy?url=' + encodeURIComponent(val));
            });
            $('body').prepend('<div style="position:fixed;left:0;right:0;top:0;background:#fffae6;border-bottom:1px solid #ddd;padding:6px;font-size:13px;z-index:9999;">Proxied via private Replit proxy</div><div style="height:36px;"></div>');
            res.send($.html());
          } catch (err) {
            res.send(html);
          }
        });
        upstream.on('error', e => {
          if (!res.headersSent) res.status(502).send('Upstream read error');
        });
      } else {
        upstream.pipe(res);
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

// Health
app.get('/_health', (req, res) => res.send('ok'));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('Proxy running on port', port));
