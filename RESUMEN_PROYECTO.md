# Resumen del Proyecto — Reyes Auto Glass CRM

Documento generado leyendo el estado real del repositorio (dependencias, esquema SQL en vivo contra Railway Postgres, componentes, páginas y rutas) — no es una descripción aspiracional, es lo que existe hoy en el código.

---

## 1. Stack tecnológico y librerías

### Backend — `backend/`

Node.js + Express, sin ORM (consultas SQL crudas vía un pool `pg` compartido en `backend/src/config/db.js`).

| Librería | Versión | Uso |
|---|---|---|
| `express` | ^4.19.2 | Servidor HTTP / router |
| `express-async-errors` | ^3.1.1 | Captura errores de handlers `async` sin try/catch manual |
| `pg` | ^8.11.5 | Cliente Postgres (fuente de verdad para los stores migrados) |
| `jsonwebtoken` | ^9.0.2 | Emisión/verificación de JWT para auth |
| `bcryptjs` | ^2.4.3 | Hash de contraseñas (cost 12) para admin, agentes y técnicos, vía `lib/password.js` |
| `cors` | ^2.8.5 | CORS para el frontend |
| `dotenv` | ^16.4.5 | Variables de entorno |
| `axios` | ^1.19.0 | Llamadas HTTP salientes (NHTSA vPIC) |
| `stripe` | ^22.3.2 | Checkout de pagos online (integración real, ver sección 7) |
| `xlsx` | ^0.18.5 | Lectura de archivos Excel para imports (ej. comisiones históricas de agentes) |
| `mysql2` | ^3.23.2 | **Sin uso** — resto de un plan original con MySQL/Hostinger, reemplazado por Postgres (ver sección 9) |
| `nodemon` (dev) | ^3.1.0 | Reinicio automático en desarrollo |

### Frontend — `frontend/`

Next.js 14 (App Router), React 18, Tailwind CSS.

| Librería | Versión | Uso |
|---|---|---|
| `next` | ^14.2.5 | Framework (App Router, `[locale]` dinámico) |
| `react` / `react-dom` | ^18.3.1 | UI |
| `next-intl` | ^4.13.2 | Internacionalización (en/es) |
| `chart.js` + `react-chartjs-2` | ^4.5.1 / ^5.3.1 | Gráficos en `/dashboard/reports` |
| `react-big-calendar` | ^1.20.0 | Calendario de programación (`SchedulingCalendar`) |
| `moment` | ^2.30.1 | Manejo de fechas (usado por `react-big-calendar`) |
| `tailwindcss` (dev) | ^3.4.4 | Sistema de estilos |
| `postcss` / `autoprefixer` (dev) | ^8.4.38 / ^10.4.19 | Pipeline de CSS |

No hay librería de drag-and-drop, ni gestor de estado global (Redux/Zustand) — todo el estado es local por componente vía `useState`/`useEffect`, y la comunicación entre módulos se resuelve con props y una función `request()` compartida hacia la API.

### Base de datos e infraestructura

- **PostgreSQL 16** — producción en Railway (`DATABASE_URL`), desarrollo local vía `docker-compose.yml` (imagen `postgres:16`).
- Sin ORM/query builder — SQL crudo con parámetros posicionales (`$1, $2...`) en cada `store.js`.
- No hay `Dockerfile` para backend/frontend — el `docker-compose.yml` solo levanta Postgres para desarrollo local.

---

## 2. Estructura de carpetas

