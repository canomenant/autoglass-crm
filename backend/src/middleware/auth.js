const jwt = require("jsonwebtoken");
const { JWT_SECRET, VERIFY_OPTIONS } = require("../config/secrets");

// Los tres stores de identidad, indexados por el rol que sale del token. Se cargan aquí arriba
// y no dentro del handler para no pagar un require() por petición.
const STORE_BY_ROLE = {
  ADMIN: require("../store/users.store"),
  AGENT: require("../store/agents.store"),
  TECHNICIAN: require("../store/technicians.store"),
};

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  let claims;
  try {
    claims = jwt.verify(token, JWT_SECRET, VERIFY_OPTIONS);
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // El reto intermedio del segundo factor está firmado con la misma clave, así que la firma
  // cuadra — pero NO es una sesión: se emite cuando la contraseña ya se validó y el código TOTP
  // todavía no. Sin este rechazo explícito, saltarse el segundo factor consistiría en usar el
  // reto tal cual contra cualquier endpoint, que es el fallo clásico de este flujo.
  if (claims.purpose) return res.status(401).json({ error: "Unauthorized" });

  // Un JWT es autocontenido: una vez emitido vale sus 8 horas completas pase lo que pase con la
  // cuenta. Eso significaba que cambiar la contraseña —el gesto con el que alguien expulsa a un
  // intruso— no expulsaba a nadie, y que desactivar a un agente o dar de baja a un técnico no
  // surtía efecto hasta el día siguiente: `status` sólo se miraba en el login.
  //
  // authState() es una consulta deliberadamente mínima. NO se usa store.get(), que en agents
  // recorre todas las cotizaciones y todos los pagos para calcular estadísticas, y en
  // technicians hace un GROUP BY sobre las 4.580 órdenes: eso por petición autenticada sería
  // insostenible. Esto es una búsqueda por clave primaria (o por índice en memoria).
  if (claims.entityId != null) {
    const store = STORE_BY_ROLE[claims.role];
    if (!store) return res.status(401).json({ error: "Unauthorized" });

    const state = await store.authState(claims.entityId);
    if (!state) return res.status(401).json({ error: "Unauthorized" });
    // users.store no tiene columna `status`; en ese caso existir y estar activo es lo mismo.
    if (state.status !== undefined && state.status !== "Active") {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if ((state.tokenVersion || 0) !== (claims.tokenVersion || 0)) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  req.user = claims;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Access Denied" });
    }
    next();
  };
}

function requireMethodRole(methodRoleMap) {
  return (req, res, next) => {
    const allowed = methodRoleMap[req.method] || [];
    if (!req.user || !allowed.includes(req.user.role)) {
      return res.status(403).json({ error: "Access Denied" });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, requireMethodRole };
