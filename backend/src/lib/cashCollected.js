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

module.exports = { EFECTIVO_EN_MANO_DEL_TECNICO, esEfectivoEnMano };