```
autoglass-crm/
├── docker-compose.yml          Postgres 16 local para desarrollo
├── backend/
│   ├── src/
│   │   ├── config/              Conexión a DB (db.js = pool Postgres activo; mysql.js = sin uso)
│   │   ├── routes/               32 archivos de rutas Express (uno por recurso)
│   │   ├── store/                29 archivos de acceso a datos (SQL directo o JSON/app_data)
│   │   ├── lib/                  Utilidades: persistence.js, sqlMappers.js, initPostgres.js, stripe.js
│   │   ├── middleware/           auth.js (JWT, roles)
│   │   ├── webhooks/             stripeWebhook.js
│   │   ├── controllers/          Vacía — scaffolding MVC nunca usado
│   │   └── models/               Vacía — ídem
│   ├── data/                     Archivos *.json que respaldan los stores no migrados a SQL
│   ├── imports/                  Archivos fuente de imports puntuales (excel de comisiones, etc. — gitignored)
│   ├── scripts/                  43 scripts one-off: migraciones, backfills, imports, backups
│   ├── sql/                      Carpeta vacía (solo un README placeholder)
│   ├── backups/ · backups-pg/    Snapshots manuales tomados durante el desarrollo
│   └── public/uploads/           Archivos subidos por usuarios (fotos, adjuntos)
└── frontend/
    ├── src/
    │   ├── app/[locale]/         Todas las rutas (App Router), 62 archivos page.js
    │   ├── components/           36 componentes reutilizables
    │   ├── lib/                  api.js (cliente HTTP), catálogos de columnas de tablas, permisos, colores de estado
    │   ├── i18n/                 Configuración de next-intl (routing, navigation, request)
    │   └── styles/globals.css    Tailwind + overrides puntuales para react-big-calendar en modo oscuro
    └── messages/                 en.json / es.json — todos los textos de la UI
```

---

## 3. Arquitectura de datos

### 3.1 Resumen de la migración JSON → SQL (Fase 1 a Fase 4)

El proyecto arrancó guardando todo en archivos `backend/data/*.json`. Se migró de forma incremental y controlada, entidad por entidad, en 4 fases (commits `2e7072f`, `a580605`, `43f95b4`, `e122a89`):

| Fase | Qué hizo |
|---|---|
| **Fase 1 — Shadow read** | Se agregaron lecturas SQL en paralelo (fire-and-forget) a customers, quotes, workorders, technicians, insurance y vehicleTypes, solo para comparar contra el JSON y loguear diferencias. El JSON seguía siendo lo que se devolvía al cliente. |
| **Fase 2 — Dual-write** | Cada `create()`/`update()`/`remove()` empezó a escribir en ambos lados (JSON y SQL), con un mismo UUID generado una sola vez. El JSON seguía siendo la fuente de verdad si SQL fallaba. |
| **Fase 3 — SQL como fuente primaria** | Se invirtió la prioridad: las lecturas y escrituras pasaron a depender de SQL como camino principal (con errores propagándose al llamador), y el JSON pasó a ser el respaldo de emergencia, ya no bloqueante. |
| **Fase 4 — Apagado del JSON** | Para 5 stores (**customers, quotes, workorders, technicians, payments/payouts**) se eliminó por completo el JSON, el dual-write y el shadow-read. Se borraron `sqlShadow.js` y `sqlSync.js` (confirmado: no existen en el árbol actual). `insurance` y `vehicleTypes` tuvieron su código de shadow-read retirado (porque dependía de los helpers borrados) pero **nunca se migraron** — siguen en JSON hoy. |

**Resultado actual:** 5 stores viven 100% en SQL, sin fallback. El resto (22 stores) sigue en JSON, cacheado a través de una tabla genérica `app_data(key, value jsonb)` en Postgres para sobrevivir reinicios en Railway.

### 3.2 Stores SQL-primarios (6)

| Store | Tabla real | Nota |
|---|---|---|
| `customers.store.js` | `customers` | |
| `quotes.store.js` | `quotes` | |
| `workorders.store.js` | `work_orders` | |
| `technicians.store.js` | `technicians` | |
| `payments.store.js` | **`payouts`** | Nombre engañoso: el archivo se llama `payments.store.js` pero gestiona la tabla `payouts` (comisiones/pagos a técnicos, distribuidores y agentes). La tabla SQL `payments` (pagos de clientes por work order) es un **quinto huérfano** — nadie la consulta (ver 3.4). |
| `zipCodes.store.js` | `zip_codes` | |

### 3.3 Stores JSON / `app_data` (22)

