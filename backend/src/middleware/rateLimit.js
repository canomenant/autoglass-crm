const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const { JWT_SECRET, VERIFY_OPTIONS } = require("../config/secrets");

// Quién es quien llama, para contarle a él y no a su oficina.
//
// El limitador se monta en /api, antes que requireAuth, así que req.user todavía no existe aquí
// y hay que mirar el token directamente. Se VERIFICA la firma en vez de sólo descodificarlo: con
// un decode a secas, cualquiera se fabrica un `id` distinto en cada petición y estrena cubo cada
// vez, que es justo lo que el limitador debe impedir.
//
// Es un HMAC sobre una cadena corta — microsegundos. requireAuth vuelve a verificar después
// porque además consulta el estado de la cuenta; esto sólo elige la clave de conteo.
function callerKey(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) {
    try {
      const claims = jwt.verify(header.slice(7), JWT_SECRET, VERIFY_OPTIONS);
      if (claims.id) return `u:${claims.id}`;
    } catch {
      // Token inválido o caducado: cuenta como anónimo, por IP.
    }
  }
  return ipKeyGenerator(req.ip);
}

// La API no tenía ningún limitador. /api/auth/login aceptaba intentos ilimitados contra una
// lista de correos que el propio historial del repositorio llegó a contener, y como cada
// intento cuesta un bcrypt de coste 12 (~250 ms de CPU), el mismo endpoint servía para probar
// credenciales y para tumbar el proceso.

const base = {
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
};

// Por IP Y por cuenta a la vez. Sólo por IP, una botnet rota direcciones y sigue probando;
// sólo por cuenta, cualquiera bloquea a un usuario legítimo a voluntad mandando fallos con su
// correo. La combinación cubre los dos casos.
//
// skipSuccessfulRequests: un login que acierta no gasta cupo, así que quien trabaja con
// normalidad nunca ve este límite.
//
// Se agrupa por CORREO (la cuenta), no por IP. En Railway la petición pasa por proxies cuya IP
// no es estable —se comprobó en produccion: el contador saltaba 9, 9, 8 porque cada intento caía
// en un cubo de IP distinto y nunca llegaba a 10—, asi que contar por IP dejaba pasar la fuerza
// bruta. Contar por cuenta bloquea el adivinar la contraseña de un usuario aunque venga por mil
// IPs, que es la defensa que de verdad importa contra el robo de credenciales.
//
// El correo se normaliza igual que en el login (minúsculas, sin espacios). Un cuerpo sin correo
// cae en un único cubo compartido, que es aceptable: un intento de login sin correo no prospera.
const loginLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    // Con correo: por cuenta (estable). Sin correo: por IP, que es lo único que hay.
    return email ? `email:${email}` : `ip:${ipKeyGenerator(req.ip)}`;
  },
});

// Rutas que se sirven sin sesión: intake del cliente, link móvil del técnico, comprobante de
// pago y creación de sesiones de Stripe. El token las autoriza, pero nada limitaba cuántas
// veces se podía llamar — y crear sesiones de Stripe sin límite cuesta dinero.
const publicLimiter = rateLimit({ ...base, windowMs: 15 * 60 * 1000, limit: 60 });

// Cinturón general. Holgado a propósito: el panel carga varios catálogos por pantalla, así que
// esto es un tope contra el abuso, no una cuota de uso normal.
//
// Se cuenta POR USUARIO cuando hay sesión, no por IP. Contar por IP reparte una sola cuota
// entre toda una oficina que sale por NAT: cuatro personas actualizando órdenes en cadena se
// quitarían el cupo entre ellas, y el 429 lo vería quien no ha hecho nada raro. Sin sesión
// —rutas públicas, login— se vuelve a la IP, que es lo único que hay.
const apiLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: 600,
  keyGenerator: callerKey,
});

module.exports = { loginLimiter, publicLimiter, apiLimiter };
