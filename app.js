/**
 * hafra.dz — app.js
 * All user-supplied content is rendered via DOM text nodes (never innerHTML).
 * Input is sanitised and rate-limited client-side; server enforces RLS + CHECK.
 */

'use strict';

// ══════════════════════════════════════════════════════════════════════════════
//  ⚙️  CONFIG — Edit these two lines after creating your Supabase project
// ══════════════════════════════════════════════════════════════════════════════
const SUPABASE_URL      = 'https://njijaewqenuranmqswpf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qaWphZXdxZW51cmFubXFzd3BmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMTczODksImV4cCI6MjA5MjY5MzM4OX0.mfuNoKGabrg1URPh3f3Ny6mW9ND_D_NOdKHdHybWrf0';
// ══════════════════════════════════════════════════════════════════════════════

// ── SECURITY: XSS-safe DOM helpers ───────────────────────────────────────────
/** Escape a string for safe insertion as text content. */
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Create a text node — zero XSS risk. Use for all user-supplied content. */
function txt(str) {
  return document.createTextNode(str == null ? '' : String(str));
}

/** Sanitise comment input: strip HTML tags, limit length, trim. */
function sanitiseComment(raw) {
  if (!raw) return null;
  const stripped = raw.replace(/<[^>]*>/g, '').trim();
  return stripped.slice(0, 300) || null;
}

/** Validate coordinates are within Algeria's bounding box (roughly). */
function validAlgeriaCoords(lat, lng) {
  return lat >= 18.9 && lat <= 37.2 && lng >= -8.7 && lng <= 12.0;
}

/** Allowed categories — anything else is rejected. */
const VALID_CATS = new Set(['pothole','cracks','lighting','signage','flooding','utility']);

// ── CLIENT-SIDE RATE LIMITER ──────────────────────────────────────────────────
/** Prevent spam: max 5 reports per 10 minutes per browser session. */
const RateLimiter = (() => {
  const KEY = 'hf_rl';
  const LIMIT = 5, WINDOW_MS = 10 * 60 * 1000;
  function get() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{"ts":0,"n":0}'); }
    catch { return { ts: 0, n: 0 }; }
  }
  return {
    check() {
      const d = get(), now = Date.now();
      if (now - d.ts > WINDOW_MS) return true;
      return d.n < LIMIT;
    },
    record() {
      const d = get(), now = Date.now();
      if (now - d.ts > WINDOW_MS) { localStorage.setItem(KEY, JSON.stringify({ ts: now, n: 1 })); return; }
      localStorage.setItem(KEY, JSON.stringify({ ts: d.ts, n: d.n + 1 }));
    },
  };
})();

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const CATS = {
  pothole:  { fr: 'Nid-de-poule',  ar: 'حفرة',          ico: '🕳',  col: '#EF4444' },
  cracks:   { fr: 'Fissures',      ar: 'تشققات',         ico: '🪨',  col: '#F97316' },
  lighting: { fr: 'Éclairage',     ar: 'إضاءة مفقودة',   ico: '🌑',  col: '#818CF8' },
  signage:  { fr: 'Signalisation', ar: 'لافتات مفقودة',  ico: '🚧',  col: '#FBBF24' },
  flooding: { fr: 'Inondation',    ar: 'فيضان',          ico: '🌊',  col: '#38BDF8' },
  utility:  { fr: 'ADE / SEAAL',   ar: 'أضرار المياه',   ico: '💧',  col: '#34D399' },
};
const STAR_LABELS = {
  1: { fr: 'Impraticable', ar: 'خطير جداً' },
  2: { fr: 'Très mauvais', ar: 'سيء جداً'  },
  3: { fr: 'Acceptable',   ar: 'مقبول'     },
  4: { fr: 'Bon état',     ar: 'جيد'       },
  5: { fr: 'Parfait',      ar: 'ممتاز'     },
};
const STATUSES = {
  active:   { fr: 'Actif',    ar: 'نشط',         col: '#EF4444', dot: '🔴' },
  reported: { fr: 'Signalé',  ar: 'تم الإبلاغ',  col: '#FBBF24', dot: '🟡' },
  fixed:    { fr: 'Réparé',   ar: 'تم الإصلاح',  col: '#22C55E', dot: '🟢' },
};
const WILAYAS = [
  {n:'Alger',lat:36.737,lng:3.086},{n:'Oran',lat:35.697,lng:-0.627},
  {n:'Constantine',lat:36.365,lng:6.614},{n:'Blida',lat:36.470,lng:2.813},
  {n:'Batna',lat:35.554,lng:6.173},{n:'Sétif',lat:36.190,lng:5.412},
  {n:'Annaba',lat:36.901,lng:7.757},{n:'Tizi Ouzou',lat:36.753,lng:4.053},
  {n:'Béjaïa',lat:36.756,lng:5.084},{n:'Biskra',lat:34.850,lng:5.728},
  {n:'Tlemcen',lat:34.877,lng:-1.316},{n:'Ouargla',lat:31.949,lng:5.335},
  {n:'Ghardaïa',lat:32.490,lng:3.671},{n:'Tiaret',lat:35.370,lng:1.322},
  {n:'Mostaganem',lat:35.938,lng:0.089},{n:'Chlef',lat:36.165,lng:1.338},
  {n:'Mascara',lat:35.395,lng:0.143},{n:'Tipaza',lat:36.588,lng:2.447},
  {n:'Skikda',lat:36.879,lng:6.905},{n:'Guelma',lat:36.462,lng:7.427},
  {n:'Boumerdès',lat:36.762,lng:3.477},{n:'Médéa',lat:36.264,lng:2.749},
  {n:'Djelfa',lat:34.671,lng:3.263},{n:"M'Sila",lat:35.705,lng:4.539},
  {n:'El Oued',lat:33.368,lng:6.863},{n:'Béchar',lat:31.617,lng:-2.214},
  {n:'Tamanrasset',lat:22.785,lng:5.523},{n:'Adrar',lat:27.870,lng:-0.294},
  {n:'Laghouat',lat:33.800,lng:2.865},{n:'Khenchela',lat:35.436,lng:7.143},
];
const MAX_FILE_MB = 5;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg','image/jpg','image/png','image/webp']);

