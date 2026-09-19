const fs = require("fs"); const { PNG } = require("pngjs");
const src = PNG.sync.read(fs.readFileSync("C:/Users/Antonio Cano/autoglass-crm/frontend/public/logo.png"));
const { width: W, height: H, data } = src;
const BG = [26, 25, 21];
// Paleta real del logo (muestreada): blanco, azul, rojo. Cada píxel se explica como paleta*a + BG*(1-a):
// a = proyección sobre la recta BG→color; se toma el color con menor residuo. Así el azul sólido queda
// azul (antes salía lavado porque se estimaba alpha por canal).
const PAL = { white: [255, 255, 255], blue: [56, 128, 176], red: [232, 48, 48] };
function sep(i) {
  if (data[i + 3] === 0) return { k: null, a: 0 };
  const px = [data[i] - BG[0], data[i + 1] - BG[1], data[i + 2] - BG[2]];
  let best = null;
  for (const [k, c] of Object.entries(PAL)) {
    const d = [c[0] - BG[0], c[1] - BG[1], c[2] - BG[2]];
    const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    const t = Math.max(0, Math.min(1, (px[0] * d[0] + px[1] * d[1] + px[2] * d[2]) / dd));
    const res = Math.hypot(px[0] - t * d[0], px[1] - t * d[1], px[2] - t * d[2]);
    if (!best || res < best.res) best = { k, a: t, res };
  }
  if (best.a < 0.05) return { k: null, a: 0 };
  return best;
}
let x0 = W, y0 = H, x1 = 0, y1 = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; if (data[i + 3] && Math.max(data[i], data[i + 1], data[i + 2]) > 70) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } }
const M = 45; x0 = Math.max(0, x0 - M); y0 = Math.max(0, y0 - M); x1 = Math.min(W - 1, x1 + M); y1 = Math.min(H - 1, y1 + M);
const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
function make(name, map, bg) {
  const out = new PNG({ width: cw, height: ch });
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const i = ((y + y0) * W + (x + x0)) * 4, o = (y * cw + x) * 4;
    const s = sep(i);
    const c = s.k ? (map[s.k] || PAL[s.k]) : [0, 0, 0];
    if (bg) for (let n = 0; n < 3; n++) out.data[o + n] = Math.round(c[n] * s.a + bg[n] * (1 - s.a));
    else for (let n = 0; n < 3; n++) out.data[o + n] = c[n];
    out.data[o + 3] = bg ? 255 : Math.round(s.a * 255);
  }
  fs.writeFileSync(name, PNG.sync.write(out)); console.log("→", name, cw + "x" + ch);
}
make("logo-negro-recortado.png", {}, BG);
make("logo-transparente-carbon.png", { white: [28, 28, 30] });
make("logo-transparente-azul.png", { white: [41, 100, 160] });
make("logo-transparente-blanco.png", {});

// ---------------------------------------------------------------------------------------------
// Copia guardada del script de scratchpad (19-sep-2026). Genera desde frontend/public/logo.png:
//   logo-transparente-carbon.png → frontend/public/logo-print.png (papel: factura, statement, garantía)
//   logo-transparente-blanco.png → frontend/public/logo-dark.png  (fondos oscuros)
// También en OneDrive/Documents como logo-reyes-sin-fondo-carbon.png / -blanco.png.
// Requiere pngjs (npm i pngjs) en la carpeta donde se corra.
