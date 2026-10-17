# Replit Web Proxy (Private) - NO AI

This repository contains a simple, private web-based HTTP proxy prepared for hosting (Render, Replit, etc.). AI/Copilot features have been removed in this version.

Allowed hosts (default):
- spotify.com
- youtube.com
- yahoo.com
- mail.yahoo.com
- amazon.com

Important: This project is for personal/educational use only. Do not deploy a public open proxy. See the security notes below.

## How to run (no coding required)

1. Deploy from GitHub (Render, Railway, DigitalOcean App Platform) or run locally with Node.js.

2. Environment variables (required):
   - PROXY_PASSWORD: password used to log into the proxy UI
   - SESSION_SECRET: random string for cookie session signing
   - ADMIN_PASSWORD: admin-only password (recommended)
   - RATE_LIMIT_PER_MIN: optional integer (default 60)

3. Start:
   - npm install
   - npm start

4. Use:
   - Visit /login and enter PROXY_PASSWORD
   - Enter an allowed URL in the UI and press Go

## Notes & limitations
- The proxy restricts allowed hosts using a runtime allowlist stored in data/allowlist.json. Admins can edit the allowlist via /admin.
- Data files (data/*.json) are stored on the instance filesystem. On managed platforms this may be ephemeral across deploys. For persistence, use a managed database and update the app.
- This build removes all AI/OpenAI integrations and will not send page content to third parties.

If you want me to add Postgres persistence or re-enable a safe AI integration later, I can prepare it.
