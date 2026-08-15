// Lazy, singleton loader for the Maps JavaScript API — only injected into the page the first
// time an address field actually needs it (not on every page), and memoized so multiple
// AddressAutocomplete instances mounting concurrently share one script load instead of racing
// to inject it twice. Uses Google's official inline bootstrap loader (defines
// google.maps.importLibrary), not a hand-built <script src> URL.
let loadPromise = null;

export function loadGoogleMaps() {
  if (typeof window === "undefined") return Promise.reject(new Error("loadGoogleMaps must run in the browser"));
  if (window.google?.maps?.importLibrary) return Promise.resolve(window.google.maps);
  if (loadPromise) return loadPromise;

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) return Promise.reject(new Error("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set"));

  loadPromise = new Promise((resolve, reject) => {
    // Official Google bootstrap loader (https://developers.google.com/maps/documentation/javascript/load-maps-js-api) —
    // defines google.maps.importLibrary, which is what everything below actually uses.
    (g => {
      var h, a, k, p = "The Google Maps JavaScript API", c = "google", l = "importLibrary", q = "__ib__",
        m = document, b = window;
      b = b[c] || (b[c] = {});
      var d = b.maps || (b.maps = {}), r = new Set(), e = new URLSearchParams(),
        u = () => h || (h = new Promise(async (f, n) => {
          await (a = m.createElement("script"));
          e.set("libraries", [...r] + "");
          for (k in g) e.set(k.replace(/[A-Z]/g, t => "_" + t[0].toLowerCase()), g[k]);
          e.set("callback", c + ".maps." + q);
          a.src = `https://maps.${c}apis.com/maps/api/js?` + e;
          d[q] = f;
          a.onerror = () => h = n(Error(p + " could not load."));
          a.nonce = m.querySelector("script[nonce]")?.nonce || "";
          m.head.append(a);
        }));
      d[l] ? console.warn(p + " only loads once. Ignoring:", g) : d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n));
    })({ key: apiKey, v: "weekly" });

    window.google.maps.importLibrary("places").then(() => resolve(window.google.maps)).catch(reject);
  });

  return loadPromise;
}