agents, attachments, calibrationTypes, distributors, expenseCategories, expenses, insurance, invoices, jobTypes, notes, partNumbers, partnerCompanies, paymentMethods, paymentStatus, priceTiers, quoteIntakeNotifications, tableViews, tags, users, vehicleTypes, workOrderNotifications, y `presence.store.js` (caso especial: memoria pura, ni JSON ni SQL — un objeto `{}` en RAM que se reinicia con el servidor).

Varios stores JSON dependen de stores SQL para calcular estadísticas (ej. `agents.store.js` lee `quotes` y `payouts` para armar `computeStats()`), así que "estar en JSON" no significa estar aislado de Postgres.

### 3.4 Esquema SQL en vivo (Postgres, relevado directo vía `information_schema`)

| Tabla | Filas | PK | Notas |
|---|---:|---|---|
| `customers` | 3,678 | UUID | SQL-primaria |
| `quotes` | 3,866 | UUID | SQL-primaria |
| `work_orders` | 3,866 | UUID | SQL-primaria |
| `technicians` | 16 | UUID | SQL-primaria |
| `payouts` | 200 | int (asignado por la app) | SQL-primaria, gestionada por `payments.store.js` |
| `zip_codes` | 3,548 | UUID | SQL-primaria |
| `users` | 1 | UUID | Tabla SQL separada del store JSON `users.store.js` — no relacionadas |
| `app_data` | 22 | text (`key`) | Caché genérico para los 22 stores JSON |
| `insurance_companies` | **0** | UUID | Tabla vacía — `insurance.store.js` sigue en JSON y nunca la consulta, pese a que `quotes`/`work_orders` tienen FK hacia ella |
| `vehicles` | 92,958 | UUID | `work_orders.vehicle_id` tiene FK hacia acá, pero la columna nunca se completa al crear una work order — FK muerta en la práctica |
| `payments` | 3,865 | UUID | Huérfana — ningún store la consulta (ver 3.2) |
| `work_orders_history` | 3,865 | UUID | Import histórico original, de una sola vez (ver 3.5) |
| `cat_agent` | 7 | int | Catálogo huérfano — `quotes.agent_id` tiene FK acá pero la app resuelve contra `app_data['agents.json']`, no esta tabla |
| `cat_distributor` | 28 | int | Ídem, `work_orders.distributor_id` |
| `cat_technician` | 15 | int | Ídem, sin referencia desde código |
| `cat_vehicle` | 301,625 | varchar | Catálogo histórico de vehículos, solo usado por scripts de import |
| `cat_part_number` | 11,125 | text | Catálogo NAGS, solo usado por scripts de import/backfill |
| `cat_zipcode` | 3,598 | varchar | Catálogo histórico de ZIPs, reemplazado operativamente por `zip_codes` |

**Nota:** `backend/scripts/migrate-to-postgres/schema.sql` define una tabla `table_views`, pero esa tabla **no existe** en la base real — `tableViews.store.js` sigue siendo JSON/`app_data`. El script de creación de esquema no se corrió completo, o esa parte quedó descartada.

### 3.5 Tablas históricas/catálogo — de dónde vienen y por qué existen

`work_orders_history` (3,865 filas) es el import original de la operación (un Excel/CSV con el historial completo del negocio antes de existir este sistema). Se usó **una sola vez** como fuente para reconstruir `quotes`/`work_orders` (line items, método de pago, distribuidor, tipo de calibración, etc. — varias rondas de backfill documentadas en `backend/scripts/`). No tiene relación (FK) con las tablas operativas y no se vuelve a tocar en código de la aplicación — es un artefacto de auditoría, no algo que el sistema lea en producción.

`cat_vehicle`, `cat_part_number`, `cat_zipcode` son catálogos de referencia igual de históricos (vehículos NHTSA/NAGS, partes NAGS, ZIPs) que alimentaron esos mismos backfills una vez y hoy están inertes.

---

## 4. Páginas y secciones de la app