// ── STATE ─────────────────────────────────────────────────────────────────────
let reports = [];
let confirmedIds = new Set();
try { confirmedIds = new Set(JSON.parse(localStorage.getItem('hf_confirmed') || '[]')); } catch {}
let showHeat = true, showMarkers = true;
let addMode = false, pendingLat = null, pendingLng = null;
let selCategory = null, selStars = 0;
let pendingMarker = null, heatLayer = null;
let currentTab = 'feed';
let photoFile = null;

// ── SUPABASE ──────────────────────────────────────────────────────────────────
const IS_CONFIGURED = !SUPABASE_URL.includes('YOUR_PROJECT');
let db = null;
if (IS_CONFIGURED) {
  try { db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY); }
  catch (e) { console.warn('[hafra] Supabase init failed:', e); }
}

// ── MAP ───────────────────────────────────────────────────────────────────────
const map = L.map('map', { center:[28, 1.66], zoom:5, minZoom:4, maxZoom:19, zoomControl:true });
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a> · © <a href="https://carto.com">CARTO</a>',
  subdomains: 'abcd', maxZoom: 20,
}).addTo(map);
const markerGroup = L.layerGroup().addTo(map);

// ── HELPERS ───────────────────────────────────────────────────────────────────
function starCol(s) {
  return s===1?'#EF4444':s===2?'#F97316':s===3?'#FBBF24':s===4?'#84CC16':'#22C55E';
}
/** Returns safe stars HTML — no user data involved, safe to use. */
function starsHTML(s, sz = 14) {
  return Array.from({ length:5 }, (_,i) =>
    `<span style="font-size:${sz}px;filter:${i<s?'none':'grayscale(1) opacity(.2)'}">⭐</span>`
  ).join('');
}
function timeAgo(ts) {
  const d = Date.now() - new Date(ts).getTime();
  const m = Math.floor(d/60000), h = Math.floor(d/3600000), days = Math.floor(d/86400000);
  if (m < 2) return 'à l\'instant';
  if (m < 60) return `${m}min`;
  if (h < 24) return `${h}h`;
  return `${days}j`;
}
function nearestWilaya(lat, lng) {
  let best = 'Algérie', minD = Infinity;
  WILAYAS.forEach(w => { const d = Math.hypot(w.lat-lat, w.lng-lng); if (d<minD) { minD=d; best=w.n; } });
  return best;
}
function makeIcon(r) {
  const sc = starCol(r.score), c = CATS[r.category] || CATS.pothole;
  // Use a truncated unique id so each marker's filter doesn't collide in the DOM
  const fid = 'ds' + String(r.id).replace(/[^a-z0-9]/gi, '').slice(0, 12);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 50" width="40" height="50">
    <filter id="${fid}"><feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-opacity="0.45"/></filter>
    <path d="M20 0C9 0 0 9.4 0 21C0 36 20 50 20 50S40 36 40 21C40 9.4 31 0 20 0Z" fill="${sc}" filter="url(#${fid})" opacity=".92"/>
    <circle cx="20" cy="20" r="14" fill="rgba(0,0,0,.22)"/>
    <text x="20" y="26" text-anchor="middle" fill="white" font-family="sans-serif" font-size="17">${c.ico}</text>
  </svg>`;
  return L.divIcon({ html:svg, className:'', iconSize:[40,50], iconAnchor:[20,50], popupAnchor:[0,-52] });
}
function showToast(msg) {
  const t = document.getElementById('toast');
  // Toast uses textContent — safe
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.classList.remove('show'), 3400);
}
function setConnPill(ok, text) {
  const pill = document.getElementById('conn-pill');
  document.getElementById('conn-dot').style.background = ok ? '#22C55E' : '#EF4444';
  // textContent — safe
  document.getElementById('conn-text').textContent = text;
  pill.classList.add('show');
  clearTimeout(pill._tid);
  pill._tid = setTimeout(() => pill.classList.remove('show'), 3200);
}

// ── RENDER MAP ────────────────────────────────────────────────────────────────
function renderMap() {
  markerGroup.clearLayers();
  if (showMarkers) {
    reports.forEach(r => {
      const m = L.marker([r.lat, r.lng], { icon: makeIcon(r) });
      const c = CATS[r.category] || CATS.pothole;
      const st = STATUSES[r.status] || STATUSES.active;
      const done = confirmedIds.has(r.id);

      // Build popup DOM safely — no innerHTML for user content
      const wrapper = document.createElement('div');

      if (r.photo_url && /^https:\/\/[a-zA-Z0-9._-]+\.supabase\.(co|in)\//.test(r.photo_url)) {
        const img = document.createElement('img');
        img.className = 'pu-photo';
        img.alt = 'Photo de la route';
        img.src = r.photo_url;
        img.onerror = () => img.remove();
        wrapper.appendChild(img);
      }

      const body = document.createElement('div');
      body.className = 'pu-body';

      // Top row
      const top = document.createElement('div');
      top.className = 'pu-top';

      const left = document.createElement('div');
      left.style.flex = '1';
      const catSpan = document.createElement('span');
      catSpan.className = 'pu-cat';
      catSpan.style.cssText = `color:${c.col};border-color:${c.col}40;background:${c.col}15`;
      catSpan.textContent = `${c.ico} ${c.fr}`;
      const starsDiv = document.createElement('div');
      starsDiv.style.marginTop = '7px';
      starsDiv.innerHTML = starsHTML(r.score, 15); // starsHTML = no user data
      left.appendChild(catSpan);
      left.appendChild(starsDiv);

      const right = document.createElement('div');
      right.style.cssText = 'text-align:right;font-size:11px;color:var(--dim2)';
      const wilayaDiv = document.createElement('div');
      wilayaDiv.style.fontWeight = '700';
      wilayaDiv.textContent = r.wilaya || 'Algérie';       // textContent ✓
      const timeDiv = document.createElement('div');
      timeDiv.style.cssText = "font-family:'JetBrains Mono',monospace;margin-top:2px;font-size:10px";
      timeDiv.textContent = timeAgo(r.created_at || r.ts); // textContent ✓
      right.appendChild(wilayaDiv);
      right.appendChild(timeDiv);

      top.appendChild(left);
      top.appendChild(right);
      body.appendChild(top);

      if (r.comment) {
        const cDiv = document.createElement('div');
        cDiv.className = 'pu-comment';
        cDiv.textContent = r.comment;                       // textContent ✓
        body.appendChild(cDiv);
      }

      // Footer
      const footer = document.createElement('div');
      footer.className = 'pu-footer';
      const confirmBtn = document.createElement('button');
      confirmBtn.className = 'pu-confirm' + (done ? ' done' : '');
      confirmBtn.type = 'button';
      const confirmCount = document.createElement('span');
      confirmCount.id = 'vc-' + r.id;
      confirmCount.textContent = String(r.votes || 0);
      confirmBtn.appendChild(txt('✓ Confirmer '));
      confirmBtn.appendChild(confirmCount);
      confirmBtn.onclick = () => upvote(r.id, confirmBtn);

      const statusBtn = document.createElement('span');
      statusBtn.className = 'pu-status';
      statusBtn.textContent = `${st.dot} ${st.fr}`;        // textContent ✓
      statusBtn.onclick = () => cycleStatus(r.id, statusBtn);

      footer.appendChild(confirmBtn);
      footer.appendChild(statusBtn);
      body.appendChild(footer);
      wrapper.appendChild(body);

      m.bindPopup(wrapper, { minWidth:240, maxWidth:300 });
      markerGroup.addLayer(m);
    });
  }

  if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
  if (showHeat && reports.length) {
    const pts = reports.map(r => [r.lat, r.lng, (6 - r.score) / 5]);
    heatLayer = L.heatLayer(pts, {
      radius:32, blur:24, maxZoom:13,
      gradient:{ 0:'#22C55E', 0.3:'#84CC16', 0.55:'#FBBF24', 0.75:'#F97316', 1:'#EF4444' },
    });
    heatLayer.addTo(map);
  }
}

// ── STATS HEADER ──────────────────────────────────────────────────────────────
function updateStats() {
  const n = reports.length;
  const avg = n ? (reports.reduce((a,r) => a + r.score, 0) / n).toFixed(1) : '—';
  const bad = reports.filter(r => r.score <= 2).length;
  document.getElementById('h-total').textContent = n;
  document.getElementById('h-avg').textContent = avg;
  if (avg !== '—') document.getElementById('h-avg').style.color = starCol(Math.round(parseFloat(avg)));
  document.getElementById('h-bad').textContent = bad;
}

// ── LOAD REPORTS ──────────────────────────────────────────────────────────────
async function loadReports() {
  try {
    if (!db) {
      reports = getDemoData();
      renderMap(); updateStats(); renderPanel();
      showToast('Mode démo — Configurez Supabase dans app.js');
      return;
    }
    const { data, error } = await db
      .from('reports')
      .select('id,lat,lng,score,category,comment,photo_url,wilaya,votes,status,created_at')
      .order('created_at', { ascending:false })
      .limit(500);
    if (error) throw error;
    reports = (data || []).filter(r =>
      VALID_CATS.has(r.category) &&
      r.score >= 1 && r.score <= 5 &&
      typeof r.lat === 'number' && typeof r.lng === 'number'
    );
    renderMap(); updateStats(); renderPanel();
    setConnPill(true, 'Connecté');
    subscribeRealtime();
  } catch (e) {
    console.warn('[hafra] Load error:', e);
    if (!reports.length) reports = getDemoData();
    renderMap(); updateStats(); renderPanel();
    setConnPill(false, 'Mode hors-ligne');
  } finally {
    // Always hide the loader — no matter what throws above
    hideLoader();
  }
}

function hideLoader() {
  const el = document.getElementById('app-loading');
  el.classList.add('hidden');
  setTimeout(() => el.remove(), 500);
}

// ── REALTIME ──────────────────────────────────────────────────────────────────
function subscribeRealtime() {
  if (!db) return;
  db.channel('reports-rt')
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'reports' }, payload => {
      const r = payload.new;
      if (!VALID_CATS.has(r.category) || r.score < 1 || r.score > 5) return;
      reports.unshift(r);
      renderMap(); updateStats(); renderPanel();
      const c = CATS[r.category] || CATS.pothole;
      showToast(`Nouveau signalement — ${c.ico} ${r.wilaya || ''}`);
    })
    .on('postgres_changes', { event:'UPDATE', schema:'public', table:'reports' }, payload => {
      const i = reports.findIndex(r => r.id === payload.new.id);
      if (i > -1) { reports[i] = payload.new; renderMap(); renderPanel(); }
    })
    .subscribe();
}

// ── UPVOTE ────────────────────────────────────────────────────────────────────
async function upvote(id, btn) {
  if (confirmedIds.has(id)) { showToast('Vous avez déjà confirmé ce signalement'); return; }
  confirmedIds.add(id);
  try { localStorage.setItem('hf_confirmed', JSON.stringify([...confirmedIds])); } catch {}
  const r = reports.find(x => x.id === id);
  if (r) r.votes = (r.votes || 0) + 1;
  btn.classList.add('done');
  const vc = document.getElementById('vc-' + id);
  if (vc) vc.textContent = String(r?.votes || 1);
  renderPanel();
  if (db) {
    try { await db.from('reports').update({ votes: r?.votes || 1 }).eq('id', id); }
    catch (e) { console.warn('[hafra] Upvote sync failed', e); }
  }
  showToast('Confirmation enregistrée');
}

async function cycleStatus(id, btn) {
  const r = reports.find(x => x.id === id);
  if (!r) return;
  const order = ['active','reported','fixed'];
  r.status = order[(order.indexOf(r.status || 'active') + 1) % 3];
  const st = STATUSES[r.status];
  btn.textContent = `${st.dot} ${st.fr}`;
  renderPanel();
  if (db) {
    try { await db.from('reports').update({ status: r.status }).eq('id', id); }
    catch (e) { console.warn('[hafra] Status sync failed', e); }
  }
  showToast(`Statut: ${st.fr}`);
}

// ── PANEL ─────────────────────────────────────────────────────────────────────
function renderPanel() {
  const pb = document.getElementById('pbody');
  // Clear safely
  while (pb.firstChild) pb.removeChild(pb.firstChild);

  if (currentTab === 'feed') {
    if (!reports.length) {
      pb.innerHTML = '<div class="empty"><div class="empty-ico">🗺</div><div class="empty-txt">Aucun signalement pour l\'instant.<br/>Soyez le premier !</div></div>';
      return;
    }
    reports.forEach(r => {
      const c = CATS[r.category] || CATS.pothole;
      const st = STATUSES[r.status || 'active'];
      const done = confirmedIds.has(r.id);

      const card = document.createElement('div');
      card.className = 'rcard';
      card.onclick = () => flyTo(r.lat, r.lng);

      if (r.photo_url && /^https:\/\/[a-zA-Z0-9._-]+\.supabase\.(co|in)\//.test(r.photo_url)) {
        const img = document.createElement('img');
        img.className = 'rcard-photo';
        img.alt = 'Photo de la route';
        img.loading = 'lazy';
        img.src = r.photo_url;
        img.onerror = () => img.remove();
        card.appendChild(img);
      } else {
        const ph = document.createElement('div');
        ph.className = 'rcard-nophoto';
        ph.style.background = c.col + '10';
        ph.textContent = c.ico;
        card.appendChild(ph);
      }

      const body = document.createElement('div');
      body.className = 'rcard-body';

      // Top row
      const top = document.createElement('div');
      top.className = 'rcard-top';

      const badge = document.createElement('span');
      badge.className = 'cat-badge';
      badge.style.cssText = `color:${c.col};border-color:${c.col}40;background:${c.col}12`;
      badge.textContent = `${c.ico} ${c.fr}`;

      const stars = document.createElement('div');
      stars.innerHTML = starsHTML(r.score, 12); // no user data

      const votes = document.createElement('div');
      votes.className = 'votes-badge';
      votes.textContent = `✓ ${r.votes || 0}`;

      const statusDot = document.createElement('span');
      statusDot.style.cssText = `font-size:11px;color:${st.col}`;
      statusDot.title = st.fr;
      statusDot.textContent = st.dot;

      top.appendChild(badge); top.appendChild(stars);
      top.appendChild(votes); top.appendChild(statusDot);
      body.appendChild(top);

      if (r.comment) {
        const cDiv = document.createElement('div');
        cDiv.className = 'rcard-comment';
        cDiv.textContent = r.comment;           // textContent ✓
        body.appendChild(cDiv);
      }

      const footer = document.createElement('div');
      footer.className = 'rcard-footer';

      const meta = document.createElement('div');
      meta.className = 'rcard-meta';
      meta.textContent = `📍 ${r.wilaya || 'Algérie'} · ${timeAgo(r.created_at || r.ts)}`;

      const confBtn = document.createElement('button');
      confBtn.type = 'button';
      confBtn.className = 'confirm-btn' + (done ? ' done' : '');
      confBtn.textContent = done ? '✓ Confirmé' : '+ Confirmer';
      confBtn.onclick = e => { e.stopPropagation(); cardUpvote(r.id, confBtn); };

      footer.appendChild(meta); footer.appendChild(confBtn);
      body.appendChild(footer);
      card.appendChild(body);
      pb.appendChild(card);
    });

  } else if (currentTab === 'stats') {
    const n = reports.length;
    const avg = n ? (reports.reduce((a,r) => a+r.score, 0) / n).toFixed(1) : 0;
    const bad = reports.filter(r => r.score <= 2).length;
    const good = reports.filter(r => r.score >= 4).length;
    const totalVotes = reports.reduce((a,r) => a + (r.votes||0), 0);

    pb.innerHTML = `
      <div class="sgrid">
        <div class="scard"><div class="sval">${n}</div><div class="slbl">Signalements</div></div>
        <div class="scard"><div class="sval" style="color:${starCol(Math.round(parseFloat(avg)||3))}">${avg||'—'}</div><div class="slbl">Moy. ★ / 5</div></div>
        <div class="scard"><div class="sval" style="color:#EF4444">${bad}</div><div class="slbl">Critiques (1–2★)</div></div>
        <div class="scard"><div class="sval" style="color:#22C55E">${good}</div><div class="slbl">Bons (4–5★)</div></div>
      </div>
      <div class="scard" style="margin-bottom:14px"><div class="sval">${totalVotes}</div><div class="slbl">Confirmations citoyennes</div></div>
      <div class="sec-head">Par catégorie</div>
      ${Object.keys(CATS).map(k => {
        const c = CATS[k], cnt = reports.filter(r => r.category===k).length;
        return `<div class="catrow">
          <div class="catrow-label">${c.ico} ${esc(c.fr)}</div>
          <div class="bar-bg"><div class="bar-fill" style="width:${n?cnt/n*100:0}%;background:${c.col}"></div></div>
          <div class="bar-n">${cnt}</div>
        </div>`;
      }).join('')}
      <div class="sec-head" style="margin-top:18px">Par statut</div>
      ${Object.keys(STATUSES).map(k => {
        const s = STATUSES[k], cnt = reports.filter(r => (r.status||'active')===k).length;
        return `<div class="catrow">
          <div class="catrow-label">${s.dot} ${esc(s.fr)}</div>
          <div class="bar-bg"><div class="bar-fill" style="width:${n?cnt/n*100:0}%;background:${s.col}"></div></div>
          <div class="bar-n">${cnt}</div>
        </div>`;
      }).join('')}
    `;

  } else {
    pb.innerHTML = `
      <div class="sec-head">Couches de la carte</div>
      <div class="tog-row">
        <div class="tog-info"><div class="tl">Carte de chaleur</div><div class="td">Gradient de qualité des routes</div></div>
        <label class="tog"><input type="checkbox" ${showHeat?'checked':''} onchange="setLayer('heat',this.checked)"/><span class="tog-s"></span></label>
      </div>
      <div class="tog-row">
        <div class="tog-info"><div class="tl">Marqueurs</div><div class="td">Afficher les pins individuels</div></div>
        <label class="tog"><input type="checkbox" ${showMarkers?'checked':''} onchange="setLayer('markers',this.checked)"/><span class="tog-s"></span></label>
      </div>
      <div class="sec-head" style="margin-top:20px">Échelle de notation</div>
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        ${[1,2,3,4,5].map(s=>`<div style="text-align:center">
          <div>${starsHTML(s,10)}</div>
          <div style="color:${starCol(s)};font-size:9px;margin-top:3px">${STAR_LABELS[s].fr}</div>
        </div>`).join('')}
      </div>
      <div class="legend-grad"></div>
      <div class="legend-labs"><span>Critique</span><span>Moyen</span><span>Parfait</span></div>
      <div class="oss-box">
        <div class="oss-title">Open Source · مفتوح المصدر</div>
        <div class="oss-txt">Leaflet.js + OpenStreetMap + Supabase.<br/>Exportable en GeoJSON pour QGIS et ArcGIS.</div>
        <button class="export-btn" onclick="exportGeoJSON()">↓ Exporter GeoJSON</button>
      </div>
    `;
  }
}

function cardUpvote(id, btn) { upvote(id, btn); }
function setTab(name, el) {
  currentTab = name;
  document.querySelectorAll('.ptab').forEach(t => { t.classList.remove('on'); t.setAttribute('aria-selected','false'); });
  el.classList.add('on'); el.setAttribute('aria-selected','true');
  renderPanel();
}
function togglePanel() { document.getElementById('panel').classList.toggle('open'); }
function flyTo(lat, lng) { map.flyTo([lat,lng], 15, {duration:1.3}); document.getElementById('panel').classList.remove('open'); }
function setLayer(t, v) { if (t==='heat') showHeat=v; else showMarkers=v; renderMap(); }

// ── ADD MODE & GPS ────────────────────────────────────────────────────────────
function toggleAdd() {
  addMode = !addMode;
  const fab = document.getElementById('fab'), hint = document.getElementById('fab-hint');
  if (addMode) {
    fab.classList.add('active'); fab.textContent = '✕';
    hint.classList.add('show');
    showToast('Tapez sur la carte pour placer le signalement');
  } else {
    fab.classList.remove('active'); fab.textContent = '＋';
    hint.classList.remove('show');
    clearPending();
  }
}

function clearPending() {
  if (pendingMarker) { map.removeLayer(pendingMarker); pendingMarker = null; }
  pendingLat = pendingLng = null;
}

map.on('click', e => {
  if (!addMode) { document.getElementById('panel').classList.remove('open'); return; }
  setLocation(e.latlng.lat, e.latlng.lng);
  openModal();
});

function setLocation(lat, lng) {
  pendingLat = lat; pendingLng = lng;
  if (pendingMarker) map.removeLayer(pendingMarker);
  pendingMarker = L.circleMarker([lat, lng], {
    radius:14, color:'#FF5722', fillColor:'#FF5722', fillOpacity:.3, weight:2.5,
  }).addTo(map);
  document.getElementById('loc-wilaya').textContent = nearestWilaya(lat, lng);
  document.getElementById('loc-coords').textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  document.getElementById('loc-dot').classList.add('on');
  checkSubmit();
}

function locateBtnClick() {
  const btn = document.getElementById('btn-locate');
  if (!navigator.geolocation) {
    showToast('GPS non disponible sur cet appareil');
    return;
  }
  btn.classList.add('locating');
  btn.textContent = '⏳';
  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat = pos.coords.latitude, lng = pos.coords.longitude;
      btn.classList.remove('locating');
      btn.textContent = '📍';
      // Fly to position, enable add mode, pre-fill location, open modal
      map.flyTo([lat, lng], 16, {duration:1.2});
      if (!addMode) {
        addMode = true;
        const fab = document.getElementById('fab');
        fab.classList.add('active'); fab.textContent = '✕';
        document.getElementById('fab-hint').classList.add('show');
      }
      setLocation(lat, lng);
      openModal();
    },
    err => {
      btn.classList.remove('locating');
      btn.textContent = '📍';
      const msgs = { 1:'Permission GPS refusée', 2:'Position GPS introuvable', 3:'Délai GPS dépassé' };
      showToast(msgs[err.code] || 'Erreur GPS');
    },
    { enableHighAccuracy:true, timeout:10000, maximumAge:30000 }
  );
}

function useMyLocation() {
  if (!navigator.geolocation) { showToast('GPS non disponible'); return; }
  const btn = document.getElementById('gps-btn');
  btn.textContent = '📡 Localisation…';
  navigator.geolocation.getCurrentPosition(
    pos => {
      setLocation(pos.coords.latitude, pos.coords.longitude);
      map.flyTo([pos.coords.latitude, pos.coords.longitude], 15, {duration:1});
      btn.textContent = '✅ Position trouvée';
      setTimeout(() => { btn.textContent = '📍 Ma position'; }, 2500);
    },
    err => {
      btn.textContent = '📍 Ma position';
      const msgs = { 1:'Permission GPS refusée', 2:'Position introuvable', 3:'Délai dépassé' };
      showToast(msgs[err.code] || 'Erreur GPS');
    },
    { enableHighAccuracy:true, timeout:10000, maximumAge:60000 }
  );
}

function autoGPS() {
  if (localStorage.getItem('hf_gps_asked')) return;
  localStorage.setItem('hf_gps_asked', '1');
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => map.flyTo([pos.coords.latitude, pos.coords.longitude], 12, {duration:2}),
      () => {},
      { enableHighAccuracy:false, timeout:8000 }
    );
  }
}

// ── MODAL ─────────────────────────────────────────────────────────────────────
function openModal() {
  document.getElementById('overlay').classList.add('open');
  checkSubmit();
}

function closeModal() {
  document.getElementById('overlay').classList.remove('open');
  selCategory = null; selStars = 0; photoFile = null;
  document.querySelectorAll('.cat-btn').forEach(b => {
    b.classList.remove('sel');
    b.style.borderColor = ''; b.style.background = '';
    b.setAttribute('aria-pressed','false');
  });
  document.querySelectorAll('.star-btn').forEach(b => b.classList.remove('on'));
  const sl = document.getElementById('star-label');
  sl.textContent = 'Sélectionnez une note';
  sl.classList.remove('filled');
  document.getElementById('comment').value = '';
  document.getElementById('char-count').textContent = '0 / 300';
  document.getElementById('char-count').className = 'char-count';
  removePhoto({ stopPropagation:()=>{} });
  document.getElementById('loc-dot').classList.remove('on');
  clearPending();
  addMode = false;
  document.getElementById('fab').classList.remove('active');
  document.getElementById('fab').textContent = '＋';
  document.getElementById('fab-hint').classList.remove('show');
  document.getElementById('submit-btn').disabled = true;
  document.getElementById('submit-btn').setAttribute('aria-disabled','true');
  document.getElementById('submit-spin').style.display = 'none';
  document.getElementById('submit-txt').textContent = 'Soumettre le signalement';
}

function selCat(cat, btn) {
  if (!VALID_CATS.has(cat)) return; // reject unknown categories
  selCategory = cat;
  const c = CATS[cat];
  document.querySelectorAll('.cat-btn').forEach(b => {
    b.classList.remove('sel');
    b.style.borderColor = ''; b.style.background = '';
    b.setAttribute('aria-pressed','false');
  });
  btn.classList.add('sel');
  btn.style.borderColor = c.col; btn.style.background = c.col + '18';
  btn.setAttribute('aria-pressed','true');
  checkSubmit();
}

function setStar(v) {
  if (v < 1 || v > 5) return;
  selStars = v;
  document.querySelectorAll('.star-btn').forEach((b, i) => b.classList.toggle('on', i < v));
  const sl = document.getElementById('star-label');
  sl.textContent = `${STAR_LABELS[v].fr} — ${STAR_LABELS[v].ar}`;
  sl.classList.add('filled');
  checkSubmit();
}

function checkSubmit() {
  const ok = !!(selCategory && selStars && pendingLat !== null);
  document.getElementById('submit-btn').disabled = !ok;
  document.getElementById('submit-btn').setAttribute('aria-disabled', ok ? 'false' : 'true');
}

function updateCharCount(el) {
  const len = el.value.length;
  const cc = document.getElementById('char-count');
  cc.textContent = `${len} / 300`;
  cc.className = 'char-count' + (len > 280 ? ' over' : len > 240 ? ' warn' : '');
}

// ── PHOTO HANDLING ─────────────────────────────────────────────────────────── 
function onPhoto(input) {
  const f = input.files[0];
  if (!f) return;

  // Validate MIME type
  if (!ALLOWED_MIME.has(f.type)) {
    showToast('Format non supporté — utilisez JPG, PNG ou WebP');
    input.value = '';
    return;
  }
  // Validate size
  if (f.size > MAX_FILE_BYTES) {
    showToast(`Image trop grande — max ${MAX_FILE_MB} Mo`);
    input.value = '';
    return;
  }

  photoFile = f;
  const reader = new FileReader();
  reader.onload = e => {
    const prev = document.getElementById('photo-prev');
    prev.src = e.target.result;
    prev.style.display = 'block';
    document.getElementById('photo-inner').style.display = 'none';
    document.getElementById('photo-rm').style.display = 'flex';
    document.getElementById('photo-zone').style.border = '2px solid var(--acc)';
  };
  reader.readAsDataURL(f);
}

function removePhoto(e) {
  e.stopPropagation();
  photoFile = null;
  const prev = document.getElementById('photo-prev');
  prev.src = ''; prev.style.display = 'none';
  document.getElementById('photo-inner').style.display = 'flex';
  document.getElementById('photo-rm').style.display = 'none';
  document.getElementById('photo-zone').style.border = '2px dashed var(--bdr2)';
  document.getElementById('photo-input').value = '';
  document.getElementById('upload-progress').style.width = '0%';
}

// ── SUBMIT ────────────────────────────────────────────────────────────────────
async function submitReport() {
  // Client-side gate checks
  if (!selCategory || !selStars || pendingLat === null) return;
  if (!VALID_CATS.has(selCategory)) { showToast('Catégorie invalide'); return; }
  if (selStars < 1 || selStars > 5) { showToast('Note invalide'); return; }
  if (!validAlgeriaCoords(pendingLat, pendingLng)) {
    showToast('Position hors du territoire algérien');
    return;
  }
  if (!RateLimiter.check()) {
    showToast('Trop de signalements — réessayez dans 10 minutes');
    return;
  }

  const btn = document.getElementById('submit-btn');
  const spin = document.getElementById('submit-spin');
  const txtEl = document.getElementById('submit-txt');
  btn.disabled = true;
  spin.style.display = 'block';
  txtEl.textContent = 'Envoi en cours…';

  let photo_url = null;
  if (photoFile && db) {
    try {
      const prog = document.getElementById('upload-progress');
      const ext = (photoFile.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z]/g,'');
      const safe_ext = ['jpg','jpeg','png','webp'].includes(ext) ? ext : 'jpg';
      const fname = `${Date.now()}_${crypto.randomUUID()}.${safe_ext}`;
      prog.style.width = '40%';
      const { error: upErr } = await db.storage
        .from('road-photos')
        .upload(fname, photoFile, { contentType: photoFile.type, upsert:false });
      prog.style.width = '80%';
      if (!upErr) {
        const { data:{ publicUrl } } = db.storage.from('road-photos').getPublicUrl(fname);
        // Only accept URLs from our own Supabase project
        if (/^https:\/\/[a-zA-Z0-9._-]+\.supabase\.(co|in)\//.test(publicUrl)) {
          photo_url = publicUrl;
        }
      }
      prog.style.width = '100%';
    } catch (e) { console.warn('[hafra] Upload failed:', e); }
  }

  const rawComment = document.getElementById('comment').value;
  const payload = {
    lat:       parseFloat(pendingLat.toFixed(6)),
    lng:       parseFloat(pendingLng.toFixed(6)),
    score:     selStars,
    category:  selCategory,
    comment:   sanitiseComment(rawComment),
    photo_url,
    wilaya:    nearestWilaya(pendingLat, pendingLng),
    votes:     0,
    status:    'active',
  };

  if (db) {
    try {
      const { data, error } = await db.from('reports').insert(payload).select().single();
      if (error) throw error;
      RateLimiter.record(); // only count successful submissions
      reports.unshift(data);
      closeModal(); renderMap(); updateStats(); renderPanel();
      map.flyTo([data.lat, data.lng], 15, {duration:1});
      const c = CATS[data.category] || CATS.pothole;
      showToast(`Signalement envoyé — ${c.ico} ${data.wilaya}`);
    } catch (e) {
      console.error('[hafra] Submit error:', e);
      showToast('Erreur — Réessayez');
      btn.disabled = false;
      btn.setAttribute('aria-disabled', 'false');
      spin.style.display = 'none';
      txtEl.textContent = 'Soumettre le signalement';
    }
  } else {
    RateLimiter.record(); // demo mode still rate-limited
    const demo = { ...payload, id:'d'+Date.now(), created_at:new Date().toISOString() };
    reports.unshift(demo);
    closeModal(); renderMap(); updateStats(); renderPanel();
    map.flyTo([demo.lat, demo.lng], 15, {duration:1});
    const c = CATS[demo.category] || CATS.pothole;
    showToast(`Signalement (démo) — ${c.ico} ${demo.wilaya}`);
  }
}

// ── EXPORT ────────────────────────────────────────────────────────────────────
function exportGeoJSON() {
  const geo = {
    type:'FeatureCollection', name:'hafra-dz',
    generated: new Date().toISOString(),
    features: reports.map(r => ({
      type:'Feature',
      geometry:{ type:'Point', coordinates:[r.lng, r.lat] },
      properties:{
        id:r.id, score:r.score,
        category:r.category, category_fr:(CATS[r.category]||CATS.pothole).fr,
        wilaya:r.wilaya, comment:r.comment,
        votes:r.votes||0, status:r.status||'active',
        photo_url:r.photo_url||null, timestamp:r.created_at||null,
      },
    })),
  };
  const blob = new Blob([JSON.stringify(geo, null, 2)], {type:'application/json'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `hafra-dz-${new Date().toISOString().slice(0,10)}.geojson`;
  a.style.display = 'none';
  // Must be in the DOM for Safari to trigger the download
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  showToast('GeoJSON exporté');
}

// ── DEMO DATA ─────────────────────────────────────────────────────────────────
function getDemoData() {
  const now = Date.now();
  return [
    {id:'d1',lat:36.737,lng:3.086,score:1,category:'pothole',comment:'Route nationale très dégradée après les pluies',created_at:new Date(now-7200000).toISOString(),wilaya:'Alger',votes:47,status:'active',photo_url:null},
    {id:'d2',lat:36.365,lng:6.614,score:4,category:'cracks',comment:'Quelques fissures mineures mais praticable',created_at:new Date(now-86400000).toISOString(),wilaya:'Constantine',votes:12,status:'active',photo_url:null},
    {id:'d3',lat:35.697,lng:-0.627,score:2,category:'pothole',comment:'Nids-de-poule dangereux sur 200m',created_at:new Date(now-18000000).toISOString(),wilaya:'Oran',votes:33,status:'reported',photo_url:null},
    {id:'d4',lat:36.190,lng:5.412,score:1,category:'flooding',comment:'Zone inondée à chaque pluie, chaussée effondrée',created_at:new Date(now-172800000).toISOString(),wilaya:'Sétif',votes:28,status:'active',photo_url:null},
    {id:'d5',lat:36.470,lng:2.813,score:3,category:'signage',comment:'Panneaux de signalisation manquants sur l\'échangeur',created_at:new Date(now-259200000).toISOString(),wilaya:'Blida',votes:9,status:'active',photo_url:null},
    {id:'d6',lat:35.370,lng:1.322,score:1,category:'utility',comment:'Fuite ADE depuis 3 mois, route complètement détruite',created_at:new Date(now-28800000).toISOString(),wilaya:'Tiaret',votes:56,status:'reported',photo_url:null},
    {id:'d7',lat:36.901,lng:7.757,score:5,category:'cracks',comment:'Route parfaitement entretenue',created_at:new Date(now-432000000).toISOString(),wilaya:'Annaba',votes:5,status:'fixed',photo_url:null},
    {id:'d8',lat:36.753,lng:4.053,score:2,category:'lighting',comment:'Aucun éclairage public sur 2km, très dangereux la nuit',created_at:new Date(now-129600000).toISOString(),wilaya:'Tizi Ouzou',votes:21,status:'active',photo_url:null},
    {id:'d9',lat:34.850,lng:5.728,score:1,category:'pothole',comment:'Impraticable après les inondations de novembre',created_at:new Date(now-10800000).toISOString(),wilaya:'Biskra',votes:39,status:'active',photo_url:null},
    {id:'d10',lat:36.588,lng:2.447,score:2,category:'utility',comment:'SEAAL a cassé la route il y a 6 mois, jamais réparée',created_at:new Date(now-518400000).toISOString(),wilaya:'Tipaza',votes:44,status:'reported',photo_url:null},
    {id:'d11',lat:36.762,lng:3.477,score:2,category:'flooding',comment:'Sous-terrain inondé à chaque pluie',created_at:new Date(now-43200000).toISOString(),wilaya:'Boumerdès',votes:29,status:'active',photo_url:null},
    {id:'d12',lat:36.264,lng:2.749,score:3,category:'cracks',comment:'Fissures longitudinales, réparation urgente',created_at:new Date(now-345600000).toISOString(),wilaya:'Médéa',votes:14,status:'active',photo_url:null},
  ];
}

// ── SERVICE WORKER ────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .catch(e => console.warn('[hafra] SW registration failed:', e));
  });
}

// ── INIT ──────────────────────────────────────────────────────────────────────
loadReports();
setTimeout(autoGPS, 1500);
