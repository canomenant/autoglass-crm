const Anthropic = require("@anthropic-ai/sdk");
const pool = require("../config/db");

// El consultor responde preguntas del negocio consultando la base directamente, así que su
// alcance se recorta aquí, no en el prompt: el modelo solo ve el esquema que se le describe y
// solo puede ejecutar lo que execute_sql() deja pasar. Un prompt se puede convencer; esto no.

// Tablas que el consultor no debe tocar: app_data guarda hashes de contraseñas de agentes y
// usuarios dentro de sus JSON (se expone solo a través de las vistas de abajo), y las copias
// stale de workorders/quotes que quedaron ahí de la migración darían números viejos.
const HIDDEN_TABLES = new Set(["app_data", "attachments", "pgmigrations"]);

// Columnas que se ocultan del esquema y se rechazan en las consultas: credenciales y tokens de
// enlaces públicos (el link móvil y el del comprobante son credenciales reales).
const SENSITIVE_COLUMN = /password|secret|token|mfa/i;

// Campos que se borran de las FILAS devueltas, aunque la consulta fuera un SELECT *: tokens por
// lo mismo de arriba, y fotos/adjuntos porque son base64 de varios MB que reventarían la
// respuesta y el contexto del modelo.
const REDACT_RESULT_KEY = /password|secret|token|mfa|photo|attachment|audit_log|access_log/i;
const MAX_CELL_CHARS = 500;
const MAX_RESULT_CHARS = 50000;

// Colecciones de app_data que sí puede consultar, expuestas como vistas SQL de un solo campo
// jsonb (item). Solo entidades cuyo store vive en JSON — las que tienen tabla SQL propia
// (work_orders, quotes, payouts...) se consultan en su tabla, que es la fuente de verdad.
// agents/users/technicians quedan fuera: llevan credenciales.
const APP_DATA_VIEWS = {
  app_expenses: "expenses.json",
  app_invoices: "invoices.json",
  app_distributors: "distributors.json",
  app_insurance_companies: "insurance.json",
  app_job_types: "jobTypes.json",
  app_expense_categories: "expenseCategories.json",
  app_part_numbers: "partNumbers.json",
  app_price_tiers: "priceTiers.json",
  app_calibration_types: "calibrationTypes.json",
  app_payment_methods: "paymentMethods.json",
  app_tags: "tags.json",
  app_partner_companies: "partnerCompanies.json",
};

const MODEL = "claude-opus-5";
const MAX_TOOL_ROUNDS = 8;
const MAX_ROWS = 200;
const STATEMENT_TIMEOUT_MS = 15000;

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic();
  return client;
}

// ---------------------------------------------------------------------------
// Vistas sobre app_data: cada elemento del array JSON como fila, con los campos sensibles
// quitados EN LA VISTA (no después), para que ni un SELECT item completo los devuelva.
// ---------------------------------------------------------------------------
async function ensureViews() {
  const viewFields = {};
  for (const [view, key] of Object.entries(APP_DATA_VIEWS)) {
    const keysRes = await pool.query(
      `SELECT DISTINCT k FROM app_data, jsonb_array_elements(value) e, jsonb_object_keys(e) k WHERE key = $1`,
      [key]
    );
    const allKeys = keysRes.rows.map((r) => r.k);
    const sensitive = allKeys.filter((k) => SENSITIVE_COLUMN.test(k) || REDACT_RESULT_KEY.test(k));
    // El nombre de la vista y la clave vienen del mapa de arriba, no de entrada externa.
    await pool.query(
      `CREATE OR REPLACE VIEW ${view} AS
       SELECT jsonb_array_elements(value) - $$${sensitive.join("$$::text - $$")}$$::text AS item
       FROM app_data WHERE key = '${key}'`
    );
    viewFields[view] = allKeys.filter((k) => !sensitive.includes(k));
  }
  return viewFields;
}

// ---------------------------------------------------------------------------
// Esquema: se lee de information_schema y se cachea. Así el prompt se mantiene al día cuando
// los scripts add-*-column.js agregan columnas, sin mantener un texto a mano.
// ---------------------------------------------------------------------------
let schemaCache = { text: null, at: 0 };
const SCHEMA_TTL_MS = 10 * 60 * 1000;