62 archivos `page.js`, todos bajo `frontend/src/app/[locale]/...` (prefijo de idioma omitido abajo).

### Autenticación
| Ruta | Qué hace |
|---|---|
| `/` | Redirect a `/login` |
| `/login` | Formulario de login, con botones de acceso rápido para las 3 cuentas demo (Admin/Agente/Técnico) |

### Dashboard principal
| Ruta | Qué hace |
|---|---|
| `/dashboard` | KPIs generales, calendario de programación (`SchedulingCalendar`) y panel lateral de trabajos del día/semana |

### Customers
| Ruta | Qué hace |
|---|---|
| `/dashboard/customers` | Listado de clientes |
| `/dashboard/customers/new` · `/[id]` | Alta / edición de cliente |

### Quotes
| Ruta | Qué hace |
|---|---|
| `/dashboard/quotes` | Tabla configurable de cotizaciones (columnas, orden, vistas guardadas) |
| `/dashboard/quotes/new` · `/[id]` | Alta / edición de cotización, incluye envío de link de auto-servicio al cliente |
| `/dashboard/quotes/lost-report` | Analítica de cotizaciones perdidas (motivo, precio de la competencia) |

### Work Orders
| Ruta | Qué hace |
|---|---|
| `/dashboard/workorders` | Tabla configurable de work orders (filtros, columnas, paginación) |
| `/dashboard/workorders/[id]` | Detalle completo: status tracker, asignación de técnico, pagos, comisión de agente, factura, y el `QuoteForm` de la cotización vinculada |
| `/work-orders/mobile/[token]` | Vista pública (sin login) para el técnico en campo, vía token |

### Invoices
| Ruta | Qué hace |
|---|---|
| `/dashboard/invoices/[id]` | Editor de factura (plantillas Personal/Insurance/Custom) |
| `/invoice/view/[token]` | Vista pública de factura (sin login) |

### Expenses
| Ruta | Qué hace |
|---|---|
| `/dashboard/expenses` | Listado + alta rápida por modal + export CSV |
| `/dashboard/expenses/new` · `/[id]` | Alta / edición |

### Payments (comisiones, pagos, notas)
| Ruta | Qué hace |
|---|---|
| `/dashboard/payments` | Dashboard de pagos (técnicos/distribuidores/agentes), acciones de estado |
| `/dashboard/payments/create` | Wizard para crear lotes de pago |
| `/dashboard/payments/[id]` | Detalle de un pago |
| `/dashboard/payments/credit-notes` · `/debit-notes` (+ `/create`, `/[id]`) | Notas de crédito/débito |
| `/dashboard/payments/distributors` · `/agents` · `/technicians` | Reportes agregados por entidad |

### Users, Reports, Distributors
| Ruta | Qué hace |
|---|---|
| `/dashboard/users` (+ `/new`, `/[id]`) | Usuarios internos |
| `/dashboard/reports` | Dashboard de gráficos (Chart.js) combinando work orders, cotizaciones, gastos |
| `/dashboard/distributors` (+ `/new`, `/[id]`) | Distribuidores de vidrio/partes |

### Settings — catálogos maestros
`/dashboard/settings` (hub) + `/[slug]` (fallback genérico) y páginas dedicadas para: calibration-type, expense-category, partner-companies, job-type, tag, payment-method, payment-status, price-tier, vehicle, part-number, zip-code, technicians (+new/[id]), agents (+new/[id]), insurance-companies (+new/[id]).

### Páginas públicas (sin login, basadas en token)
| Ruta | Qué hace |
|---|---|
| `/intake/[token]` | Formulario de auto-servicio para que el cliente cargue sus datos/vehículo/fotos |
| `/pay/[token]` | Página de pago, dispara Stripe Checkout |
| `/payment-success` · `/payment-cancelled` | Confirmación de Stripe |

---

## 5. Componentes reutilizables principales

