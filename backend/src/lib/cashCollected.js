// Qué cobro del cliente es DINERO QUE EL TÉCNICO SE QUEDÓ EN LA MANO.
//
// Importa porque ese efectivo se le descuenta de su pago: él ya lo tiene. La condición vivía
// copiada en payableSync y en payments.store, y cualquiera de las dos que se corrigiera sola
// dejaba la otra mintiendo.
//
// La trampa: "Cash App" contiene la palabra "cash", y un ILIKE '%cash%' lo tragaba. Pero un pago
// por Cash App entra a la cuenta de la COMPAÑÍA, no al bolsillo del técnico — descontárselo es
// cobrarle dinero que nunca tocó. Eran 29 órdenes por $11,496.73, repartidas en 14 lotes, con
// $6,956.81 descontados de más (detectado por Antonio en Wo-4102, 3-sep-2026).
//
// Se conserva el ILIKE en vez de una igualdad exacta porque hay métodos compuestos legítimos
// —"Credit Card + Cash"— donde el técnico sí recibió efectivo. Lo único que se excluye es la
// aplicación que se llama igual.
//
// El patrón va SIN barras invertidas a propósito: un '\s' tiene que sobrevivir al literal de
// plantilla de JavaScript y al literal de cadena de SQL, y basta que uno de los dos se lo coma
// para que el filtro deje de excluir nada en silencio. 'cash ?app' dice lo mismo —con espacio o
// sin él— y no hay nada que escapar.
const EFECTIVO_EN_MANO_DEL_TECNICO = `
  w.payment ->> 'method' ILIKE '%cash%'
  AND w.payment ->> 'method' !~* 'cash ?app'`;

// La misma regla en JavaScript, para cuando hay que decidirlo sobre filas ya leídas y no dentro
// de una consulta. Las dos definiciones viven pegadas a propósito: separarlas es cómo empiezan a
// discrepar.
const esEfectivoEnMano = (metodo) => /cash/i.test(metodo || "") && !/cash ?app/i.test(metodo || "");


// CUÁNTO efectivo se quedó el técnico en una orden (alias w). Un cobro puede venir partido —
// Wo-2152: $158.42 tarjeta + $280 efectivo (Antonio, 6-sep-2026)— y entonces solo la parte en
// efectivo es suya; el total con método "Credit Card + Cash" la habría contado completa. Si el
// pago trae `splits`, manda el desglose; si no, la regla de arriba sobre el total. Menos lo que
// devolvió (cashComeback).
const EFECTIVO_MONTO_DEL_TECNICO = `
  (CASE WHEN jsonb_typeof(w.payment -> 'splits') = 'array' AND jsonb_array_length(w.payment -> 'splits') > 0
        THEN COALESCE((SELECT SUM(COALESCE(NULLIF(s ->> 'amount', '')::numeric, 0))
                         FROM jsonb_array_elements(w.payment -> 'splits') s
                        WHERE s ->> 'method' ILIKE '%cash%' AND s ->> 'method' !~* 'cash ?app'), 0)
        WHEN w.payment ->> 'method' ILIKE '%cash%' AND w.payment ->> 'method' !~* 'cash ?app'
        THEN COALESCE(NULLIF(w.payment ->> 'amount', '')::numeric, 0)
        ELSE 0 END)
  - COALESCE(NULLIF(w.payment ->> 'cashComeback', '')::numeric, 0)`;

// La misma cuenta en JavaScript sobre un payment ya leído.
const efectivoEnManoMonto = (payment) => {
  if (!payment) return 0;
  const splits = Array.isArray(payment.splits) ? payment.splits : [];
  const bruto = splits.length
    ? splits.filter((s) => esEfectivoEnMano(s.method)).reduce((a, s) => a + Number(s.amount || 0), 0)
    : (esEfectivoEnMano(payment.method) ? Number(payment.amount || 0) : 0);
  return Math.round((bruto - Number(payment.cashComeback || 0)) * 100) / 100;
};

module.exports = { EFECTIVO_EN_MANO_DEL_TECNICO, esEfectivoEnMano, EFECTIVO_MONTO_DEL_TECNICO, efectivoEnManoMonto };