async function getSchemaText() {
  if (schemaCache.text && Date.now() - schemaCache.at < SCHEMA_TTL_MS) return schemaCache.text;

  const viewFields = await ensureViews();

  const r = await pool.query(`
    SELECT c.table_name, c.column_name, c.data_type
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name, c.ordinal_position
  `);

  const byTable = new Map();
  for (const row of r.rows) {
    if (HIDDEN_TABLES.has(row.table_name)) continue;
    if (SENSITIVE_COLUMN.test(row.column_name)) continue;
    if (!byTable.has(row.table_name)) byTable.set(row.table_name, []);
    byTable.get(row.table_name).push(`${row.column_name} ${row.data_type}`);
  }

  const lines = ["TABLAS:"];
  for (const [table, cols] of byTable) lines.push(`${table}(${cols.join(", ")})`);
  lines.push("");
  lines.push("VISTAS JSONB (cada fila tiene una sola columna `item` de tipo jsonb; consulta campos con item->>'campo' y castea: (item->>'amount')::numeric, (item->>'date')::date):");
  for (const [view, fields] of Object.entries(viewFields)) {
    lines.push(`${view} — campos de item: ${fields.join(", ") || "(vacía)"}`);
  }

  schemaCache = { text: lines.join("\n"), at: Date.now() };
  return schemaCache.text;
}

// ---------------------------------------------------------------------------
// Ejecución de SQL de solo lectura.
// ---------------------------------------------------------------------------
// La transacción READ ONLY es lo que de verdad impide escribir; el resto son cinturones:
//  - Sin punto y coma: "SELECT 1; COMMIT; DELETE ..." cerraría la transacción de solo lectura
//    y el DELETE correría fuera de ella. Una sola sentencia no tiene esa salida.
//  - Sin COMMIT/ROLLBACK/BEGIN sueltos por la misma razón.
//  - statement_timeout: una consulta cartesiana accidental no debe colgar el pool compartido.
const FORBIDDEN = /\b(commit|rollback|begin|savepoint|set\s|copy|listen|notify)\b/i;

function redactRows(rows) {
  return rows.map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      if (REDACT_RESULT_KEY.test(k)) continue;
      if (typeof v === "string" && v.length > MAX_CELL_CHARS) {
        out[k] = v.slice(0, MAX_CELL_CHARS) + "…[truncado]";
      } else if (v !== null && typeof v === "object") {
        // json/jsonb (y fechas): se redacta dentro y se recorta si aun así es enorme.
        const s = JSON.stringify(v, (key, val) => (REDACT_RESULT_KEY.test(key) ? undefined : val)) || "null";
        out[k] = s.length > MAX_CELL_CHARS * 4 ? s.slice(0, MAX_CELL_CHARS * 4) + "…[truncado]" : JSON.parse(s);
      } else {
        out[k] = v;
      }
    }
    return out;
  });
}

async function executeSql(sql) {
  const cleaned = String(sql || "").trim().replace(/;\s*$/, "");
  if (!cleaned) return { error: "Consulta vacía." };
  if (cleaned.includes(";")) return { error: "Solo se permite una sentencia por consulta (sin punto y coma)." };
  if (FORBIDDEN.test(cleaned)) return { error: "Sentencia no permitida: este agente solo puede leer datos." };
  if (SENSITIVE_COLUMN.test(cleaned) || /\bapp_data\b|\battachments\b/i.test(cleaned)) {
    return { error: "La consulta toca columnas o tablas restringidas (credenciales/adjuntos)." };
  }

  const conn = await pool.connect();
  try {
    await conn.query("BEGIN TRANSACTION READ ONLY");
    await conn.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    const result = await conn.query(cleaned);
    const rows = redactRows(result.rows.slice(0, MAX_ROWS));
    let payload = { rowCount: result.rowCount, truncated: result.rows.length > MAX_ROWS, rows };
    if (JSON.stringify(payload).length > MAX_RESULT_CHARS) {
      payload = {
        rowCount: result.rowCount,
        truncated: true,
        rows: rows.slice(0, 20),
        note: "Resultado demasiado grande: se devuelven solo 20 filas. Usa agregaciones o menos columnas.",
      };
    }
    return payload;
  } catch (err) {
    // El texto del error de pg (columna inexistente, sintaxis) es útil para que el modelo
    // corrija su consulta; no expone nada que el esquema del prompt no diga ya.
    return { error: err.message };
  } finally {
    try {
      await conn.query("ROLLBACK");
    } catch {}
    conn.release();
  }
}

const SQL_TOOL = {
  name: "execute_sql",
  description:
    "Ejecuta una consulta SQL de SOLO LECTURA (una única sentencia SELECT, sin punto y coma) " +
    "contra la base Postgres del CRM y devuelve las filas como JSON. Máximo " +
    MAX_ROWS +
    " filas por consulta: usa agregaciones (SUM, COUNT, GROUP BY) y LIMIT en vez de pedir tablas enteras.",
  input_schema: {
    type: "object",
    properties: {
      sql: { type: "string", description: "La sentencia SELECT a ejecutar." },
      purpose: { type: "string", description: "Qué pregunta del usuario responde esta consulta (una frase)." },
    },
    required: ["sql"],
  },
};

