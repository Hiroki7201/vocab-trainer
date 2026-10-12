// Recall — offline cache (network-first, cache fallback)
const CACHE = "recall-v4-front-audio";
const ASSETS = ["./", "./index.html", "./manifest.json", "./icon.svg", "./practice.js", "./practice.css", "./speaking.json", "./scenes/scenes.json"];

// Some networks return an HTML error page with HTTP 200 on a connection failure.
// Verify static assets before returning or caching them, so that this cannot replace the app.
async function checkedFetch(request) {
  const response = await fetch(request);
  if (!response.ok) throw new Error("Asset HTTP " + response.status);
  const url = new URL(request.url || request, self.location.href);
  const type = (response.headers.get("content-type") || "").toLowerCase();
  const root = new URL("./", self.location.href).pathname;
  if (url.pathname === root || url.pathname === root + "index.html") {
    const text = await response.clone().text();
    if (!text.includes("vocab_srs_app_v1") || !text.includes("<title>Recall")) throw new Error("Unexpected app document");
  } else if (/\.json$/.test(url.pathname)) {
    await response.clone().json();
  } else if (/\.js$/.test(url.pathname) && !type.includes("javascript")) {
    throw new Error("Unexpected script response");
  } else if (/\.css$/.test(url.pathname) && !type.includes("text/css")) {
    throw new Error("Unexpected stylesheet response");
  } else if (/\.(webp|png|svg|jpe?g)$/.test(url.pathname) && !type.startsWith("image/")) {
    throw new Error("Unexpected image response");
  } else if (/\.mp3$/.test(url.pathname) && !type.startsWith("audio/") && !type.includes("application/octet-stream")) {
    throw new Error("Unexpected audio response");
  }
  return response;
}

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(ASSETS.map(async (asset) => {
    const request = new Request(new URL(asset, self.location.href), {cache:"reload"});
    await c.put(request, await checkedFetch(request));
  }))));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const current = await caches.open(CACHE);
    for (const key of await caches.keys()) {
      if (!key.startsWith("recall-") || key === CACHE) continue;
      // Keep previously viewed media usable offline when updating the app shell.
      const previous = await caches.open(key);
      for (const request of await previous.keys()) {
        if (!/\/(scenes|audio)\/[^/]+\.(webp|mp3)$/.test(new URL(request.url).pathname)) continue;
        if (await current.match(request)) continue;
        const response = await previous.match(request);
        if (response && response.ok) await current.put(request, response);
      }
      await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== "GET") return; // API calls (ElevenLabs proxy) go straight to network
  e.respondWith(
    checkedFetch(e.request)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); e.waitUntil(caches.open(CACHE).then((c) => c.put(e.request, copy))); }
        return res;
      })
      .catch(() => caches.match(e.request).then(async (r) => r || (e.request.mode === "navigate" ? await caches.match("./index.html") : null) || new Response("Offline asset unavailable", {status:504})))
  );
});
