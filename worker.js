// MONEVA Cloudflare Worker (paste into the dashboard editor). Interledger Open Payments TEST environment.
// Plain text variables: FIREBASE_PROJECT_ID, OP_WALLET_ADDRESS, OP_KEY_ID, ALLOWED_ORIGINS, FRONTEND_URL
// Optional variables: ALLOWED_WALLET_HOSTS (default interledger-test.dev), STRICT_CALLBACK_HASH ("0" to relax)
// Secrets: OP_PRIVATE_KEY, FIREBASE_SA (full service account JSON)
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = u => { let s = ''; for (const c of u) s += String.fromCharCode(c); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const b64u = u => b64(u).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const J = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', ...h } });
class E extends Error { constructor(m, s = 400, code = 'bad_request') { super(m); this.s = s; this.code = code; } }
const ts = () => ({ __ts: new Date().toISOString() });
const clientAddr = env => { const a = (env.OP_WALLET_ADDRESS || '').trim(); return a[0] === '$' ? 'https://' + a.slice(1) : a.replace(/\/$/, ''); };

// ---------- CORS ----------
function cors(req, env) {
  const o = req.headers.get('origin') || '', ok = (env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
  const h = { 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'authorization,content-type', 'access-control-max-age': '600', vary: 'origin' };
  if (ok.includes(o)) h['access-control-allow-origin'] = o;
  return h;
}

// ---------- Firebase ID token verification ----------
let _jw = { k: null, e: 0 };
async function verify(env, req) {
  const m = /^Bearer (.+)$/.exec(req.headers.get('authorization') || '');
  if (!m) throw new E('Missing token', 401, 'unauth');
  const [h, p, s] = m[1].split('.');
  if (!s) throw new E('Bad token', 401, 'unauth');
  let H, P;
  try { H = JSON.parse(dec.decode(unb64(h))); P = JSON.parse(dec.decode(unb64(p))); } catch { throw new E('Bad token', 401, 'unauth'); }
  if (H.alg !== 'RS256') throw new E('Bad token', 401, 'unauth');
  if (_jw.e < Date.now()) {
    const r = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
    _jw = { k: (await r.json()).keys || [], e: Date.now() + 3600000 };
  }
  const jwk = _jw.k.find(k => k.kid === H.kid);
  if (!jwk) throw new E('Bad token', 401, 'unauth');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64(s), enc.encode(h + '.' + p));
  const now = Date.now() / 1000, pid = env.FIREBASE_PROJECT_ID;
  if (!ok || P.aud !== pid || P.iss !== 'https://securetoken.google.com/' + pid || P.exp < now || P.iat > now + 60 || !P.sub) throw new E('Invalid token', 401, 'unauth');
  return P.sub;
}

// ---------- Firestore REST (service account, bypasses client rules) ----------
let _t = { v: null, e: 0 };
async function gtoken(env) {
  if (_t.e > Date.now() + 60000) return _t.v;
  let sa; try { sa = JSON.parse(env.FIREBASE_SA); } catch { throw new E('Firestore not configured', 500, 'config'); }
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const c = b64u(enc.encode(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })));
  const k = await crypto.subtle.importKey('pkcs8', unb64(sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const s = b64u(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', k, enc.encode(h + '.' + c))));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + h + '.' + c + '.' + s });
  const j = await r.json();
  if (!j.access_token) throw new E('Firestore auth failed', 500, 'config');
  _t = { v: j.access_token, e: Date.now() + (j.expires_in || 3600) * 1000 };
  return _t.v;
}
const tv = v => v === null || v === undefined ? { nullValue: null } : v.__ts ? { timestampValue: v.__ts } : typeof v === 'string' ? { stringValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : typeof v === 'boolean' ? { booleanValue: v } : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, tv(x)])) } };
const fv = v => 'stringValue' in v ? v.stringValue : 'integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? v.doubleValue : 'booleanValue' in v ? v.booleanValue : 'timestampValue' in v ? v.timestampValue : 'mapValue' in v ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, fv(x)])) : null;
const fsBase = env => `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/`;
async function fsGet(env, path) {
  const r = await fetch(fsBase(env) + path, { headers: { authorization: 'Bearer ' + await gtoken(env) } });
  if (r.status === 404) return null;
  if (!r.ok) throw new E('Database error', 502, 'db_error');
  const d = await r.json();
  return Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, fv(v)]));
}
async function fsSet(env, path, data) {
  const q = Object.keys(data).map(k => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  const r = await fetch(fsBase(env) + path + '?' + q, { method: 'PATCH', headers: { authorization: 'Bearer ' + await gtoken(env), 'content-type': 'application/json' }, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, tv(v)])) }) });
  if (!r.ok) throw new E('Database error', 502, 'db_error');
}

