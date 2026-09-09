"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getPayableParties, getPayablePending, getPayableNotes, createPayablePayout, getPaymentMethods, setObligationAmount } from "@/lib/api";
import { markPaymentReady, approvePayment, payPayment } from "@/lib/api";
import { getTechPartsPending, linkPayoutObligations, createDebitNote } from "@/lib/api";
import { getStatements, getStatementSelection, applyStatements } from "@/lib/api";
import { money } from "./OrderSummaryUI";

// Una sola vista para los tres tipos. El modelo lo permite porque payable es una sola tabla: la
// diferencia entre pagarle a un tecnico, a un agente o a un distribuidor es el `kind` y los tres
// terminos extra que solo aplican al tecnico.
//
// Deliberadamente NO reusa PaymentBatchWizard: aquel selecciona work orders, y la deuda es por
// orden Y por parte — 490 work orders tienen mas de una obligacion de distribuidor y 44 le deben
// a dos distribuidores distintos, algo que una lista de work orders no puede expresar.

// Aquí vivía una copia de la regla de "qué cobro es efectivo del técnico". Se quitó: falló dos
// veces por su cuenta —contaba "Cash App" y sumaba entero un cobro partido— y las dos veces el
// backend ya tenía la respuesta correcta. La regla vive SOLO en lib/cashCollected.js y llega
// calculada en `customerCashInHand`. El ámbar de esta pantalla sale de esa cifra, no de leer el
// texto del método.

const AJUSTES_TECNICO = [
  { key: "bonus", signo: +1 },
  { key: "deductions", signo: -1 },
  { key: "cashAdvance", signo: -1 },
  { key: "partsDeduction", signo: -1 },
  { key: "partsReturn", signo: +1 },
];

const BONUS_TYPES = ["CC_HANDLING", "SPIFF", "REVIEWS", "ITEMIZED_INVOICE", "ADMIN_FEE", "CALLING_SERVICE", "INSURANCE_PROCESSED", "TRIP_CANCELLED", "PRIOR_BALANCE", "SALARY", "WARRANTY", "OTHER"];

// El lote nace en Pending y sube de escalón hasta Paid. Tenerlo aquí como lista permite que un
// botón diga "llévalo hasta aquí" y la función recorra sola los pasos que falten: pulsar Pagado
// sobre un lote recién creado hace las tres llamadas seguidas. El backend valida cada salto igual
// que antes (markReady sólo desde Pending, approve sólo desde Ready, pay sólo desde Approved), así
// que esto no se salta ningún control: sólo evita ir a la pantalla del lote a dar tres clics.
const CADENA_ESTADOS = ["Pending", "Ready For Payment", "Approved", "Paid"];

const inputClass =
  "w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow";

