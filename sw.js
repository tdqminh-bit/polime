const CACHE='polime-v4-2-premium-icons';
const ASSETS=['./','./index.html','./styles.css','./app.js','./manifest.webmanifest','./logo.svg'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  const url=new URL(e.request.url); if(url.origin!==location.origin) return;
  if(url.pathname.endsWith('/config.js')||url.pathname.endsWith('/app.js')||url.pathname.endsWith('/index.html')){
    e.respondWith(fetch(e.request).then(resp=>{const copy=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return resp;}).catch(()=>caches.match(e.request))); return;
  }
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(resp=>{const copy=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return resp;}).catch(()=>e.request.mode==='navigate'?caches.match('./index.html'):Response.error())));
});
