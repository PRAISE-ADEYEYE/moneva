/* Moneva service worker.
   Pages: network first, so people always get the latest version when online; the saved copy
   (or offline.html) when not. Static files and fonts: served from cache, refreshed in the background.
   Never cached: the payment Worker, Firebase Auth and Firestore (always live). */
const V='moneva-v3';
const SHELL=['/','/auth/login/','/auth/signup/','/dashboard/','/offline.html','/manifest.json',
  '/icons/icon-192.png','/icons/icon-512.png','/icons/apple-touch-icon.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>Promise.all(SHELL.map(u=>c.add(new Request(u,{cache:'reload'})).catch(()=>{})))))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('message',e=>{if(e.data==='SKIP')self.skipWaiting()});
const LIVE=/(^|\.)workers\.dev$|firestore\.googleapis\.com$|identitytoolkit\.googleapis\.com$|securetoken\.googleapis\.com$|firebaseinstallations\.googleapis\.com$|accounts\.google\.com$/;
const STATIC=u=>u.origin===location.origin||(u.hostname==='www.gstatic.com'&&u.pathname.startsWith('/firebasejs/'))||u.hostname==='fonts.googleapis.com'||u.hostname==='fonts.gstatic.com'||u.hostname==='images.unsplash.com';
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);
  if(LIVE.test(u.hostname))return;
  if(r.mode==='navigate'){
    e.respondWith(fetch(r).then(x=>{if(x.ok){const c=x.clone();caches.open(V).then(h=>h.put(u.pathname,c))}return x})
      .catch(()=>caches.match(u.pathname).then(x=>x||caches.match(r,{ignoreSearch:true})).then(x=>x||caches.match('/offline.html'))));return}
  if(!STATIC(u))return;
  e.respondWith(caches.open(V).then(h=>h.match(r).then(m=>{const n=fetch(r).then(x=>{if(x.ok||x.type==='opaque')h.put(r,x.clone());return x}).catch(()=>m);return m||n})));
});
