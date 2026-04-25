# حفرة — Hafra.DZ · Deployment Guide

## File Structure
```
hafra.dz/
├── index.html          ← App shell (HTML + CSP)
├── app.js              ← All logic (edit SUPABASE_URL + KEY here)
├── manifest.json       ← PWA installability
├── sw.js               ← Service worker (offline + caching)
├── logo.png            ← ⬅ DROP YOUR LOGO HERE (any size, PNG recommended)
├── _headers            ← HTTP security headers (Netlify / Cloudflare)
├── _redirects          ← SPA routing + www → apex redirect
└── supabase/
    └── schema.sql      ← Full DB schema with RLS + security constraints
```

---

## Step 1 — Create Supabase Project

1. Go to https://supabase.com → **New Project**
2. Name: `hafra-dz`
3. Region: **Frankfurt** (eu-central-1) — closest to Algeria
4. Password: generate a strong one and save it

---

## Step 2 — Run the Database Schema

1. Supabase Dashboard → **SQL Editor** → **New Query**
2. Paste the entire contents of `supabase/schema.sql`
3. Click **Run**
4. Verify: Table Editor should show a `reports` table with all columns

---

## Step 3 — Get Your API Keys

Dashboard → **Settings** → **API**:

| Setting | Value |
|---------|-------|
| Project URL | `https://xxxxxxxx.supabase.co` |
| anon public key | Long JWT starting with `eyJ…` |

---

## Step 4 — Configure app.js

Open `app.js` and edit lines 12–13:

```javascript
const SUPABASE_URL      = 'https://YOUR_PROJECT_REF.supabase.co';  // ← replace
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY_HERE';                    // ← replace
```

---

## Step 5 — Add Your Logo

Drop your logo file as `logo.png` in the root folder.
- Recommended: 512×512 px, transparent background, PNG
- If no logo.png is present, the app falls back to the Arabic text "حفرة"

---

## Step 6 — Deploy to hafra.dz

### Option A — Netlify (Recommended, ~2 min)

1. Go to https://app.netlify.com → **Add new site → Deploy manually**
2. Drag the entire `hafra.dz/` folder
3. Site is live at a random URL
4. **Domain:** Site settings → Domain management → Add custom domain → `hafra.dz`
5. Follow DNS instructions (add A record or CNAME at your registrar)
6. Netlify auto-provisions SSL (Let's Encrypt)

### Option B — Cloudflare Pages

1. Dashboard → Pages → Create application → Direct upload
2. Upload the folder
3. Add `hafra.dz` as custom domain in Pages settings
4. Cloudflare handles DNS + SSL automatically

### Option C — GitHub + Netlify CI/CD

```bash
git init
git add .
git commit -m "🕳 hafra.dz initial deploy"
gh repo create hafra-dz --public --push --source=.
# Connect repo in Netlify: New site → Import from GitHub
```

---

## Step 7 — Configure hafra.dz DNS

At your domain registrar (NIC.dz for .dz domains):

**For Netlify:**
```
Type    Name    Value
A       @       75.2.60.5
CNAME   www     hafra.netlify.app
```

**For Cloudflare Pages:**
```
CNAME   @       hafra-dz.pages.dev
CNAME   www     hafra-dz.pages.dev
```

---

## Step 8 — Install as Mobile App (PWA)

### Android (Chrome / Samsung Browser)
1. Open `https://hafra.dz` in Chrome
2. Tap ⋮ menu → **Ajouter à l'écran d'accueil**
3. The app installs with your logo and works offline

### iPhone (Safari)
1. Open `https://hafra.dz` in Safari
2. Tap the **Share** button (box with arrow)
3. Tap **Sur l'écran d'accueil**

---

## Security Features Implemented

| Layer | Mechanism |
|-------|-----------|
| XSS | All user content rendered via `textContent` — zero `innerHTML` for user data |
| CSP | Strict Content-Security-Policy blocks external scripts and `javascript:` URIs |
| HTTP Headers | X-Frame-Options, HSTS, X-Content-Type-Options, Permissions-Policy |
| Input validation | Client-side + server-side DB CHECK constraints (can't be bypassed) |
| SQL injection | Supabase parameterized queries — impossible |
| Photo uploads | MIME-type whitelist, 5MB limit, UUID filename, URL validation regex |
| Rate limiting | Client: 5 reports/10min · Server: DB function + RLS CHECK |
| Coordinate validation | Algeria bounding-box check both client and server |
| Comment sanitisation | HTML stripped, max 300 chars, enforced by DB constraint |
| Photo URL validation | Regex ensures only Supabase Storage URLs are stored |
| RLS | Public can only INSERT (score=1-5, valid category) and update votes/status |
| No public DELETE | Only service_role (admin) key can delete reports |

---

## Admin Dashboard (Next Step)

The admin view is already scaffolded in the DB:
- `reports_admin` view (service_role only) with urgency scoring
- `get_stats()` function callable from any admin client
- All status changes are persisted via RLS-controlled UPDATE

The admin dashboard (`/admin`) will be built as a separate protected page in the next iteration.

---

## Database Schema Reference

```
reports
├── id          UUID         PK, auto-generated
├── lat         FLOAT8       CHECK(18.9..37.2)
├── lng         FLOAT8       CHECK(-8.7..12.0)
├── score       INT2         CHECK(1..5)
├── category    TEXT         CHECK(in allowed list)
├── comment     TEXT         CHECK(len ≤ 300)
├── photo_url   TEXT         CHECK(supabase URL regex or NULL)
├── wilaya      TEXT         Nearest wilaya name
├── votes       INT4         CHECK(≥ 0)
├── status      TEXT         CHECK(active|reported|fixed)
├── created_at  TIMESTAMPTZ  Auto
└── updated_at  TIMESTAMPTZ  Auto-updated by trigger
```
