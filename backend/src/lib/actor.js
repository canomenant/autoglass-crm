// Quién hizo la operación, para el registro de auditoría.
//
// La identidad sale SIEMPRE del token verificado. Antes cada ruta la leía de
// `req.body.performedBy || req.query.performedBy`, que lo escribe el cliente: bastaba con
// mandar {"performedBy": "otra persona"} para que la aprobación de un lote de pagos quedara
// firmada a nombre de quien no la hizo — justo lo que un registro de auditoría existe para
// impedir. `req.user` lo pone requireAuth tras verificar la firma del JWT, así que no es
// elegible por quien llama.
function actorFrom(req) {
  return req.user?.name || req.user?.email || "Unknown";
}

module.exports = { actorFrom };
