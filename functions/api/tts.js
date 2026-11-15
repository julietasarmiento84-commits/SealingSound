/**
 * Sealing Sounds – Google Cloud Text-to-Speech proxy (Cloudflare Pages Function).
 *
 * Route: /api/tts
 *   GET  /api/tts?voices=es,en  -> { configured, voices:[{name,lang,gender}] }   (configured:false when no credentials)
 *   POST /api/tts {text,voice,lang,rate} -> audio/mpeg
 *
 * Credentials live ONLY in Cloudflare secrets (never in the HTML/JS sent to the browser):
 *   GOOGLE_SERVICE_ACCOUNT_JSON  (secret)  full JSON key of a service account with role "Cloud Text-to-Speech User"
 *   ALLOWED_ORIGINS              (optional) comma-separated origins allowed to call this endpoint, e.g. https://sealingsound.pages.dev
 */
const ALLOWED_LANGS = ['es-AR', 'es-US', 'es-MX', 'es-ES', 'en-US', 'en-GB'];
const MAX_CHARS = 600;
const JSON_H = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));

let tokenCache = { token: null, exp: 0 };
async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.token && tokenCache.exp - 60 > now) return tokenCache.token;
  const head = enc({ alg: 'RS256', typ: 'JWT' });
  const claim = enc({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(head + '.' + claim));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + head + '.' + claim + '.' + b64url(sig) });
  if (!r.ok) throw new Error('oauth ' + r.status);
  const j = await r.json(); tokenCache = { token: j.access_token, exp: now + (j.expires_in || 3600) }; return tokenCache.token;
}
function credentials(env) { try { const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON || ''); return sa && sa.client_email && sa.private_key ? sa : null; } catch (e) { return null; } }
function originOk(req, env) {
  const list = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const o = req.headers.get('origin'); const self = new URL(req.url).origin;
  return !o || o === self || list.includes(o);
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: JSON_H });
const rank = (n) => (/chirp3|chirp-hd/i.test(n) ? 0 : /neural2/i.test(n) ? 1 : /wavenet/i.test(n) ? 2 : /studio/i.test(n) ? 3 : 4);

export async function onRequest({ request, env, waitUntil }) {
  if (!originOk(request, env)) return json({ error: 'origin not allowed' }, 403);
  const sa = credentials(env);
  const url = new URL(request.url);
  if (request.method === 'GET') {
    if (!sa) return json({ configured: false, voices: [] });          // honest: no credentials -> not connected
    try {
      const tok = await accessToken(sa);
      const r = await fetch('https://texttospeech.googleapis.com/v1/voices', { headers: { authorization: 'Bearer ' + tok } });
      if (!r.ok) return json({ configured: false, voices: [], error: 'google ' + r.status });
      const all = (await r.json()).voices || [], want = (url.searchParams.get('voices') || 'es,en').split(',');
      const out = [];
      all.forEach((v) => (v.languageCodes || []).forEach((lc) => {
        if (ALLOWED_LANGS.includes(lc) && want.includes(lc.slice(0, 2)) && !/Journey|Casual|Polyglot/i.test(v.name) && ['FEMALE', 'MALE'].includes(v.ssmlGender)) out.push({ name: v.name, lang: lc, gender: v.ssmlGender });
      }));
      out.sort((a, b) => a.lang.localeCompare(b.lang) || rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
      const seen = new Set(), best = out.filter((v) => (seen.has(v.name) ? false : seen.add(v.name)));
      return new Response(JSON.stringify({ configured: true, voices: best.slice(0, 60) }), { headers: { ...JSON_H, 'cache-control': 'public, max-age=3600' } });
    } catch (e) { return json({ configured: false, voices: [], error: 'unavailable' }); }
  }
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!sa) return json({ error: 'not configured' }, 503);
  let b; try { b = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const text = String(b.text || '').trim();
  if (!text || text.length > MAX_CHARS) return json({ error: 'text length' }, 400);
  if (!ALLOWED_LANGS.includes(b.lang) || !/^[a-z]{2}-[A-Z]{2}-[A-Za-z0-9-]+$/.test(String(b.voice || ''))) return json({ error: 'bad voice' }, 400);
  const rate = Math.min(2, Math.max(0.5, +b.rate || 1));
  const cacheKey = new Request(url.origin + '/__tts_cache/' + encodeURIComponent([b.voice, rate, text].join('|')));
  const cache = caches.default, hit = await cache.match(cacheKey);
  if (hit) return hit;
  try {
    const tok = await accessToken(sa);
    const r = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' },
      body: JSON.stringify({ input: { text }, voice: { languageCode: b.lang, name: b.voice }, audioConfig: { audioEncoding: 'MP3', speakingRate: rate } })
    });
    if (!r.ok) return json({ error: 'google ' + r.status }, 502);
    const bin = Uint8Array.from(atob((await r.json()).audioContent), (c) => c.charCodeAt(0));
    const res = new Response(bin, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'public, max-age=86400' } });
    if (waitUntil) waitUntil(cache.put(cacheKey, res.clone())); else await cache.put(cacheKey, res.clone());
    return res;
  } catch (e) { return json({ error: 'unavailable' }, 502); }
}