// ---------- Open Payments: Ed25519 HTTP message signatures + GNAP ----------
let _k;
async function opKey(env) {
  if (_k) return _k;
  const raw = (env.OP_PRIVATE_KEY || '').trim().replace(/\\n/g, '\n');
  if (!raw) throw new E('Signing key not configured', 500, 'config');
  const strip = s => s.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  let der;
  if (raw.includes('BEGIN')) der = unb64(strip(raw));
  else { const bytes = unb64(raw.replace(/\s+/g, '')), txt = dec.decode(bytes); der = txt.includes('BEGIN') ? unb64(strip(txt)) : bytes; }
  if (der.length === 32) der = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20, ...der]);
  _k = await crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, false, ['sign']);
  return _k;
}
async function opFetch(env, method, url, { token, body } = {}) {
  const h = { accept: 'application/json' }, L = { '@method': method, '@target-uri': url };
  let payload;
  if (token) { h.authorization = 'GNAP ' + token; L.authorization = h.authorization; }
  if (body !== undefined) {
    payload = JSON.stringify(body);
    const bytes = enc.encode(payload), dig = 'sha-512=:' + b64(new Uint8Array(await crypto.subtle.digest('SHA-512', bytes))) + ':';
    h['content-type'] = 'application/json'; h['content-digest'] = dig; h['content-length'] = String(bytes.length);
    L['content-digest'] = dig; L['content-length'] = h['content-length']; L['content-type'] = 'application/json';
  }
  const order = ['@method', '@target-uri', 'authorization', 'content-digest', 'content-length', 'content-type'].filter(c => c in L);
  const params = '(' + order.map(c => '"' + c + '"').join(' ') + ');created=' + Math.floor(Date.now() / 1000) + ';keyid="' + env.OP_KEY_ID + '";alg="ed25519"';
  const base = order.map(c => '"' + c + '": ' + L[c]).join('\n') + '\n"@signature-params": ' + params;
  const sig = await crypto.subtle.sign('Ed25519', await opKey(env), enc.encode(base));
  h['signature-input'] = 'sig1=' + params; h.signature = 'sig1=:' + b64(new Uint8Array(sig)) + ':';
  const r = await fetch(url, { method, headers: h, body: payload });
  const txt = await r.text();
  if (!r.ok) { console.log('OP error', method, url, r.status, txt.slice(0, 400)); throw new E('Open Payments error ' + r.status, 502, 'op_error'); }
  try { return JSON.parse(txt); } catch { return null; }
}
async function wallet(env, a) {
  let s = String(a || '').trim(); if (s[0] === '$') s = 'https://' + s.slice(1);
  let u; try { u = new URL(s); } catch { throw new E('Bad wallet address', 400, 'bad_wallet'); }
  const hosts = (env.ALLOWED_WALLET_HOSTS || 'interledger-test.dev').split(',').map(x => x.trim());
  if (u.protocol !== 'https:' || !hosts.some(x => u.hostname === x || u.hostname.endsWith('.' + x))) throw new E('Only test environment wallets are allowed', 400, 'bad_wallet');
  u.search = ''; u.hash = '';
  const r = await fetch(u.href.replace(/\/$/, ''), { headers: { accept: 'application/json' } });
  const w = r.ok ? await r.json().catch(() => null) : null;
  if (!w || !w.id || !w.authServer || !w.resourceServer || !w.assetCode) throw new E('Not an Open Payments wallet', 400, 'bad_wallet');
  return w;
}
const grant = (env, w, access, interact) => opFetch(env, 'POST', w.authServer, { body: { access_token: { access: [access] }, client: clientAddr(env), ...(interact ? { interact } : {}) } });
function minor(a, sc) {
  const s = String(a).trim();
  if (!/^\d{1,9}(\.\d{1,9})?$/.test(s)) throw new E('Bad amount', 400, 'bad_amount');
  const v = Math.round(parseFloat(s) * 10 ** sc);
  if (!(v > 0)) throw new E('Bad amount', 400, 'bad_amount');
  return String(v);
}
const pub = w => ({ address: w.id, name: w.publicName || '', assetCode: w.assetCode, assetScale: w.assetScale });
const mapOut = o => o.failed ? 'failed' : (o.sentAmount && o.debitAmount && BigInt(o.sentAmount.value) >= BigInt(o.debitAmount.value) ? 'completed' : 'pending');
const mapIn = i => (i.completed || (i.receivedAmount && i.incomingAmount && BigInt(i.receivedAmount.value) >= BigInt(i.incomingAmount.value))) ? 'completed' : (i.expiresAt && Date.parse(i.expiresAt) < Date.now() ? 'failed' : 'pending');
const major = a => Number(a.value) / 10 ** a.assetScale;