| Componente | Qué hace | Se usa en |
|---|---|---|
| `QuoteForm.js` | Formulario compuesto grande: cliente, vehículo, seguro, precios, descuentos, fotos. Calcula totales en vivo (`computeTotals`) | Quotes new/[id], Work Orders [id] |
| `SearchableSelect.js` | Reemplazo de `<select>` con búsqueda, listas grandes con paginación de resultados, y fallback para valores que no matchean ninguna opción (evita que un dato guardado "desaparezca" visualmente) | `VehicleSelector`, `QuoteForm`, `WorkOrderPaymentPanel` |
| `VehicleSelector.js` | Año/Marca/Modelo/Carrocería en cascada + decodificación de VIN (NHTSA) con debounce | `QuoteForm` |
| `ConfigureViewModal.js` | Modal para configurar columnas visibles/orden de las tablas de Quotes y Work Orders, con Vistas Guardadas (Personal/Compañía) | Quotes list, Work Orders list |
| `EditCustomerModal.js` | Edición rápida de datos del cliente sin salir de la Quote/Work Order | `QuoteForm` |
| `WorkOrderPaymentPanel.js` | Captura de pago del cliente (método, monto, marca de pagado, link de pago Stripe) | Work Orders [id] |
| `WorkOrderOperationsDashboard.js` | Status tracker + paneles operativos (pago, técnico, agente/comisión, distribuidor, admin) | Work Orders [id] |
| `TechAssignmentPanel.js` | Asignación de técnico + notificaciones | Work Orders [id] |
| `SchedulingCalendar.js` / `SchedulingSidePanel.js` | Calendario drag-and-drop de trabajos por cita | Dashboard principal |
| `PaymentBatchWizard.js` | Wizard multi-paso para crear lotes de pago a técnicos/distribuidores/agentes | Payments/create |
| `NoteForm.js` | Form compartido de notas de crédito/débito (`noteType` decide el comportamiento) | Credit/Debit notes |
| `InvoicePanel.js` | Resumen/acciones de factura embebido en la Work Order | Work Orders [id] |
| `QuoteSummaryPanel.js` / `WorkOrderSummaryPanel.js` | Panel lateral de resumen en vivo | `QuoteForm`, Work Orders [id] |
| `CurrencyInput.js` / `PercentInput.js` / `PhoneInput.js` | Inputs formateados (moneda, porcentaje, teléfono con validación) | Usados en casi todos los formularios |
| `AccessGuard.js` | Gate de autenticación + control de acceso por rol | Layout del dashboard completo |
| `ThemeProvider.js` | Modo claro/oscuro/sistema, persistido en localStorage | Header, layout raíz |
| `Sidebar.js` / `Header.js` | Navegación principal, filtrada por rol | Layout del dashboard |
| `SimpleCatalogPage.js` | CRUD genérico para catálogos simples (nombre + poco más) | Payment methods, payment status |
| Forms de entidad (`CustomerForm`, `DistributorForm`, `ExpenseForm`, `InsuranceForm`, `UserForm`, `TechnicianForm`, `AgentForm`) | Alta/edición de cada entidad | Sus respectivas páginas new/[id] |

---

## 6. Sistema de diseño

- **Modo oscuro:** basado en clase (`darkMode: "class"` en `tailwind.config.js`), aplicado con un script inline en el layout que lee `localStorage.theme` antes de la hidratación (evita parpadeo). Uso consistente: la clase `dark:` aparece en prácticamente todos los componentes del dashboard. Excepción: las páginas públicas (`login`, `pay/[token]`, `payment-success`, `payment-cancelled`) son solo modo claro.
- **Paleta:** sin colores custom en `tailwind.config.js` — se usa la paleta estándar de Tailwind (`gray`/`slate` para superficies, `blue` como color primario, `green`/`emerald`, `red`, `amber`/`orange` para estados).
- **Única animación custom:** `fadeIn` (200ms, opacidad + traslación de 4px), usada en modales y listas que aparecen dinámicamente.
- **Patrones recurrentes** (verbatim, se repiten decenas de veces):
  - Tarjeta/panel: `bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm`
  - Botón primario: `bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors`
  - Input: `border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow`
  - Título de página: `text-2xl font-semibold dark:text-gray-100 tracking-tight`
  - Fila de tabla (hover): `hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors`
  - Mensaje de error: `text-red-600 dark:text-red-400 text-sm`
  - Badge/pill de estado: `rounded-full px-2.5 py-1` combinado con mapas de color por estado (`STATUS_COLORS` en `lib/`)