export default function PayableBalances({ kind, onChanged, historicalCount = 0, creditedCount = 0, creditedAmount = 0 }) {
  const t = useTranslations("payable");
  const tc = useTranslations("common");
  const tp = useTranslations("payments");
  const ts = useTranslations("statements");
  const tn = useTranslations("notes");

  const [parties, setParties] = useState([]);
  const [party, setParty] = useState(null);
  const [obligations, setObligations] = useState([]);
  const [selected, setSelected] = useState(new Set());
  // Distribuidores marcados en la lista para pagarlos en UN solo lote (Dist-0244 pagó a Mygrant
  // Austin, Carrolton e Irving juntos — el modelo siempre lo permitió, la vista no).
  const [marcadas, setMarcadas] = useState(new Set());
  // Notas de esa parte todavia sin netear. Un credito baja lo que se paga y un debito lo sube.
  const [notes, setNotes] = useState([]);
  const [selectedNotes, setSelectedNotes] = useState(new Set());
  const [bonos, setBonos] = useState([]);
  const [nuevoBono, setNuevoBono] = useState({ bonusType: "", amount: "", note: "" });
  const [ajustes, setAjustes] = useState({ bonus: 0, deductions: 0, cashAdvance: 0, partsDeduction: 0, partsReturn: 0 });
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [methods, setMethods] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // El lote recién creado se queda aquí para que la barra de abajo -donde se acaba de pulsar-
  // confirme que existe y deje avanzarlo sin salir de la pantalla. Antes el único aviso se pintaba
  // arriba del todo, fuera de la vista después de una lista larga de órdenes: parecía que el botón
  // no hacía nada (Antonio, 9-sep-2026).
  const [lote, setLote] = useState(null);
  const [avanzando, setAvanzando] = useState(false);
  // Piezas que el técnico compró de su bolsa y notas de débito que se le cargan. Las dos cosas
  // vivían sólo en la pantalla del lote ya creado: había que crear el pago, abrirlo, marcarlas y
  // volver. Aquí se deciden antes, que es cuando se está mirando lo que se le debe.
  const [techParts, setTechParts] = useState([]);
  const [techPartsSel, setTechPartsSel] = useState(new Set());
  const [verTodasPartes, setVerTodasPartes] = useState(false);
  const [nuevaNota, setNuevaNota] = useState(null);
  const [guardandoNota, setGuardandoNota] = useState(false);
  // Statements del distribuidor pendientes de pago, y lo que arrastra la selección.
  const [statements, setStatements] = useState([]);
  const [statementsSel, setStatementsSel] = useState(new Set());
  const [selStatements, setSelStatements] = useState(null);

  const esTecnico = kind === "TECH";
  // Solo el lote de distribuidor cubre varias partes a la vez: el de técnico es de una persona
  // por regla del negocio, y el de agente ya agrupa por compañía.
  const multiSel = kind === "DISTRIBUTOR";

  const loadParties = useCallback(() => {
    getPayableParties(kind)
      // Por el NETO, no por la mano de obra: Ricardo Santos y Jesus Campos se parecen en labor
      // ($3,506 y $3,240) y en lo que de verdad se les debe no ($3,276 contra $307). El servidor
      // ordena por el bruto, que es lo correcto para agentes y distribuidores.
      .then((r) => {
        const lista = r.parties || [];
        setParties(lista[0]?.netAmount === undefined ? lista : [...lista].sort((a, b) => b.netAmount - a.netAmount));
      })
      .catch((e) => setError(e.message));
  }, [kind]);

  useEffect(() => { loadParties(); }, [loadParties]);
  useEffect(() => { getPaymentMethods().then(setMethods).catch(() => {}); }, []);

  // Las obligaciones y notas de la vista abierta. `p.multi` trae los nombres cuando el lote
  // cubre varios distribuidores; con uno solo es la lista de siempre.
  function cargarPendientes(p) {
    const nombres = p.multi || [p.party];
    Promise.all(nombres.map((n) => getPayablePending(kind, n).then((r) => r.obligations || [])))
      .then((r) => setObligations(r.flat()))
      .catch((e) => setError(e.message));
    Promise.all(nombres.map((n) => getPayableNotes(kind, n).then((r) => r.notes || []).catch(() => [])))
      .then((r) => setNotes(r.flat()))
      .catch(() => setNotes([]));
  }

  function abrir(p) {
    setParty(p);
    setSelected(new Set());
    setSelectedNotes(new Set());
    // Los bonos capturados son de la parte que se estaba viendo: cambiar de parte y arrastrarlos
    // le daria a otro un bono que no le corresponde.
    setBonos([]);
    setNuevoBono({ bonusType: "", amount: "", note: "" });
    setError("");
    setLote(null);
    setTechPartsSel(new Set());
    setVerTodasPartes(false);
    setNuevaNota(null);
    setAjustes({ bonus: 0, deductions: 0, cashAdvance: 0, partsDeduction: 0, partsReturn: 0 });
    setStatementsSel(new Set());
    setSelStatements(null);
    setCashTocado(false);
    cargarStatements(p);
    cargarTechParts(p, false);
    cargarPendientes(p);
  }

  // Las piezas pendientes de devolverle a ese técnico. Sólo TECH: un agente o un distribuidor no
  // compran piezas de su bolsa.
  const cargarTechParts = useCallback((p, todas) => {
    if (kind !== "TECH" || !p) return setTechParts([]);
    getTechPartsPending(p.party, todas)
      .then((r) => setTechParts(r.techParts || []))
      .catch(() => setTechParts([]));
  }, [kind]);

  // Los statements que ese distribuidor tiene sin saldar. Solo aplica a distribuidores: técnicos
  // y agentes no facturan.
  function cargarStatements(p) {
    if (kind !== "DISTRIBUTOR" || !p) return setStatements([]);
    const nombres = p.parties || [p.party];
    Promise.all(nombres.map((n) => getStatements({ distributor: n, pending: "true", limit: 200 })))
      .then((res) => {
        const todos = res.flatMap((r) => r.statements || []);
        // Un mismo número puede venir de dos consultas si el nombre de una sucursal contiene a otra.
        const unicos = [...new Map(todos.map((s) => [s.id, s])).values()];
        setStatements(unicos.sort((a, b) => String(a.dueDate || "").localeCompare(String(b.dueDate || ""))));
      })
      .catch(() => setStatements([]));
  }

  // Un solo lote para todos los distribuidores marcados: se abren juntos, la tabla dice de
  // quién es cada obligación, y vienen TODAS pre-seleccionadas — quien marca tres sucursales
  // viene a pagarles todo; destildar la excepción es menos trabajo que tildar cientos.
  function abrirMarcadas() {
    const list = parties.filter((p) => marcadas.has(p.party));
    if (!list.length) return;
    const p = {
      party: list.map((x) => x.party).join(", "),
      pendingAmount: list.reduce((a, x) => a + Number(x.pendingAmount || 0), 0),
      pendingCount: list.reduce((a, x) => a + Number(x.pendingCount || 0), 0),
      multi: list.map((x) => x.party),
    };
    setParty(p);
    setSelectedNotes(new Set());
    setBonos([]);
    setNuevoBono({ bonusType: "", amount: "", note: "" });
    setError("");
    setLote(null);
    setTechPartsSel(new Set());
    setVerTodasPartes(false);
    setNuevaNota(null);
    setAjustes({ bonus: 0, deductions: 0, cashAdvance: 0, partsDeduction: 0, partsReturn: 0 });
    setStatementsSel(new Set());
    setSelStatements(null);
    setCashTocado(false);
    cargarStatements({ ...p, parties: p.multi });
    const nombres = p.multi;
    Promise.all(nombres.map((n) => getPayablePending(kind, n).then((r) => r.obligations || [])))
      .then((r) => {
        const obs = r.flat();
        setObligations(obs);
        setSelected(new Set(obs.map((o) => o.id)));
      })
      .catch((e) => setError(e.message));
    Promise.all(nombres.map((n) => getPayableNotes(kind, n).then((r) => r.notes || []).catch(() => [])))
      .then((r) => setNotes(r.flat()))
      .catch(() => setNotes([]));
  }

  function marcar(nombre) {
    setMarcadas((prev) => {
      const next = new Set(prev);
      next.has(nombre) ? next.delete(nombre) : next.add(nombre);
      return next;
    });
  }

  const subtotal = useMemo(
    () => obligations.filter((o) => selected.has(o.id)).reduce((a, o) => a + Number(o.amount || 0), 0),
    [obligations, selected]
  );
  // Mismo signo que recomputeAmount() en el backend: debito suma, credito resta.
  const notasNeto = useMemo(
    () => notes.filter((n) => selectedNotes.has(n.id))
      .reduce((a, n) => a + (n.noteType === "DEBIT" ? 1 : -1) * Number(n.amount || 0), 0),
    [notes, selectedNotes]
  );
  // El bono del lote es la suma de sus renglones, igual que despues de creado. Se captura aqui
  // porque es cuando se sabe por que se da: "consiguio la tarjeta", "reseñas", "spiff".
  // Cuando la parte agrupa a varias personas — una compania de agentes — hace falta decir de quien
  // es cada renglon. Con una sola persona la columna seria el mismo nombre repetido.
  const hayVarios = useMemo(() => new Set(obligations.map((o) => o.party).filter(Boolean)).size > 1, [obligations]);

  // El efectivo que el técnico ya se quedó: lo cobrado en las órdenes SELECCIONADAS con método
  // Cash (menos su comeback). Es la misma regla con la que el detalle del pago deriva su línea
  // de efectivo — aquí se calcula en vivo para que el lote nazca cuadrado, no para corregirlo
  // después. Distinct por orden: dos obligaciones de la misma orden no duplican su cobro.
  const efectivoDerivado = useMemo(() => {
    if (kind !== "TECH") return 0;
    const vistos = new Set();
    let suma = 0;
    for (const o of obligations) {
      if (!selected.has(o.id)) continue;
      const wo = o.workOrderNo || `id:${o.id}`;
      if (vistos.has(wo)) continue;
      vistos.add(wo);
      // La cifra viene del servidor, que la calcula con la única regla que existe
      // (lib/cashCollected). Aquí había una copia suelta que ya falló dos veces: contaba "Cash App"
      // como efectivo del técnico (lote 979 de Pedro, Wo-4109 $410) y sumaba el cobro ENTERO de un
      // pago partido (Wo-3844: $308.51 en vez de los $220 en efectivo). Volver a decidirlo en la
      // pantalla es exactamente cómo nacieron los dos.
      suma += Number(o.customerCashInHand || 0);
    }
    return Math.round(suma * 100) / 100;
  }, [kind, obligations, selected]);

  // El campo de efectivo sigue al derivado mientras el usuario no lo toque; si lo teclea, manda
  // su número (puede saber de un cobro que la orden no registró) y el derivado queda de aviso.
  const [cashTocado, setCashTocado] = useState(false);
  useEffect(() => {
    if (kind !== "TECH" || cashTocado) return;
    setAjustes((a) => (Number(a.cashAdvance) === efectivoDerivado ? a : { ...a, cashAdvance: efectivoDerivado }));
  }, [kind, efectivoDerivado, cashTocado]);

  const conCobro = useMemo(() => obligations.some((o) => o.customerMethod || Number(o.customerPaidAmount) > 0), [obligations]);

  // El flujo real: se abre la orden en otra pestaña desde "View / Edit", se corrige el labor,
  // y se vuelve aquí. Al recuperar el foco se recargan los montos SIN tocar lo marcado — las
  // casillas van por id de obligación, que no cambia con la edición.
  useEffect(() => {
    if (!party) return;
    const alVolver = () => {
      const nombres = party.parties || party.multi || [party.party];
      Promise.all(nombres.map((n) => getPayablePending(kind, n).then((r) => r.obligations || [])))
        .then((r) => setObligations(r.flat()))
        .catch(() => {});
    };
    window.addEventListener("focus", alVolver);
    return () => window.removeEventListener("focus", alVolver);
  }, [party, kind]);

  // Editar el labor SIN salir del panel: clic en el monto, teclear, Enter. Escribe la obligación
  // y la cabecera de la orden en un paso (setPendingAmount); con varios técnicos el servidor lo
  // rechaza y ahí sí se abre la orden.
  const [editando, setEditando] = useState(null);
  const [montoEdit, setMontoEdit] = useState("");

  // Buscar dentro de las pendientes: con 60+ órdenes, encontrar UNA (el viaje del trabajo
  // cancelado de Wo-3927) era ir a ciegas por el scroll. Filtra sin tocar lo ya marcado.
  const [filtroObs, setFiltroObs] = useState("");
  // Lista de obligaciones abierta a pantalla casi completa.
  const [listaAmplia, setListaAmplia] = useState(false);
  const obligacionesVisibles = useMemo(() => {
    const q = filtroObs.trim().toLowerCase();
    if (!q) return obligations;
    return obligations.filter((o) =>
      [o.workOrderNo, o.customerName, o.party, o.partNumber].some((v) => String(v || "").toLowerCase().includes(q))
    );
  }, [obligations, filtroObs]);

  async function guardarMonto(o) {
    const v = Number(montoEdit);
    if (!(v >= 0)) return setEditando(null);
    try {
      const r = await setObligationAmount(o.id, v, "TECH");
      setObligations((prev) => prev.map((x) => (x.id === o.id ? { ...x, amount: r.amount } : x)));
      setEditando(null);
    } catch (e) {
      setError(e.message);
      setEditando(null);
    }
  }

  const bono = useMemo(() => bonos.reduce((a, b) => a + Number(b.amount || 0), 0), [bonos]);

  // Lo que se le devuelve por las piezas marcadas. Va aparte del campo "+ Partes devueltas" a
  // propósito: al enlazarlas, el backend recalcula ese renglón como la suma de las obligaciones de
  // pieza del lote (baseSigueObligaciones), así que un número tecleado a mano se perdería. Por eso
  // el campo se bloquea mientras haya piezas marcadas: en pantalla y en el servidor manda la misma
  // cifra.
  const partesDevueltas = useMemo(
    () => techParts.filter((p) => techPartsSel.has(p.id)).reduce((a, p) => a + Number(p.amount || 0), 0),
    [techParts, techPartsSel]
  );

  const total = useMemo(() => {
    const conAjustes = esTecnico
      ? AJUSTES_TECNICO.reduce((a, x) => a + x.signo * Number(ajustes[x.key] || 0), subtotal)
      : subtotal - Number(ajustes.deductions || 0);
    return conAjustes + bono + notasNeto + partesDevueltas;
  }, [subtotal, ajustes, esTecnico, notasNeto, bono, partesDevueltas]);

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleNote(id) {
    setSelectedNotes((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // --- pagar por statement ---
  // Al distribuidor no se le paga por trabajos sueltos sino por sus facturas: él manda un
  // statement y uno lo salda completo. Elegir el statement marca solo las órdenes que lo componen
  // y las notas que nacieron o se aplican en él, que es como Antonio lo hace en su Excel.
  function toggleStatement(id) {
    setStatementsSel((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // Cada cambio de selección vuelve a preguntar qué arrastra: es el servidor quien sabe qué
  // obligaciones siguen pendientes y qué notas no se han aplicado.
  useEffect(() => {
    if (kind !== "DISTRIBUTOR" || !statementsSel.size) {
      setSelStatements(null);
      return;
    }
    let vivo = true;
    getStatementSelection([...statementsSel])
      .then((r) => {
        if (!vivo) return;
        setSelStatements(r);
        // Se SUMAN a lo ya marcado a mano: quitar la selección previa borraría trabajo del usuario.
        setSelected((prev) => new Set([...prev, ...r.payableIds]));
        setSelectedNotes((prev) => new Set([...prev, ...r.noteIds]));
      })
      .catch(() => vivo && setSelStatements(null));
    return () => {
      vivo = false;
    };
  }, [kind, statementsSel]);

  async function crearLote() {
    if (!selected.size || saving) return;
    // Un lote en negativo es legítimo -el técnico trae más efectivo del que se le debe- pero no
    // puede pasar en silencio: ese saldo queda a favor de la empresa y NADIE lo cobra solo, porque
    // no se arrastra al siguiente pago. Avisa y deja seguir; la decisión es de quien paga
    // (Antonio eligió esto sobre bloquearlo, 9-sep-2026).
    if (total < 0 && !confirm(t("negativeBatchWarning", { amount: money(Math.abs(total)), party: party?.party || "" }))) return;
    setSaving(true);
    setError("");
    try {
      const payout = await createPayablePayout(kind, {
        payableIds: [...selected],
        noteIds: [...selectedNotes],
        paymentMethod,
        paymentDate,
        ...(esTecnico
          // Con piezas marcadas el renglón lo pone el enlace de abajo, no este número: mandar los
          // dos haría que el segundo pisara al primero sin decirlo.
          ? { ...ajustes, partsReturn: techPartsSel.size ? 0 : ajustes.partsReturn }
          : { deductions: Number(ajustes.deductions || 0) }),
        bonusItems: bonos,
      });
      // Las piezas del técnico son obligaciones de distribuidor ("Tech Part"), así que no pueden
      // viajar en payableIds -el lote las rechazaría por tipo-: se enlazan después, por el mismo
      // camino que usa la pantalla del lote. Enlazarlas CIERRA la obligación y el backend recalcula
      // "+ Partes devueltas" con su suma.
      let creado = payout;
      if (techPartsSel.size) {
        try {
          creado = await linkPayoutObligations(payout.id, [...techPartsSel]);
        } catch (e) {
          setError(e.message);
        }
      }
      // Los statements elegidos quedan saldados por este lote. Va después de crear el pago
      // porque necesita su id, y aparte del try principal: si esto falla, el pago ya existe y
      // lo que corresponde es avisar, no perderlo.
      if (statementsSel.size) {
        try {
          await applyStatements([...statementsSel], payout.id);
        } catch (e) {
          setError(ts("applyFailed", { message: e.message }));
        }
      }
      setLote(creado);
      // Recargar: las obligaciones incluidas ya no estan pendientes, y las notas quedaron neteadas.
      setSelected(new Set());
      setSelectedNotes(new Set());
      setStatementsSel(new Set());
      setTechPartsSel(new Set());
      setSelStatements(null);
      cargarStatements(party);
      cargarTechParts(party, verTodasPartes);
      setMarcadas(new Set());
      loadParties();
      onChanged?.();
      cargarPendientes(party);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function toggleTechPart(id) {
    setTechPartsSel((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // La nota nace suelta (sin lote) y entra a este pago al quedar marcada abajo: es el mismo camino
  // que ya seguía una nota creada desde el menú de notas, sólo que sin salir de aquí ni volver a
  // teclear a quién se le carga. Un débito de técnico baja lo que se le paga — el backend lo suma a
  // "− Partes cobradas al técnico", no al total del lote.
  async function guardarNota() {
    if (!party || !Number(nuevaNota?.amount) || guardandoNota) return;
    setGuardandoNota(true);
    setError("");
    try {
      const nota = await createDebitNote({
        entityType: kind === "TECH" ? "TECHNICIAN" : kind,
        entityName: party.party,
        amount: Number(nuevaNota.amount),
        reason: nuevaNota.reason || "",
      });
      setNuevaNota(null);
      // Recargar la lista y dejarla ya marcada: se acaba de crear para este pago.
      const nombres = party.multi || [party.party];
      const listas = await Promise.all(nombres.map((n) => getPayableNotes(kind, n).then((r) => r.notes || []).catch(() => [])));
      setNotes(listas.flat());
      if (nota?.id) setSelectedNotes((prev) => new Set([...prev, nota.id]));
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardandoNota(false);
    }
  }

  // Sube el lote recién creado hasta el estado pedido, dando los saltos que hagan falta. El corte
  // por `siguiente === anterior` es la red: si el servidor devolviera un estado que no avanza, se
  // para en vez de quedarse llamando en círculo.
  async function avanzarLote(hasta) {
    if (!lote || avanzando) return;
    setAvanzando(true);
    setError("");
    let actual = lote;
    try {
      while (CADENA_ESTADOS.indexOf(actual.status) < CADENA_ESTADOS.indexOf(hasta)) {
        const anterior = actual.status;
        const siguiente = CADENA_ESTADOS[CADENA_ESTADOS.indexOf(anterior) + 1];
        if (siguiente === "Ready For Payment") actual = await markPaymentReady(actual.id);
        else if (siguiente === "Approved") actual = await approvePayment(actual.id);
        else actual = await payPayment(actual.id, { paymentMethod, paymentDate });
        if (actual.status === anterior) break;
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLote(actual);
      setAvanzando(false);
      // Un lote pagado cambia los saldos de la portada y de las solapas.
      loadParties();
      onChanged?.();
    }
  }

  const totalPendiente = parties.reduce((a, p) => a + p.pendingAmount, 0);
  // El neto de la lista: casi la mitad de lo que parecía deuda con los técnicos es efectivo que
  // ellos ya traen encima. Sólo se enseña cuando difiere del bruto, para no repetir la misma cifra.
  const hayNeto = parties.some((p) => p.netAmount !== undefined);
  const totalNeto = hayNeto ? Math.round(parties.reduce((a, p) => a + p.netAmount, 0) * 100) / 100 : totalPendiente;

  if (!party) {
    return (
      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-semibold dark:text-gray-100">{t(`title.${kind}`)}</h2>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {hayNeto && Math.abs(totalNeto - totalPendiente) > 0.005 ? (
              <>
                <span className="line-through opacity-60">{money(totalPendiente)}</span>{" "}
                <span className="font-semibold text-gray-700 dark:text-gray-200">{money(totalNeto)}</span>{" "}
                {t("netToPay")}
              </>
            ) : (
              t("totalPending", { amount: money(totalPendiente), count: parties.reduce((a, p) => a + p.pendingCount, 0) })
            )}
          </span>
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400 mb-2">{error}</p>}
        {parties.length === 0 && <p className="text-sm text-gray-400">{t("noBalances")}</p>}
        {historicalCount > 0 && (
          /* Una obligacion de $0 es registro historico, no deuda: se conserva pero no se cobra. */
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">{t("historicalNote", { count: historicalCount })}</p>
        )}
        {creditedCount > 0 && (
          /* Vidrio roto que el distribuidor abono con nota de credito: ya no se le debe. Se
             enuncia igual que las de $0 para que el saldo no baje sin razon visible. */
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">
            {t("creditedNote", { count: creditedCount, amount: money(creditedAmount) })}
          </p>
        )}
        {/* La barra de acción vive ARRIBA y pegajosa: con 30 distribuidores, ponerla solo al
            final de la lista la dejaba fuera de pantalla y nadie encontraba cómo continuar. */}
        {multiSel && marcadas.size > 0 && (
          <div className="sticky top-0 z-10 flex items-center justify-between bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-900 rounded-lg px-3 py-2 mb-2">
            <span className="text-sm text-blue-900 dark:text-blue-200">
              {t("partiesMarked", { count: marcadas.size })} ·{" "}
              <span className="font-semibold tabular-nums">
                {money(parties.filter((p) => marcadas.has(p.party)).reduce((a, p) => a + Number(p.pendingAmount || 0), 0))}
              </span>
            </span>
            <button
              type="button"
              onClick={abrirMarcadas}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-1.5 text-sm"
            >
              {t("paySelected", { count: marcadas.size })} →
            </button>
          </div>
        )}
        <div className="divide-y dark:divide-gray-800">
          {parties.map((p) => (
            <div key={p.party} className="flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-800 px-2 rounded">
              {/* Marcar varios distribuidores y pagarlos en UN lote (una tarjeta cubre varias
                  sucursales). El clic en el renglon sigue abriendo ese solo, como siempre. */}
              {multiSel && (
                <input
                  type="checkbox"
                  className="w-4 h-4"
                  checked={marcadas.has(p.party)}
                  onChange={() => marcar(p.party)}
                />
              )}
              <button
                type="button"
                onClick={() => abrir(p)}
                className="flex-1 flex items-center justify-between py-2 text-left"
              >
                <span className="text-sm dark:text-gray-100">
                  {p.party}
                  {/* Avisa que ese renglon paga a varias personas a la vez: Digiclique cubre a David
                      Cruz, Ashley Diaz y Kayla Lopez en un solo lote. */}
                  {p.memberCount > 1 && (
                    <span className="text-xs text-gray-400 ml-2">{t("membersInside", { count: p.memberCount })}</span>
                  )}
                </span>
                <span className="flex items-center gap-4">
                  <span className="text-xs text-gray-400">{t("obligations", { count: p.pendingCount })}</span>
                  {/* El desglose del saldo del técnico: la mano de obra sola decía que a Danilo se
                      le debían $820 cuando trae $945 en efectivo. Cada término se dibuja sólo si
                      no es cero — una fila de guiones no dice nada. */}
                  {p.netAmount !== undefined && (
                    <span className="hidden sm:flex items-center gap-3 text-xs tabular-nums">
                      <span className="text-gray-400">{money(p.pendingAmount)}</span>
                      {p.techParts > 0 && <span className="text-green-600 dark:text-green-400">+ {money(p.techParts)}</span>}
                      {p.cashInHand > 0 && <span className="text-red-600 dark:text-red-400">− {money(p.cashInHand)}</span>}
                      {p.debitNotes > 0 && <span className="text-red-600 dark:text-red-400">− {money(p.debitNotes)}</span>}
                      {p.creditNotes > 0 && <span className="text-green-600 dark:text-green-400">+ {money(p.creditNotes)}</span>}
                    </span>
                  )}
                  <span className={`text-sm font-medium tabular-nums ${p.netAmount < 0 ? "text-red-600 dark:text-red-400" : "dark:text-gray-100"}`}>
                    {money(p.netAmount !== undefined ? p.netAmount : p.pendingAmount)}
                    {p.netAmount < 0 && <span className="block text-[10px] font-normal">{t("owesUs")}</span>}
                  </span>
                </span>
              </button>
            </div>
          ))}
        </div>
        {multiSel && marcadas.size > 0 && (
          <div className="flex items-center justify-between border-t dark:border-gray-800 mt-3 pt-3">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {t("partiesMarked", { count: marcadas.size })} ·{" "}
              <span className="font-medium tabular-nums dark:text-gray-100">
                {money(parties.filter((p) => marcadas.has(p.party)).reduce((a, p) => a + Number(p.pendingAmount || 0), 0))}
              </span>
            </span>
            <button
              type="button"
              onClick={abrirMarcadas}
              className="bg-gray-900 hover:bg-gray-800 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm"
            >
              {t("paySelected", { count: marcadas.size })}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <button type="button" onClick={() => setParty(null)} className="text-xs text-blue-600 dark:text-blue-400 mb-1">
            ← {t("backToList")}
          </button>
          <h2 className="text-sm font-semibold dark:text-gray-100">{party.party}</h2>
        </div>
        <span className="text-sm text-gray-500 dark:text-gray-400">{money(party.pendingAmount)}</span>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400 mb-2">{error}</p>}

      {/* Pagar por statement: elegir la factura marca sus órdenes y sus notas de una vez. */}
      {kind === "DISTRIBUTOR" && statements.length > 0 && (
        <div className="mb-3 rounded-lg border border-gray-200 dark:border-gray-800">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 dark:border-gray-800 px-3 py-2">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {ts("selectTitle", { count: statements.length })}
            </span>
            {statementsSel.size > 0 && (
              <button
                type="button"
                onClick={() => setStatementsSel(new Set())}
                className="text-xs text-blue-600 dark:text-blue-400"
              >
                {ts("clearSelection")}
              </button>
            )}
          </div>
          <div className="max-h-44 overflow-y-auto divide-y dark:divide-gray-800">
            {statements.map((s) => (
              <label
                key={s.id}
                className="flex cursor-pointer items-center gap-3 px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800/60"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={statementsSel.has(s.id)}
                  onChange={() => toggleStatement(s.id)}
                />
                <span className="font-mono text-xs dark:text-gray-200">{s.invoiceNumber}</span>
                {s.isCreditMemo && (
                  <span className="rounded bg-emerald-100 px-1.5 text-[10px] uppercase text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
                    {ts("creditMemo")}
                  </span>
                )}
                <span className="text-xs text-gray-400">{s.branch || s.distributor}</span>
                <span className={`ml-auto text-xs ${(s.daysOverdue ?? -1) > 0 ? "text-red-600 dark:text-red-400" : "text-gray-400"}`}>
                  {s.dueDate || "—"}
                </span>
                <span className="w-24 text-right tabular-nums dark:text-gray-100">{money(s.balance)}</span>
              </label>
            ))}
          </div>
          {selStatements && (
            <div className="border-t border-gray-100 dark:border-gray-800 px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
              {ts("selectionSummary", {
                statements: selStatements.statements.length,
                orders: selStatements.workOrders.length,
                notes: selStatements.noteIds.length,
                amount: money(selStatements.totals.statements),
              })}
              {selStatements.gaps.length > 0 && (
                <span className="ml-2 text-amber-600 dark:text-amber-400">
                  {ts("selectionGaps", {
                    count: selStatements.gaps.length,
                    amount: money(selStatements.gaps.reduce((a, g) => a + g.amount, 0)),
                  })}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      <input
        type="search"
        value={filtroObs}
        onChange={(e) => setFiltroObs(e.target.value)}
        placeholder={t("searchObligations")}
        className="mb-2 w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
      />
      {/* La lista cabía en 288px: con un lote de doce órdenes se veían cinco y había que rodar a
          ciegas para saber qué se estaba marcando (pedido de Antonio, 9-sep-2026). Ahora arranca
          al doble y el botón la abre a pantalla casi completa. */}
      <div className="mb-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
        <span>
          {obligacionesVisibles.length} {obligacionesVisibles.length === 1 ? t("obligation") : t("obligations")}
        </span>
        <button
          type="button"
          onClick={() => setListaAmplia((v) => !v)}
          className="rounded px-2 py-1 font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
        >
          {listaAmplia ? t("collapseList") : t("expandList")}
        </button>
      </div>
      <div className={`${listaAmplia ? "max-h-[75vh]" : "max-h-[36rem]"} overflow-y-auto border dark:border-gray-800 rounded-lg mb-3`}>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800 text-xs text-gray-500 dark:text-gray-400 sticky top-0">
            <tr>
              <th className="w-8 p-2">
                {/* Marcar/desmarcar todas: al pagar varios distribuidores lo normal es llevarse
                    todo lo pendiente, y clicar una por una entre cientos no es un plan. */}
                <input
                  type="checkbox"
                  className="w-4 h-4"
                  checked={obligacionesVisibles.length > 0 && obligacionesVisibles.every((o) => selected.has(o.id))}
                  onChange={() =>
                    setSelected(obligacionesVisibles.every((o) => selected.has(o.id)) ? new Set([...selected].filter((id) => !obligacionesVisibles.some((o) => o.id === id))) : new Set([...selected, ...obligacionesVisibles.map((o) => o.id)]))
                  }
                />
              </th>
              <th className="text-left p-2 font-medium">{t("workOrder")}</th>
              {hayVarios && (
                <th className="text-left p-2 font-medium">{kind === "AGENT" ? t("whoseCommission") : t("whoseParty")}</th>
              )}
              <th className="text-left p-2 font-medium">{tc("date")}</th>
              <th className="text-left p-2 font-medium">{t("customer")}</th>
              <th className="text-left p-2 font-medium">{tp("jobType")}</th>
              {conCobro && <th className="text-left p-2 font-medium">{tp("customerPayment")}</th>}
              <th className="text-right p-2 font-medium">{tc("amount")}</th>
              <th className="w-20 p-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-gray-800">
            {obligacionesVisibles.map((o) => (
              <tr key={o.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/60">
                <td className="p-2">
                  <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggle(o.id)} className="w-4 h-4" />
                </td>
                <td className="p-2 dark:text-gray-100">
                  {o.workOrderNo || "—"}
                  {/* El viaje del trabajo cancelado se paga igual (el técnico fue): la etiqueta
                      dice POR QUÉ esta orden está aquí sin instalación detrás. */}
                  {o.workOrderStatus === "Cancelled" && (
                    <span className="ml-1.5 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-red-700 dark:bg-red-900/50 dark:text-red-300">
                      {t("cancelledTrip")}
                    </span>
                  )}
                </td>
                {/* De quien es la comision. Dentro de una compania con varios agentes, sin esto la
                    lista no diria a quien pertenece cada trabajo. */}
                {hayVarios && <td className="p-2 text-gray-500 dark:text-gray-400">{o.party || "—"}</td>}
                <td className="p-2 text-gray-500 dark:text-gray-400">{o.workDate ? String(o.workDate).slice(0, 10) : "—"}</td>
                <td className="p-2 text-gray-500 dark:text-gray-400 truncate max-w-[16rem]">
                  {o.customerName}
                  {/* El carro debajo del cliente, igual que en el detalle del lote: es lo que
                      permite reconocer de qué trabajo se trata cuando el nombre no dice nada. */}
                  {o.vehicle && <span className="block text-xs text-gray-400 dark:text-gray-500">{o.vehicle}</span>}
                </td>
                {/* Qué se hizo. Una orden con varios trabajos los trae separados por comas; se
                    parten en líneas para que no estiren la columna. Debajo, el número de parte
                    cuando la obligación lo tiene (las de distribuidor siempre). */}
                <td className="p-2 text-gray-500 dark:text-gray-400 max-w-[14rem]">
                  {o.jobType
                    ? o.jobType.split(",").map((j) => j.trim()).filter(Boolean).map((j) => (
                        <span key={j} className="block truncate text-xs">{j}</span>
                      ))
                    : <span className="text-xs text-gray-300 dark:text-gray-600">—</span>}
                  {o.partNumber && (
                    <span className="block truncate text-[11px] text-gray-400 dark:text-gray-500">{o.partNumber}</span>
                  )}
                </td>
                {/* Cómo pagó el cliente. En el lote de técnico, las de Cash son las que alimentan
                    el efectivo derivado — verlas aquí es ver de dónde sale ese número. */}
                {conCobro && (
                  <td className="p-2 whitespace-nowrap">
                    {o.customerMethod || Number(o.customerPaidAmount) > 0 ? (
                      <>
                        {/* Un cobro partido se enseña renglón por renglón, con el importe de cada
                            método: "$308.51 / We Have CC In File + Cash" en ámbar hacía creer que
                            el técnico traía los $308.51, cuando lo suyo eran $220 (Wo-3844). El
                            ámbar es sólo para el efectivo, y sale de la cifra del servidor. */}
                        <span className={`text-xs ${o.customerPaid ? (Number(o.customerCashInHand) > 0 ? "font-medium text-amber-600 dark:text-amber-400" : "text-green-700 dark:text-green-400") : "text-red-600 dark:text-red-400"}`}>
                          {Number(o.customerPaidAmount) > 0 ? money(Number(o.customerPaidAmount)) : ""} {o.customerPaid ? "" : tp("customerUnpaid")}
                        </span>
                        {o.customerSplits?.length > 1 ? (
                          o.customerSplits.map((s, i) => {
                            const esCash = /cash/i.test(s.method || "") && !/cash ?app/i.test(s.method || "");
                            return (
                              <span key={i} className={`block text-[11px] ${esCash ? "text-amber-600 dark:text-amber-400 font-medium" : "text-gray-400 dark:text-gray-500"}`}>
                                {s.method || "—"} {money(Number(s.amount || 0))}
                              </span>
                            );
                          })
                        ) : (
                          o.customerMethod && (
                            <span className="block text-[11px] text-gray-400 dark:text-gray-500">{o.customerMethod}</span>
                          )
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
                    )}
                  </td>
                )}
                {/* Las de $0 no son deuda: son la constancia de que la asignación existió. Se
                    muestran (antes se ocultaban y parecía que faltaban órdenes) pero atenuadas,
                    para que no se confundan con dinero pendiente. */}
                <td className={`p-2 text-right tabular-nums ${o.amount > 0 ? "dark:text-gray-100" : "text-gray-400 dark:text-gray-500"}`}>
                  {esTecnico && editando === o.id ? (
                    <input
                      type="number" step="0.01" min="0" autoFocus value={montoEdit}
                      onChange={(e) => setMontoEdit(e.target.value)}
                      onBlur={() => guardarMonto(o)}
                      onKeyDown={(e) => { if (e.key === "Enter") guardarMonto(o); if (e.key === "Escape") setEditando(null); }}
                      className="w-24 rounded border border-blue-300 px-2 py-0.5 text-right text-sm dark:border-blue-700 dark:bg-gray-800 dark:text-gray-100"
                    />
                  ) : esTecnico ? (
                    <button
                      type="button"
                      title={t("editLaborInline")}
                      onClick={() => { setEditando(o.id); setMontoEdit(String(o.amount ?? 0)); }}
                      className="rounded px-1 hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-gray-800 dark:hover:text-blue-300"
                    >
                      {money(o.amount)} ✎
                    </button>
                  ) : (
                    money(o.amount)
                  )}
                </td>
                <td className="p-2 text-right">
                  {/* Abrir la orden sin perder la selección de este lote: se va en pestaña nueva.
                      Sin id no hay enlace — hay obligaciones del histórico cuyo número ya no
                      corresponde a ninguna orden activa, y un enlace roto es peor que ninguno. */}
                  {o.workOrderId ? (
                    <Link
                      href={`/dashboard/workorders/${o.workOrderId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap"
                    >
                      {tc("viewEdit")}
                    </Link>
                  ) : (
                    <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t("paymentMethod")}</label>
          <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={inputClass}>
            <option value="">{t("selectMethod")}</option>
            {methods.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t("paymentDate")}</label>
          <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className={inputClass} />
        </div>
      </div>

      {/* Efectivo y partes solo existen en el lote de tecnico; el descuento existe en los tres. */}
      {esTecnico ? (
        <div className="grid grid-cols-4 gap-2 mb-3">
          {AJUSTES_TECNICO.filter((x) => x.key !== "bonus").map(({ key, signo }) => (
            <div key={key}>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                {signo > 0 ? "+ " : "− "}{t(`adjust.${key}`)}
              </label>
              <input
                type="number" step="0.01"
                value={key === "partsReturn" && techPartsSel.size ? partesDevueltas : ajustes[key]}
                disabled={key === "partsReturn" && techPartsSel.size > 0}
                onChange={(e) => {
                  if (key === "cashAdvance") setCashTocado(true);
                  setAjustes((a) => ({ ...a, [key]: Number(e.target.value) }));
                }}
                className={`${inputClass} disabled:bg-gray-50 dark:disabled:bg-gray-800/60 disabled:text-gray-500`}
              />
              {key === "partsReturn" && techPartsSel.size > 0 && (
                <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">{t("partsReturnFromTicked", { count: techPartsSel.size })}</p>
              )}
              {/* De dónde sale el efectivo: la suma de las órdenes en Cash seleccionadas. Si el
                  usuario tecleó otro número, el derivado queda de aviso y un clic lo readopta. */}
              {key === "cashAdvance" && (
                <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                  {t("cashFromOrders", { amount: money(efectivoDerivado) })}
                  {cashTocado && Number(ajustes.cashAdvance) !== efectivoDerivado && (
                    <button
                      type="button"
                      onClick={() => { setCashTocado(false); setAjustes((a) => ({ ...a, cashAdvance: efectivoDerivado })); }}
                      className="ml-1 text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {t("useDerived")}
                    </button>
                  )}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="mb-3 max-w-[200px]">
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">− {t("adjust.deductions")}</label>
          <input type="number" step="0.01" value={ajustes.deductions}
            onChange={(e) => setAjustes((a) => ({ ...a, deductions: Number(e.target.value) }))}
            className={inputClass} />
        </div>
      )}

      {/* El bono se captura por renglon, con su tipo, porque es aqui donde se sabe por que se da.
          Un solo campo obligaria a elegir un tipo cuando el bono suele ser varios: los $161.00 de
          Agent-0234 son cinco. La suma de los renglones ES el bono del lote. */}
      <div className="mb-3 border-t dark:border-gray-800 pt-3">
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          {t("bonusItemsTitle")}{bono !== 0 && <span className="ml-2 font-medium">{money(bono)}</span>}
        </div>
        {bonos.map((b, i) => (
          <div key={i} className="flex items-center gap-2 mb-1 text-sm">
            <span className="flex-1">{b.bonusType ? tp(`bonusTypes.${b.bonusType}`) : t("bonusNoType")}</span>
            <span className="text-gray-500 text-xs flex-1">{b.note}</span>
            <span className="tabular-nums">{money(b.amount)}</span>
            <button type="button" onClick={() => setBonos((v) => v.filter((_, j) => j !== i))} className="text-red-500 text-xs px-1">✕</button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2 items-end mt-2">
          <select value={nuevoBono.bonusType} onChange={(e) => setNuevoBono((b) => ({ ...b, bonusType: e.target.value }))} className={`${inputClass} w-auto`}>
            <option value="">{t("bonusNoType")}</option>
            {BONUS_TYPES.map((x) => <option key={x} value={x}>{tp(`bonusTypes.${x}`)}</option>)}
          </select>
          <input type="number" step="0.01" placeholder="0.00" value={nuevoBono.amount}
            onChange={(e) => setNuevoBono((b) => ({ ...b, amount: e.target.value }))}
            className={`${inputClass} w-24`} />
          <input placeholder={tc("notes")} value={nuevoBono.note}
            onChange={(e) => setNuevoBono((b) => ({ ...b, note: e.target.value }))}
            className={`${inputClass} flex-1 min-w-[140px]`} />
          <button type="button" disabled={!Number(nuevoBono.amount)}
            onClick={() => { setBonos((v) => [...v, { ...nuevoBono, amount: Number(nuevoBono.amount) }]); setNuevoBono({ bonusType: "", amount: "", note: "" }); }}
            className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm dark:text-gray-200 disabled:opacity-40">
            {t("addBonus")}
          </button>
        </div>
      </div>

      {/* Las piezas que el técnico puso de su bolsa, aquí y no sólo en el lote ya creado: marcarlas
          las suma a lo que se le devuelve y CIERRA la obligación, que es lo que no pasaba cuando el
          monto se tecleaba a mano en "+ Partes devueltas" (Antonio, 9-sep-2026). */}
      {esTecnico && (techParts.length > 0 || verTodasPartes) && (
        <div className="mb-3 border-t dark:border-gray-800 pt-3">
          <div className="flex flex-wrap items-baseline gap-2 mb-1">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-300">{tp("techParts.title")}</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {t("selectedCount", { count: techPartsSel.size })} · {money(partesDevueltas)}
            </span>
            {/* Quien instala no siempre es quien pagó la pieza, y eso no lo dice ningún campo. */}
            <label className="ml-auto flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 cursor-pointer">
              <input
                type="checkbox" checked={verTodasPartes}
                onChange={(e) => { setVerTodasPartes(e.target.checked); cargarTechParts(party, e.target.checked); }}
              />
              {tp("techParts.showAll")}
            </label>
          </div>
          <div className="divide-y dark:divide-gray-800 max-h-48 overflow-y-auto">
            {techParts.map((p) => (
              <label key={p.id} className="flex items-center gap-3 py-1.5 text-sm cursor-pointer">
                <input type="checkbox" checked={techPartsSel.has(p.id)} onChange={() => toggleTechPart(p.id)} />
                <span className="dark:text-gray-200">{p.workOrderNo}</span>
                <span className="text-gray-500 dark:text-gray-400">{p.customerName}</span>
                {p.partNumber && <span className="text-gray-400 text-xs font-mono">{p.partNumber}</span>}
                {verTodasPartes && p.installer && <span className="text-gray-400 text-xs">{p.installer}</span>}
                <span className="text-gray-400 text-xs ml-auto">{p.appointmentDate || p.workDate}</span>
                <span className="tabular-nums dark:text-gray-200">{money(p.amount)}</span>
              </label>
            ))}
            {techParts.length === 0 && <p className="py-2 text-sm text-gray-400">{tp("techParts.noPending")}</p>}
          </div>
        </div>
      )}

      {/* Notas todavia sin netear de esta parte. Este es el flujo real y el que faltaba: la nota
          nace cuando se rompe el vidrio y se aplica al pago siguiente. Hasta ahora solo se podia
          crear la nota con el lote ya cargado, que exige saber de antemano en cual va a caer.
          El alta va aquí mismo por lo mismo: el vidrio roto se descubre revisando lo que se le
          debe, no después. */}
      <div className="mb-3 border-t dark:border-gray-800 pt-3 flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium text-gray-600 dark:text-gray-300">{tn("newDebitNote")}</span>
        {nuevaNota ? (
          <>
            <input
              type="number" step="0.01" placeholder="0.00" value={nuevaNota.amount}
              onChange={(e) => setNuevaNota((n) => ({ ...n, amount: e.target.value }))}
              className={`${inputClass} w-28`}
            />
            <input
              type="text" placeholder={tn("reason")} value={nuevaNota.reason}
              onChange={(e) => setNuevaNota((n) => ({ ...n, reason: e.target.value }))}
              className={`${inputClass} flex-1 min-w-[12rem]`}
            />
            <button
              type="button" onClick={guardarNota} disabled={!Number(nuevaNota.amount) || guardandoNota}
              className="bg-gray-900 hover:bg-gray-800 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-lg px-3 py-2 text-sm disabled:opacity-40"
            >
              {guardandoNota ? t("creating") : tc("save")}
            </button>
            <button type="button" onClick={() => setNuevaNota(null)} className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
              {tc("cancel")}
            </button>
          </>
        ) : (
          <button
            type="button" onClick={() => setNuevaNota({ amount: "", reason: "" })}
            className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            {tn("newDebitNote")}
          </button>
        )}
      </div>

      {notes.length > 0 && (
        <div className="mb-3 border-t dark:border-gray-800 pt-3">
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t("outstandingNotes", { count: notes.length })}</div>
          <div className="divide-y dark:divide-gray-800">
            {notes.map((n) => (
              <label key={n.id} className="flex items-center gap-3 py-1.5 text-sm cursor-pointer">
                <input type="checkbox" checked={selectedNotes.has(n.id)} onChange={() => toggleNote(n.id)} />
                <span className={n.noteType === "DEBIT" ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"}>
                  {n.noteType === "DEBIT" ? "+" : "−"} {money(n.amount)}
                </span>
                <span className="text-gray-600 dark:text-gray-300">{n.noteNumber}</span>
                {n.partNumber && <span className="text-gray-400 text-xs">{n.partNumber}</span>}
                {n.issueDate && <span className="text-gray-400 text-xs ml-auto">{n.issueDate}</span>}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* El lote creado, aquí abajo, pegado al botón que lo creó: confirma que existe y se lleva
          hasta Pagado sin ir a la pantalla del lote. Cada botón dice hasta dónde llevarlo, y los
          que ya quedaron atrás se apagan — pulsar "Marcar como Pagado" recién creado hace los tres
          saltos de una. El enlace queda por si hay que revisar el detalle. */}
      {lote && (
        <div className="border-t dark:border-gray-800 pt-3 mb-3">
          <div className="flex flex-wrap items-center gap-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
            <span className="text-sm text-green-800 dark:text-green-300">
              {t("batchCreated", { number: lote.paymentNumber || lote.id, amount: money(lote.amount ?? total) })}
              {" · "}
              <span className="font-semibold">{tp(`statuses.${lote.status}`)}</span>
            </span>
            <div className="flex flex-wrap items-center gap-2 ml-auto">
              {[
                { hasta: "Ready For Payment", label: tp("markReady") },
                { hasta: "Approved", label: tp("approve") },
                { hasta: "Paid", label: tp("markPaid") },
              ].map(({ hasta, label }) => (
                <button
                  key={hasta}
                  type="button"
                  onClick={() => avanzarLote(hasta)}
                  disabled={avanzando || CADENA_ESTADOS.indexOf(lote.status) >= CADENA_ESTADOS.indexOf(hasta)}
                  className={`rounded-lg px-3 py-2 text-sm disabled:opacity-40 ${
                    hasta === "Paid"
                      ? "bg-green-600 hover:bg-green-700 text-white"
                      : "border border-green-300 dark:border-green-700 text-green-800 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900/40"
                  }`}
                >
                  {avanzando ? t("creating") : label}
                </button>
              ))}
              <Link href={`/dashboard/payments/${lote.id}`} className="text-sm text-blue-600 dark:text-blue-400 hover:underline px-2">
                {tp("viewDetail")}
              </Link>
              <button type="button" onClick={() => setLote(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 px-1" aria-label={tc("close")}>
                ×
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between border-t dark:border-gray-800 pt-3">
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {t("selectedCount", { count: selected.size })} · {t("subtotal")} {money(subtotal)}
          {/* El desglose completo del lote de técnico, en la misma línea donde se decide: sin
              esto el total aparecía sin explicar de dónde salía (pedido del 2-sep-2026). */}
          {esTecnico && Number(ajustes.cashAdvance) !== 0 && (
            <> · <span className="text-amber-600 dark:text-amber-400">− {t("adjust.cashAdvance")} {money(Number(ajustes.cashAdvance))}</span></>
          )}
          {esTecnico && Number(ajustes.partsDeduction) !== 0 && <> · − {t("adjust.partsDeduction")} {money(Number(ajustes.partsDeduction))}</>}
          {esTecnico && Number(ajustes.partsReturn) !== 0 && <> · + {t("adjust.partsReturn")} {money(Number(ajustes.partsReturn))}</>}
          {Number(ajustes.deductions) !== 0 && <> · − {t("adjust.deductions")} {money(Number(ajustes.deductions))}</>}
          {bono !== 0 && <> · + {t("adjust.bonus")} {money(bono)}</>}
          {notasNeto !== 0 && <> · {t("notesNet")} {money(notasNeto)}</>}
          {total !== subtotal && <> · <span className="font-medium dark:text-gray-100">{t("total")} {money(total)}</span></>}
        </div>
        <button
          type="button" onClick={crearLote} disabled={!selected.size || saving}
          className="bg-gray-900 hover:bg-gray-800 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-40"
        >
          {saving ? t("creating") : t("createBatch", { amount: money(total) })}
        </button>
      </div>
    </div>
  );
}