// ---------- Flows ----------
async function myWallet(env, uid) {
  const me = await fsGet(env, 'users/' + uid);
  if (!me || !me.walletAddress) throw new E('No wallet connected', 400, 'no_wallet');
  return wallet(env, me.walletAddress);
}
async function sendQuote(env, uid, b) {
  const S = await myWallet(env, uid), R = await wallet(env, b.receiver);
  if (S.id === R.id) throw new E('Cannot pay your own wallet', 400, 'bad_wallet');
  const value = minor(b.amount, R.assetScale);
  const ig = await grant(env, R, { type: 'incoming-payment', actions: ['create', 'read'] });
  const ip = await opFetch(env, 'POST', R.resourceServer + '/incoming-payments', { token: ig.access_token.value, body: { walletAddress: R.id, incomingAmount: { value, assetCode: R.assetCode, assetScale: R.assetScale }, expiresAt: new Date(Date.now() + 20 * 60000).toISOString(), metadata: { description: 'Moneva payment' } } });
  const qg = await grant(env, S, { type: 'quote', actions: ['create', 'read'] });
  const q = await opFetch(env, 'POST', S.resourceServer + '/quotes', { token: qg.access_token.value, body: { walletAddress: S.id, receiver: ip.id, method: 'ilp' } });
  const pid = crypto.randomUUID();
  await fsSet(env, 'payments/' + pid, { uid, type: 'out', status: 'quoted', sender: S.id, senderAuth: S.authServer, senderRs: S.resourceServer, receiver: R.id, quoteId: q.id, quoteExpires: q.expiresAt || '', debit: q.debitAmount, receive: q.receiveAmount, createdAt: ts() });
  return { paymentId: pid, receiver: { name: R.publicName || '', address: R.id }, debitAmount: q.debitAmount, receiveAmount: q.receiveAmount };
}
async function sendConfirm(env, uid, b, u) {
  const pid = String(b.paymentId || ''), p = await fsGet(env, 'payments/' + pid);
  if (!p || p.uid !== uid || p.type !== 'out') throw new E('Not found', 404, 'not_found');
  if (p.status !== 'quoted') throw new E('Payment already processed', 409, 'bad_state');
  if (p.quoteExpires && Date.parse(p.quoteExpires) < Date.now()) throw new E('Quote expired', 410, 'expired');
  const nonce = b64u(crypto.getRandomValues(new Uint8Array(16)));
  const g = await grant(env, { authServer: p.senderAuth }, { type: 'outgoing-payment', actions: ['read', 'create'], identifier: p.sender, limits: { debitAmount: p.debit, receiveAmount: p.receive } },
    { start: ['redirect'], finish: { method: 'redirect', uri: u.origin + '/api/op/callback/' + pid, nonce } });
  if (!g || !g.interact || !g.continue) throw new E('Wallet did not start an approval', 502, 'op_error');
  await fsSet(env, 'payments/' + pid, { status: 'awaiting', nonce, interactNonce: g.interact.finish || '', continueUri: g.continue.uri, continueToken: g.continue.access_token.value });
  await fsSet(env, `users/${uid}/transactions/${pid}`, { type: 'out', amount: major(p.debit), currency: p.debit.assetCode, counterparty: p.receiver, status: 'awaiting', createdAt: ts() });
  return { redirect: g.interact.redirect };
}
async function hashOk(p, ref, hash) {
  const a = p.senderAuth.replace(/\/$/, '');
  for (const g of [a, a + '/', a + '/grant']) {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(p.nonce + '\n' + p.interactNonce + '\n' + ref + '\n' + g)));
    if (hash === b64(d) || hash === b64u(d)) return true;
  }
  return false;
}
async function callback(env, u, pid) {
  const back = q => Response.redirect((env.FRONTEND_URL || '').replace(/\/$/, '') + '/dashboard/?pay=' + encodeURIComponent(pid) + q + '#hist', 302);
  let p; try { p = await fsGet(env, 'payments/' + pid); } catch { return back('&err=1'); }
  if (!p || p.status !== 'awaiting') return back('&err=1');
  const uid = p.uid, tx = s => fsSet(env, `users/${uid}/transactions/${pid}`, { status: s, updatedAt: ts() });
  const ref = u.searchParams.get('interact_ref');
  try {
    if (!ref) { await fsSet(env, 'payments/' + pid, { status: 'cancelled' }); await tx('cancelled'); return back('&cancelled=1'); }
    if (env.STRICT_CALLBACK_HASH !== '0' && !(await hashOk(p, ref, u.searchParams.get('hash') || ''))) throw new E('Bad callback hash', 400, 'bad_hash');
    await fsSet(env, 'payments/' + pid, { status: 'finalizing' });
    const g = await opFetch(env, 'POST', p.continueUri, { token: p.continueToken, body: { interact_ref: ref } });
    const tok = g.access_token.value;
    const op = await opFetch(env, 'POST', p.senderRs + '/outgoing-payments', { token: tok, body: { walletAddress: p.sender, quoteId: p.quoteId, metadata: { description: 'Moneva payment' } } });
    await fsSet(env, 'payments/' + pid, { status: 'sent', opUrl: op.id, opToken: tok });
    await tx('pending');
    return back('');
  } catch (e) {
    console.log('callback failed', e.message);
    try { await fsSet(env, 'payments/' + pid, { status: 'failed' }); await tx('failed'); } catch {}
    return back('&err=1');
  }
}
async function receive(env, uid, b) {
  const W = await myWallet(env, uid), value = minor(b.amount, W.assetScale);
  const g = await grant(env, W, { type: 'incoming-payment', actions: ['create', 'read'] });
  const ip = await opFetch(env, 'POST', W.resourceServer + '/incoming-payments', { token: g.access_token.value, body: { walletAddress: W.id, incomingAmount: { value, assetCode: W.assetCode, assetScale: W.assetScale }, expiresAt: new Date(Date.now() + 24 * 3600000).toISOString(), metadata: { description: 'Moneva payment request' } } });
  const pid = crypto.randomUUID();
  await fsSet(env, 'payments/' + pid, { uid, type: 'in', status: 'open', ipUrl: ip.id, ipToken: g.access_token.value, createdAt: ts() });
  await fsSet(env, `users/${uid}/transactions/${pid}`, { type: 'in', amount: Number(value) / 10 ** W.assetScale, currency: W.assetCode, counterparty: '', status: 'pending', createdAt: ts() });
  return { paymentId: pid, url: ip.id };
}
async function status(env, uid, pid) {
  const p = await fsGet(env, 'payments/' + pid);
  if (!p || p.uid !== uid) throw new E('Not found', 404, 'not_found');
  if (p.status === 'sent' || p.status === 'open') {
    const s = p.type === 'out' ? mapOut(await opFetch(env, 'GET', p.opUrl, { token: p.opToken })) : mapIn(await opFetch(env, 'GET', p.ipUrl, { token: p.ipToken }));
    if (s !== 'pending') { await fsSet(env, 'payments/' + pid, { status: s }); await fsSet(env, `users/${uid}/transactions/${pid}`, { status: s, updatedAt: ts() }); }
    return { status: s };
  }
  return { status: { finalizing: 'pending', quoted: 'awaiting' }[p.status] || p.status };
}