- **`globals.css`** (`frontend/src/styles/globals.css`) prácticamente no tiene CSS propio — son las 3 directivas `@tailwind` más overrides puntuales para que `react-big-calendar` (que trae su propio CSS no tocado por `dark:`) se vea bien en modo oscuro.
- **i18n:** `next-intl`, dos locales (`en` default, `es`), rutas prefijadas (`/en/...`, `/es/...`). No se encontró un selector de idioma visible en la UI (`Header`/`Sidebar`) — el cambio de idioma hoy depende de la URL, no de un toggle.

---

## 7. Integraciones externas

### NHTSA vPIC (decodificación de vehículos) — gratuita, sin API key
Base: `https://vpic.nhtsa.dot.gov/api/vehicles`

| Endpoint interno | Qué hace | Llamada externa |
|---|---|---|
| `GET /api/vehicle/vin/:vin` | Decodifica VIN a año/marca/modelo/trim/carrocería | `DecodeVinValuesExtended/:vin` |
| `GET /api/vehicle/makes/:year` | Lista de marcas | `GetMakesForVehicleType/car` |
| `GET /api/vehicle/models/:year/:makeId` | Modelos de una marca/año (combina car+truck+mpv) | 3 llamadas a `GetModelsForMakeIdYear` |

Caché en memoria (`Map`, TTL 24h) para makes/models — no persiste entre reinicios del servidor. El VIN no se cachea (cada VIN es único). Hay una **segunda implementación independiente** de decodificación de VIN en `intake.routes.js` (para el formulario público de auto-servicio) que llama a NHTSA directo con `fetch`, sin caché — es código duplicado, no comparte lógica con `vehicle.routes.js`.

### Stripe — pagos online, integración real y completa
1. Cliente pide pagar desde `WorkOrderPaymentPanel` → se genera un link `/pay/:token`.
2. `POST /api/checkout/create-checkout-session` (`checkout.routes.js`) crea una sesión de Stripe Checkout por el saldo pendiente de la work order.
3. El cliente paga en Stripe; al completarse, el webhook `POST /api/checkout/webhook` (`stripeWebhook.js`, montado con `express.raw` antes del parser JSON global, como exige Stripe para verificar la firma) marca la work order como pagada.

**Atención:** `backend/.env.example` no documenta `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` ni `FRONTEND_URL` — están configuradas en el `.env` real pero un setup nuevo desde el ejemplo fallaría silenciosamente.

### SMS / Email — no implementado, solo simulado
`quoteIntakeNotifications.store.js` y `workOrderNotifications.store.js` registran un log con `status: "Sent"` hardcodeado cada vez que se "envía" un link de intake o una notificación — **no hay ningún proveedor real conectado** (no hay Twilio, SendGrid, ni SMTP en las dependencias ni en `.env.example`). Es un placeholder para una integración futura.

### mysql2 — dependencia sin uso
`backend/src/config/mysql.js` define un pool MySQL (variables `DB_HOST`/`DB_PORT`/etc. en `.env.example`, apuntando a "Hostinger") pero **ningún archivo lo importa**. Es el resto de un plan de base de datos anterior a la migración a Postgres/Railway.

---

## 8. Fragmentos de código representativos

