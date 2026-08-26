const createNextIntlPlugin = require("next-intl/plugin");

const withNextIntl = createNextIntlPlugin("./src/i18n/request.js");

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const isDev = process.env.NODE_ENV !== "production";

// connect-src es la directiva que de verdad importa aquí: aunque un script llegara a ejecutarse
// en nuestro origen, no puede mandar el token a un dominio ajeno. Era lo único que faltaba para
// que el XSS de adjuntos pasara de "ejecuta" a "exfiltra".
//
// blob: en img-src y frame-src es imprescindible: el visor de adjuntos crea blob: URLs.
// data: en img-src también, porque las miniaturas y las fotos del técnico son data: URIs.
//
// 'unsafe-inline' en script-src es un compromiso conocido: Next 14 inyecta scripts en línea y
// quitarlo exige nonces por middleware. No lo quita todo, pero connect-src, frame-ancestors y
// object-src sí cierran la exfiltración, el clickjacking y los plugins.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://maps.googleapis.com`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https://maps.gstatic.com https://*.googleapis.com https://*.ggpht.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  // places.googleapis.com es un host DISTINTO de maps.googleapis.com, y es al que habla la
  // Places API (New): el widget de direcciones carga su script desde maps.* pero pide las
  // sugerencias a places.*. Dejarlo fuera bloqueaba el autocompletado entero con una violación
  // de connect-src — comprobado en el navegador, no deducido.
  `connect-src 'self' ${API} https://maps.googleapis.com https://places.googleapis.com`,
  "frame-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Las URL llevan tokens (/intake/<token>, /work-orders/mobile/<token>). Sin esto, el
          // token entero viaja en la cabecera Referer al pulsar cualquier enlace externo.
          { key: "Referrer-Policy", value: "no-referrer" },
          // camera=(self) se mantiene: el intake del cliente y la vista del técnico suben fotos
          // desde el móvil, y quitarlo rompería justo esa pantalla.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self), payment=()" },
        ],
      },
    ];
  },
};

module.exports = withNextIntl(nextConfig);