// ---------- Router ----------
async function route(req, env, u) {
  const p = u.pathname, m = req.method;
  if (p === '/health') return { ok: true, service: 'moneva-worker' };
  if (m === 'GET' && p.startsWith('/api/op/callback/')) return callback(env, u, p.split('/').pop());
  const uid = await verify(env, req);
  const body = m === 'POST' ? await req.json().catch(() => ({})) : {};
  if (m === 'GET' && p === '/api/wallet') return pub(await wallet(env, u.searchParams.get('address')));
  if (m === 'POST' && p === '/api/send/quote') return sendQuote(env, uid, body);
  if (m === 'POST' && p === '/api/send/confirm') return sendConfirm(env, uid, body, u);
  if (m === 'POST' && p === '/api/receive') return receive(env, uid, body);
  const x = m === 'GET' && /^\/api\/payments\/([\w-]+)$/.exec(p);
  if (x) return status(env, uid, x[1]);
  throw new E('Not found', 404, 'not_found');
}
export default {
  async fetch(req, env) {
    const C = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: C });
    try {
      const r = await route(req, env, new URL(req.url));
      return r instanceof Response ? r : J(r, 200, C);
    } catch (e) {
      if (e instanceof E) return J({ error: e.code, message: e.message }, e.s, C);
      console.log('unhandled', e && e.message);
      return J({ error: 'server', message: 'Server error' }, 500, C);
    }
  }
};