**Cliente HTTP compartido del frontend** (`frontend/src/lib/api.js`) — todas las llamadas a la API pasan por acá, con manejo centralizado de sesión expirada:
```js
export async function request(path, options = {}) {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const res = await fetch(`${API_URL}/api${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
  });
  if (res.status === 401 && token) {
    localStorage.removeItem("token"); localStorage.removeItem("user");
    window.location.href = "/login";
    return new Promise(() => {});
  }
  // ...
}
export const updateWorkOrder = (id, data) => request(`/workorders/${id}`, { method: "PUT", body: JSON.stringify(data) });
```

**Estado de formulario y setter genérico por path** (patrón usado en `QuoteForm.js` para objetos anidados):
```js
function set(path, value) {
  setForm((prev) => {
    const next = { ...prev };
    if (path[0] === "vehicle" || path[0] === "insurance" || path[0] === "newCustomer" /* ... */) {
      next[path[0]] = { ...prev[path[0]], [path[1]]: value };
    } else {
      next[path[0]] = value;
    }
    return next;
  });
}
// uso: onChange={(v) => set(["vehicle", "make"], v)}
```

**Store SQL-primario** (`backend/src/store/customers.store.js`) — patrón repetido en los 6 stores migrados: `get()` filtra soft-deletes, `update()` mergea con `??` y reescribe la fila entera:
```js
async function get(id) {
  const r = await pool.query("SELECT * FROM customers WHERE id = $1 AND active <> false", [id]);
  if (!r.rows[0]) return null;
  return withName(mapCustomer(r.rows[0]));
}

async function update(id, data) {
  const existing = await get(id);
  if (!existing) return null;
  const customer = { ...existing, firstName: data.firstName ?? existing.firstName, /* ... */ };
  await writeCustomerToSql(customer);
  return withName(customer);
}
```

**Store JSON/`app_data`** (patrón compartido por los 22 stores no migrados, vía `backend/src/lib/persistence.js`):
```js
let items = loadOrSeed(FILE, () => []); // primero busca en app_data (Postgres), si no existe lee backend/data/*.json
```

**Middleware de auth** (`backend/src/middleware/auth.js`):
```js
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token" });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ error: "Invalid token" }); }
}