function buildSystemPrompt(schemaText) {
  return [
    `Eres el consultor interno de AutoGlass CRM, el sistema de gestión de una empresa de instalación y reemplazo de vidrios de autos (parabrisas, calibraciones ADAS, etc.).`,
    ``,
    `Tu trabajo: responder preguntas del administrador sobre los números y la operación de la compañía consultando la base de datos con la herramienta execute_sql, y también dudas generales sobre cómo funciona el software.`,
    ``,
    `Contexto del negocio (fuente de verdad por tema):`,
    `- Flujo principal: quotes (cotización) → work_orders (orden de trabajo) → cobro. El precio de venta vive en la quote (line_items jsonb) y en work_orders.total_sale.`,
    `- quotes.status: Converted significa que se volvió orden de trabajo. work_orders.status lleva el estado operativo (Assigned, Completed, Paid...).`,
    `- Lo cobrado de una orden va en work_orders.payment (jsonb con amountCharged, method, etc.).`,
    `- payouts: lotes de pago QUE LA EMPRESA HACE a técnicos, agentes y distribuidores (payouts.type); las comisiones de agente se pagan a su compañía (payouts.company).`,
    `- payable: deuda pendiente por parte y por orden (kind = a quién se le debe); alimenta los payouts.`,
    `- credit_debit_note: notas de crédito y débito (kind) usadas en la conciliación con distribuidores.`,
    `- work_order_agent_commission y work_order_tech_labor: comisión de agente y labor de técnico por orden.`,
    `- Los gastos generales están en la vista app_expenses; las facturas a clientes en app_invoices; los distribuidores en app_distributors; catálogos en las demás vistas app_*.`,
    `- technicians y cat_technician son compañías técnicas, no personas. customers son los clientes.`,
    `- Los montos son NUMERIC en dólares (USD). Los jsonb de las vistas se consultan con item->>'campo' y casteo explícito.`,
    ``,
    `Esquema real de la base:`,
    schemaText,
    ``,
    `Reglas:`,
    `- Nunca inventes cifras: toda cantidad que menciones debe salir de una consulta que acabas de ejecutar.`,
    `- Prefiere agregaciones (SUM, COUNT, GROUP BY) sobre listar filas; usa LIMIT cuando listes.`,
    `- Si una consulta falla, corrígela y reintenta en vez de rendirte.`,
    `- Responde en el idioma en el que te pregunta el usuario (normalmente español).`,
    `- Responde en texto plano y conciso: nada de markdown ni tablas con barras. Usa guiones para listas y formatea dinero como $1,234.56.`,
    `- Si te preguntan por datos a los que no tienes acceso (contraseñas, tokens, fotos/adjuntos), explica que están fuera de tu alcance.`,
    `- Solo puedes LEER: si te piden modificar, crear o borrar algo, explica que eso se hace desde las pantallas del CRM.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// El turno de chat: bucle manual de tool-use hasta que el modelo da su respuesta final.
// ---------------------------------------------------------------------------
async function chat(history) {
  const anthropic = getClient();
  if (!anthropic) {
    const err = new Error("El asistente no está configurado: falta ANTHROPIC_API_KEY en el servidor.");
    err.status = 503;
    throw err;
  }

  const schemaText = await getSchemaText();

  const messages = history.map((m) => ({ role: m.role, content: String(m.content) }));
  const queriesRun = [];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // El prompt (esquema incluido) es idéntico entre turnos y consultas: cachearlo baja el
      // costo de cada mensaje a una fracción.
      system: [{ type: "text", text: buildSystemPrompt(schemaText), cache_control: { type: "ephemeral" } }],
      tools: [SQL_TOOL],
      messages,
    });

    if (response.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: response.content });
      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        const sql = block.input && block.input.sql;
        console.log(`[assistant] SQL: ${String(sql).slice(0, 300)}`);
        const result = await executeSql(sql);
        queriesRun.push({ sql, purpose: (block.input && block.input.purpose) || null, error: result.error || null });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result),
          ...(result.error ? { is_error: true } : {}),
        });
      }
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    const reply = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return { reply: reply || "(sin respuesta)", queries: queriesRun };
  }

  return {
    reply: "No pude completar la consulta: se alcanzó el límite de pasos. Intenta una pregunta más específica.",
    queries: queriesRun,
  };
}

// _internal existe para poder probar el guardián de solo-lectura sin pasar por la API.
module.exports = { chat, _internal: { executeSql, getSchemaText } };
