function formatDate(d) {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function formatTimestamp(d) {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Simple mapping, no JSONB — SQL technicians only carries a subset of the JSON shape
// (taxId, driverLicense, insuranceExpiration, notes, photo, serviceAreas, languages,
// canReceiveSms, canReceiveLinks, calendarColor, deletedAt/updatedAt/createdBy/updatedBy
// have no SQL column). Those default to their JSON-create() defaults below rather than
// being omitted, so callers never see a field go from present to undefined.
function mapTechnician(row) {
  return {
    id: row.id,
    name: row.name || "",
    companyName: row.company_name || "",
    phone: row.phone || "",
    mobile: row.mobile || "",
    email: row.email || "",
    password: row.password || "",
    mustChangePassword: !!row.must_change_password,
    tokenVersion: row.token_version || 0,
    address: row.address || "",
    city: row.city || "",
    state: row.state || "",
    zipCode: row.zip_code || "",
    // Estos diez llevaban valores fijos porque la tabla no tenía columna: la ficha los aceptaba,
    // los devolvía como guardados y los perdía al recargar. Ahora salen de la base
    // (scripts/add-technician-missing-columns.js).
    taxId: row.tax_id || "",
    driverLicense: row.driver_license || "",
    insuranceExpiration: row.insurance_expiration || "",
    notes: row.notes || "",
    photo: row.photo || null,
    status: row.status || "Active",
    defaultLaborRate: Number(row.default_labor_rate) || 0,
    defaultCommission: Number(row.default_commission) || 0,
    serviceAreas: row.service_areas || [],
    languages: row.languages || [],
    canReceiveSms: row.can_receive_sms !== false,
    canReceiveLinks: row.can_receive_links !== false,
    calendarColor: row.calendar_color || "#2563eb",
    active: row.active !== false,
    deletedAt: null,
    createdAt: formatTimestamp(row.created_at),
    updatedAt: formatTimestamp(row.created_at),
  };
}

// Simple mapping, no JSONB reshaping beyond pass-through — payouts carries the same shape
// backend/data/payments.json always has. `id` stays a plain integer (not UUID) because
// notes.store.js's relatedPaymentId references it by integer; out of scope to convert here.
// technicianId, however, IS a UUID (technicians.id) as of Fase 4 step 3's migrate-payout-ids.js
// — agentId/distributorId stay legacy integers since agents/distributors have no SQL table.
function mapPayment(row) {
  return {
    id: row.id,
    paymentNumber: row.payment_number || null,
    type: row.type,
    status: row.status,
    paymentMethod: row.payment_method || "",
    paymentDate: row.payment_date || "",
    // Conciliación bancaria: cuándo se cotejó este lote contra el cargo real del extracto y quién.
    // NULL/null = pendiente.
    reconciledAt: formatTimestamp(row.reconciled_at),
    reconciledBy: row.reconciled_by || "",
    notes: row.notes || "",
    workOrderIds: row.work_order_ids || [],
    isAdhoc: !!row.is_adhoc,
    technicianId: row.technician_id,
    agentId: row.agent_id,
    distributorId: row.distributor_id,
    baseAmount: Number(row.base_amount) || 0,
    bonus: Number(row.bonus) || 0,
    bonusReason: row.bonus_reason || "",
    bonusType: row.bonus_type || "",
    company: row.company || "",
    primaryAgent: row.primary_agent || "",
    deductions: Number(row.deductions) || 0,
    netAmount: Number(row.net_amount) || 0,
    invoiceNumber: row.invoice_number || "",
    // El total facturado por el distribuidor. Se deriva de la suma de `invoices` cuando la lista
    // existe; NULL = aun no se capturo (distinto de 0, que seria una factura de cero).
    invoiceTotal: row.invoice_total === null || row.invoice_total === undefined ? null : Number(row.invoice_total),
    // Las facturas del distribuidor que cubre este lote: [{ date, number, amount }]. Un pago suele
    // saldar varias, y los creditos van con monto negativo.
    invoices: Array.isArray(row.invoices) ? row.invoices : [],
    poNumber: row.po_number || "",
    partNumber: row.part_number || "",
    invoiceDate: row.invoice_date || "",
    dueDate: row.due_date || "",
    taxAmount: Number(row.tax_amount) || 0,
    subtotal: Number(row.subtotal) || 0,
    totalAmount: Number(row.total_amount) || 0,
    attachment: row.attachment || null,
    commissionType: row.commission_type || "Percentage",
    commissionRate: Number(row.commission_rate) || 0,
    grossAmount: Number(row.gross_amount) || 0,
    commissionAmount: Number(row.commission_amount) || 0,
    cashAdvance: Number(row.cash_advance) || 0,
    partsDeduction: Number(row.parts_deduction) || 0,
    partsReturn: Number(row.parts_return) || 0,
    creditNotesTotal: Number(row.credit_notes_total) || 0,
    debitNotesTotal: Number(row.debit_notes_total) || 0,
    transactions: row.transactions || [],
    auditLog: row.audit_log || [],
    active: row.active !== false,
    deletedAt: formatTimestamp(row.deleted_at),
    createdBy: row.created_by || "System",
    updatedBy: row.updated_by || "System",
    createdAt: formatTimestamp(row.created_at),
    updatedAt: formatTimestamp(row.updated_at),
  };
}

function mapCustomer(row) {
  return {
    id: row.id,
    firstName: row.first_name || "",
    lastName: row.last_name || "",
    phone: row.phone || "",
    phoneAlt: row.phone_alt || "",
    email: row.email || "",
    address: row.address || "",
    addressType: row.address_type || "",
    unitNumber: row.unit_number || "",
    city: row.city || "",
    state: row.state || "",
    zipCode: row.zip_code || "",
    vehicle: row.vehicle || { year: "", make: "", model: "", bodyType: "", vin: "", plate: "" },
    active: row.active !== false,
    deletedAt: formatTimestamp(row.deleted_at),
    createdBy: row.created_by || "System",
    updatedBy: row.updated_by || "System",
    createdAt: formatTimestamp(row.created_at),
    updatedAt: formatTimestamp(row.updated_at),
  };
}

function mapQuote(row) {
  return {
    id: row.id,
    quoteNo: row.quote_no,
    status: row.status,
    documentType: row.document_type || "WorkOrder",
    paymentType: row.payment_type || "Personal",
    callDirection: row.call_direction || "In",
    name: row.name || "",
    date: formatDate(row.date),
    zipCode: row.zip_code || "",
    state: row.state || null,
    longTripFee: Number(row.long_trip_fee) || 0,
    serviceArea: row.service_area !== false,
    longTripRequired: !!row.long_trip_required,
    distanceFromBase: Number(row.distance_from_base) || 0,
    customerType: row.customer_type || "Existing",
    customerId: row.customer_id,
    customerName: row.customer_name || "",
    newCustomer: row.new_customer || {},
    insuranceCompanyId: row.insurance_company_id,
    agentId: row.agent_id,
    agentName: row.agent_name || "",
    policyNumber: row.policy_number || "",
    claimNumber: row.claim_number || "",
    appointmentDate: formatDate(row.appointment_date) || "",
    startTime: row.start_time || "",
    endTime: row.end_time || "",
    vehicle: {
      year: row.vehicle_year || "",
      make: row.vehicle_make || "",
      model: row.vehicle_model || "",
      bodyType: row.vehicle_body_type || "",
      vin: row.vehicle_vin || "",
      plate: "",
    },
    glassType: row.glass_type || "",
    partNumber: row.part_number || "",
    nagsDescription: row.nags_description || "",
    glassCost: Number(row.glass_cost) || 0,
    calibrationType: row.calibration_type || "",
    damageNotes: row.damage_notes || "",
    insurance: row.insurance || {},
    discount: row.discount || { type: "Percentage", value: 0, reason: "" },
    insuranceAdjustment: row.insurance_adjustment || { amount: 0, notes: "" },
    lineItems: row.line_items || [],
    crmPhotos: row.crm_photos || [],
    customerPhotos: row.customer_photos || [],
    taxRate: Number(row.tax_rate) || 0,
    invoiceMode: row.invoice_mode || "lump_sum",
    upsell: Number(row.upsell) || 0,
    commission: Number(row.commission) || 0,
    paidAmount: Number(row.paid_amount) || 0,
    cashComeback: Number(row.cash_comeback) || 0,
    customerSuggestedPrice: Number(row.customer_suggested_price) || 0,
    payment: row.payment || {},
    lostInfo: row.lost_info || {},
    intakeToken: row.intake_token || null,
    intakeTokenExpiresAt: formatTimestamp(row.intake_token_expires_at),
    intakeSentAt: formatTimestamp(row.intake_sent_at),
    intakeOpenedAt: formatTimestamp(row.intake_opened_at),
    intakeCompletedAt: formatTimestamp(row.intake_completed_at),
    intakePhotos: row.intake_photos || { driverSide: [], passengerSide: [], front: [], rear: [], damageArea: [], insuranceCard: [] },
    insuranceAttachments: row.insurance_attachments || [],
    active: row.active !== false,
    deletedAt: formatTimestamp(row.deleted_at),
    createdBy: row.created_by || "System",
    updatedBy: row.updated_by || "System",
    createdAt: formatTimestamp(row.created_at),
    updatedAt: formatTimestamp(row.updated_at),
  };
}

function mapWorkOrder(row) {
  return {
    id: row.id,
    workOrderNo: row.work_order_no,
    quoteId: row.quote_id,
    quoteNo: row.quote_no || "",
    customerId: row.customer_id,
    customerName: row.customer_name || "",
    workOrderType: row.work_order_type || "Personal",
    invoiceMode: row.invoice_mode || "lump_sum",
    phone: row.phone || "",
    email: row.email || "",
    address: row.address || "",
    state: row.state || null,
    vehicle: {
      year: row.vehicle_year || "",
      make: row.vehicle_make || "",
      model: row.vehicle_model || "",
      bodyType: row.vehicle_body_type || "",
      vin: row.vehicle_vin || "",
      plate: "",
    },
    insuranceCompanyId: row.insurance_company_id,
    claimNumber: row.claim_number || "",
    policyNumber: row.policy_number || "",
    distributorId: row.distributor_id,
    distributor: row.distributor || "",
    tech: row.tech || "",
    technicianId: row.technician_id,
    // Tecnicos DE MAS, cada uno con su labor. labor_cost sigue siendo el total de la orden, asi
    // que lo del principal se deriva: laborCost - suma(extraTechs). Ver add-extra-techs.js.
    extraTechs: Array.isArray(row.extra_techs) ? row.extra_techs : [],
    techAssignedAt: null,
    partNumber: row.part_number || "",
    glassType: row.glass_type || "",
    nagsDescription: row.nags_description || "",
    jobType: row.job_type || "",
    priority: row.priority || "Normal",
    laborCost: Number(row.labor_cost) || 0,
    glassCost: Number(row.glass_cost) || 0,
    totalSale: Number(row.total_sale) || 0,
    commission: Number(row.commission) || 0,
    status: row.status,
    appointmentDate: formatDate(row.appointment_date) || "",
    appointmentTime: row.appointment_time || "",
    appointmentDurationMinutes: row.appointment_duration_minutes ?? 60,
    specialInstructions: row.special_instructions || "",
    techInstructions: row.tech_instructions || "",
    internalNotes: row.internal_notes || "",
    cancellationReason: row.cancellation_reason || "",
    cancelledAt: formatTimestamp(row.cancelled_at),
    isChargeback: !!row.is_chargeback,
    // NULL cuando la orden aun no esta geocodificada — nunca 0: (0,0) es un punto real en el
    // oceano y "sin ubicar" tiene que ser distinguible de "ubicada".
    latitude: row.latitude === null || row.latitude === undefined ? null : Number(row.latitude),
    longitude: row.longitude === null || row.longitude === undefined ? null : Number(row.longitude),
    geocodeSource: row.geocode_source || "",
    // Writes that arrived through the technician's mobile link, where the caller is anonymous by
    // construction and this record is the only trace.
    publicAccessLog: row.public_access_log || [],
    payment: row.payment || { method: "", amount: 0, paid: false, cashComeback: 0, authorizationId: "" },
    paymentHistory: row.payment_history || [],
    publicToken: row.public_token || null,
    paymentToken: row.payment_token || null,
    techPhotos: row.tech_photos || [],
    active: row.active !== false,
    deletedAt: formatTimestamp(row.deleted_at),
    createdBy: row.created_by || "System",
    updatedBy: row.updated_by || "System",
    createdAt: formatTimestamp(row.created_at),
    updatedAt: formatTimestamp(row.updated_at),

    // Campos derivados del presupuesto y del cliente. La orden de trabajo guarda una copia plana de
    // unos pocos datos (part_number, distributor) pero el detalle real vive en quotes.line_items y
    // en customers, y hasta ahora la tabla no tenia forma de verlo: elegir "Distributor Name" o
    // "PO Number" en Configure View daba una columna vacia aunque el dato existiera. Solo aparecen
    // cuando la consulta trae los joins; sin ellos quedan en blanco y nada se rompe.
    //
    // El distribuidor de la orden gana sobre el de la linea: si alguien lo corrigio a mano en la
    // orden, esa correccion es la buena.
    distributorFromLines: row.li_distributors || "",
    orderNumber: row.li_order_numbers || "",
    distributorCost: row.li_part_cost != null ? Number(row.li_part_cost) : null,
    priceTier: row.li_price_tiers || "",
    calibrationType: row.li_calibration_types || "",
    calibrationCost: row.li_calibration_amount != null ? Number(row.li_calibration_amount) : null,
    partDescriptions: row.li_descriptions || "",
    agentName: row.agent_name || "",
    deductible: row.deductible != null ? Number(row.deductible) : null,
    taxRate: row.tax_rate != null ? Number(row.tax_rate) : null,
    discountType: row.discount_type || "",
    discountValue: row.discount_value != null ? Number(row.discount_value) : null,
    mobile: row.customer_phone_alt || "",
    city: row.customer_city || "",
    customerState: row.customer_state || "",
    zipCode: row.customer_zip_code || "",
  };
}

module.exports = { mapCustomer, mapQuote, mapWorkOrder, mapTechnician, mapPayment, formatDate, formatTimestamp };