function requireMethodRole(methodRoleMap) {
  return (req, res, next) => {
    const allowed = methodRoleMap[req.method] || [];
    if (!allowed.includes(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    next();
  };
}
```

**Reordenamiento dentro de un grupo, sin afectar al resto** (`ConfigureViewModal.js` — reordena solo columnas pinneadas o solo no-pinneadas, preservando la posición de todo lo demás):
```js
function reorderWithinGroup(prev, predicate, fromKey, toKey) {
  const groupIndices = [];
  prev.forEach((c, i) => { if (predicate(c)) groupIndices.push(i); });
  const groupKeys = groupIndices.map((i) => prev[i].key);
  const fromPos = groupKeys.indexOf(fromKey);
  const toPos = groupKeys.indexOf(toKey);
  if (fromPos === -1 || toPos === -1 || fromPos === toPos) return prev;
  const reordered = [...groupKeys];
  const [moved] = reordered.splice(fromPos, 1);
  reordered.splice(toPos, 0, moved);
  const next = [...prev];
  groupIndices.forEach((originalIndex, i) => { next[originalIndex] = prev.find((c) => c.key === reordered[i]); });
  return next;
}
```

---

## 9. Deuda técnica conocida y pendientes

### Seguridad
- ~~Contraseñas en texto plano~~ — **resuelto** (commit `ad71073`). Todo pasa por `lib/password.js`: bcrypt cost 12, mínimo 8 caracteres, y un único choke point para escrituras. `verifyPassword()` conserva una rama para texto plano que valida y marca `needsRehash`, para migrar filas legacy en el primer login; hoy no queda ninguna.
- ~~Admin demo hardcodeado~~ — **resuelto** (commit `ad71073`). Login real contra `users.json`; la cuenta de emergencia es opcional, viene de variables de entorno y está apagada por defecto.
- ~~Los logins de agentes vivían solo en `backend/data/agents.json`, trackeado en git~~ — **resuelto**. `scripts/migrate-agent-passwords.js` volcó los 7 agentes reales a `app_data` con sus hashes, sacó `agents.json` de `CACHE_EXCLUDED_KEYS`, destrackeó el archivo y **rotó las 7 contraseñas**, porque destrackear no borra los hashes del historial. En la misma pasada se eliminó `Verify Agent` (id 8), una cuenta de prueba con contraseña en texto plano.
- `POST /forgot-password` **sigue siendo un stub**: siempre responde éxito, no envía ningún email.
- El link móvil del técnico ya no acepta escrituras sin credencial: `PUT /workorders/:id` exige sesión, y la escritura pública va por `PUT /mobile/:token`, con auditoría en `work_orders.public_access_log` y revocación por botón.

### Inconsistencias de esquema / datos muertos
- `payments.store.js` gestiona la tabla `payouts`, no la tabla SQL `payments` — la tabla `payments` (3,865 filas, pagos históricos de clientes) no la consulta ningún store. Nombre confuso, fuente de errores si alguien asume que "payments" es "pagos de clientes".
- `insurance_companies` (SQL) tiene 0 filas — `insurance.store.js` sigue en JSON y nunca la usa, pese a que `quotes`/`work_orders` tienen FK hacia ella.
- `work_orders.vehicle_id` tiene FK hacia `vehicles` (92,958 filas) y **sí está poblada en 3,835 de 4,580** órdenes — viene del import histórico. Lo que no la escribe es la creación de una work order nueva desde la app. La tabla `vehicles` en sí no la lee ningún store: el catálogo que usa el formulario es `app_data['vehicleTypes.json']`.
- `cat_agent`, `cat_distributor`, `cat_technician` tienen FKs desde `quotes.agent_id`/`work_orders.distributor_id`, pero la app resuelve esos datos contra los JSON (`agents.json`, `distributors.json`), no contra estas tablas — las FKs no se usan para nada relacional real.
- `table_views` está definida en `schema.sql` pero no existe en la base real — `tableViews.store.js` sigue en JSON.
- `quotes.commission` quedó inerte: existía como campo manual (siempre en 0, nunca usado por el usuario) hasta que se implementó comisión real en `work_orders.commission` (importada desde datos históricos reales). El campo en `quotes` se sigue escribiendo pero nada lo lee.
- `backend/src/controllers/` y `backend/src/models/` están vacías — scaffolding MVC inicial nunca usado (el patrón real es routes + store).
- `backend/.env.example` está desactualizado: no documenta `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `FRONTEND_URL` (que sí se usan en código), y sí documenta variables de MySQL que ya no se usan.

### Funcionalidad a medias
- **Comisión de agentes — Fase 2 parcial.** El input manual **ya existe** en la Work Order (junto al de mano de obra del técnico). Sigue faltando la sugerencia automática del monto según la tasa de Settings > Agents. El estatus del work order sí se automatizó: asignar técnico lo pasa a `Assigned` y saldar el balance a `Paid` (`scripts/verify-workorder-status-automation.js`); el texto de estatus del Agent Panel sigue siendo fijo.
- El campo `priceTier` en los line items de una Quote existe en el schema y en la UI, pero está prácticamente sin usar: **4 de 4,341 line items** lo tienen cargado. Es el nudo de la Fase B del P&L — el Price Tier es el margen real del trabajo (~$250 por orden) y no tiene categoría propia en el desglose de ingresos, así que el 72% del ingreso cae en "otros".
- Notificaciones SMS/Email son un log falso — no hay envío real (ver sección 7).
- Sin selector de idioma visible en la UI, pese a que la app soporta en/es.

### Organización / mantenimiento
- `backend/scripts/` acumula **64** scripts (migraciones, backfills, imports, y una familia creciente de `verify-*.js` que sí conviene conservar y volver a correr) sin ninguna carpeta de archivo/histórico — cuesta distinguir los one-off ya ejecutados de los que siguen vigentes.
- `backend/sql/` es una carpeta vacía con solo un placeholder.
- Página pública (`login`, `pay/[token]`, `payment-success/cancelled`) sin soporte de modo oscuro, inconsistente con el resto de la app.
