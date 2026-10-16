# Replit Web Proxy (Private)

This is a simple, private web-based HTTP proxy prepared for Replit. It restricts allowed target sites to an allowlist, and requires a password to use.

Allowed hosts (pre-configured):
- spotify.com
- youtube.com
- yahoo.com
- mail.yahoo.com
- amazon.com

Important: This project is for personal/educational use only. Do not deploy a public open proxy. See the security notes below.

## How to run on Replit (no coding required)

1. Create a new Repl:
   - Go to https://replit.com and sign in or create an account.
   - Click "Create" → choose the "Node.js" template.

2. Import from GitHub (recommended):
   - On Replit, choose "Import from GitHub" and enter the repo URL: https://github.com/BaDGrEycOder/replit-web-proxy
   - Replit will create a Repl from the repository and install dependencies automatically when you press Run.

3. Or upload the project files manually:
   - In the Replit editor, upload the files if you prefer manual upload.

4. Set the password (RECOMMENDED):
   - In Replit, open the "Secrets" (Environment variables) area.
   - Add a secret with name `PROXY_PASSWORD` and set a strong password.
   - Optionally set `SESSION_SECRET` to a random string (improves cookie security).

5. Press the green "Run" button.
   - Replit will start the app. After startup, the Repl provides a URL (Open in new tab). Use that URL to access the proxy.

6. Use the proxy:
   - Open the Repl URL. You'll be asked to log in with the password you set.
   - Enter a URL like `https://example.com` (subject to the allowlist) in the form and press Go.

## Notes & limitations
- The proxy restricts allowed hosts. If a site is blocked, add its domain to ALLOW_HOSTS in `server.js`.
- Some sites that rely on exact host headers, advanced cookies, or strict anti-bot measures may not work.
- Do NOT use this for illegal activity. Running a public open proxy is risky.
- Replit private Repls require a paid plan; this app uses password protection so it can run in a public Repl while remaining accessible only to those who know the password.

If you want, I can:
- Add more allowed domains (say youtu.be) or let you toggle the allowlist through a small admin page.
- Harden the app with stronger rate limits, bandwidth caps, or logging.

