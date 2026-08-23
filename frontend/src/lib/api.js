const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export function getCurrentUser() {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(localStorage.getItem("user") || "null");
  } catch {
    return null;
  }
}

export const changePassword = (data) => request("/auth/change-password", { method: "POST", body: JSON.stringify(data) });

export async function request(path, options = {}) {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;

  const res = await fetch(`${API_URL}/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  // A previously-valid session (expired token, or a token issued before a
  // server restart) fails every authenticated request the same way. Handle
  // it once, here, instead of relying on every caller's own .catch() block —
  // otherwise catalog dropdowns and lists just render empty with no signal.
  if (res.status === 401 && token && typeof window !== "undefined") {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.href = "/login";
    return new Promise(() => {});
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const error = new Error(body.error || `Request failed: ${res.status}`);
    // Some failures carry more than a message — the 409 a quote save returns when its work order
    // is already paid needs the work order number and both prices. Attached here so callers read
    // the parsed body off the error instead of every one of them re-reading the response.
    error.status = res.status;
    error.details = body;
    throw error;
  }

  if (res.status === 204) return null;
  return res.json();
}

export const getQuotes = () => request("/quotes");
export const getQuote = (id) => request(`/quotes/${id}`);
export const createQuote = (data) => request("/quotes", { method: "POST", body: JSON.stringify(data) });
export const updateQuote = (id, data) => request(`/quotes/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteQuote = (id) => request(`/quotes/${id}`, { method: "DELETE" });
export const convertQuote = (id) => request(`/quotes/${id}/convert`, { method: "POST" });
export const sendQuoteIntake = (id, { methods, message, expiresInDays }) =>
  request(`/quotes/${id}/intake/send`, {
    method: "POST",
    body: JSON.stringify({ methods, message, expiresInDays, baseUrl: typeof window !== "undefined" ? window.location.origin : undefined }),
  });
export const getQuoteIntakeNotifications = (id) => request(`/quotes/${id}/intake/notifications`);

export const getIntake = (token) => request(`/intake/${token}`);
export const submitIntake = (token, data) => request(`/intake/${token}`, { method: "PUT", body: JSON.stringify(data) });
export const decodeIntakeVin = (token, vin) => request(`/intake/${token}/vin-decode/${vin}`);

export const getCustomers = () => request("/customers");
export const getCustomer = (id) => request(`/customers/${id}`);
export const createCustomer = (data) => request("/customers", { method: "POST", body: JSON.stringify(data) });
export const updateCustomer = (id, data) => request(`/customers/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteCustomer = (id) => request(`/customers/${id}`, { method: "DELETE" });

export const getInsuranceCompanies = () => request("/insurance");
export const getInsuranceCompany = (id) => request(`/insurance/${id}`);
export const createInsuranceCompany = (data) => request("/insurance", { method: "POST", body: JSON.stringify(data) });
export const updateInsuranceCompany = (id, data) => request(`/insurance/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteInsuranceCompany = (id) => request(`/insurance/${id}`, { method: "DELETE" });

export const getWorkOrders = (params) => {
  if (!params) return request("/workorders");
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") qs.set(key, value);
  });
  return request(`/workorders?${qs.toString()}`);
};
export const getWorkOrder = (id) => request(`/workorders/${id}`);
export const updateWorkOrder = (id, data) => request(`/workorders/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteWorkOrder = (id) => request(`/workorders/${id}`, { method: "DELETE" });
export const assignTech = (id, technicianId) => request(`/workorders/${id}/assign-tech`, { method: "POST", body: JSON.stringify({ technicianId }) });
export const sendWorkOrderNotification = (id, methods, message) =>
  request(`/workorders/${id}/notify`, { method: "POST", body: JSON.stringify({ methods, message }) });

export const getWorkOrderPaymentLink = (id) => request(`/workorders/${id}/payment-link`, { method: "POST" });
export const getWorkOrderByPaymentToken = (token) => request(`/workorders/pay/${token}`);
export const createCheckoutSession = (token) =>
  request("/checkout/create-checkout-session", { method: "POST", body: JSON.stringify({ token }) });
export const getWorkOrderNotifications = (id) => request(`/workorders/${id}/notifications`);
export const getMobileWorkOrder = (token) => request(`/workorders/mobile/${token}`);
// The technician's link writes through the token, never the id. updateWorkOrder() needs a session
// and would 401 here — which is the point: the id alone used to be enough, and is not any more.
// Only status and techPhotos are accepted server-side.
export const updateMobileWorkOrder = (token, data) =>
  request(`/workorders/mobile/${token}`, { method: "PUT", body: JSON.stringify(data) });
// Revokes a leaked technician link by issuing a new token; the previous one stops resolving.
export const regenerateMobileLink = (id) =>
  request(`/workorders/${id}/mobile-link/regenerate`, { method: "POST" });

export const getDistributors = () => request("/distributors");
export const getDistributor = (id) => request(`/distributors/${id}`);
export const createDistributor = (data) => request("/distributors", { method: "POST", body: JSON.stringify(data) });
export const updateDistributor = (id, data) => request(`/distributors/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteDistributor = (id) => request(`/distributors/${id}`, { method: "DELETE" });

export const getTechnicians = () => request("/technicians");
export const getTechnician = (id) => request(`/technicians/${id}`);
export const createTechnician = (data) => request("/technicians", { method: "POST", body: JSON.stringify(data) });
export const updateTechnician = (id, data) => request(`/technicians/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteTechnician = (id) => request(`/technicians/${id}`, { method: "DELETE" });

export const getAgents = () => request("/agents");
export const getAgent = (id) => request(`/agents/${id}`);
export const createAgent = (data) => request("/agents", { method: "POST", body: JSON.stringify(data) });
export const updateAgent = (id, data) => request(`/agents/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteAgent = (id) => request(`/agents/${id}`, { method: "DELETE" });

export const getExpenses = () => request("/expenses");
export const getExpense = (id) => request(`/expenses/${id}`);
export const createExpense = (data) => request("/expenses", { method: "POST", body: JSON.stringify(data) });
export const updateExpense = (id, data) => request(`/expenses/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteExpense = (id) => request(`/expenses/${id}`, { method: "DELETE" });

export const getUsers = () => request("/users");
export const getUser = (id) => request(`/users/${id}`);
export const createUser = (data) => request("/users", { method: "POST", body: JSON.stringify(data) });
export const updateUser = (id, data) => request(`/users/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteUser = (id) => request(`/users/${id}`, { method: "DELETE" });

export const getCalibrationTypes = () => request("/settings/calibration-types");
export const createCalibrationType = (data) => request("/settings/calibration-types", { method: "POST", body: JSON.stringify(data) });
export const updateCalibrationType = (id, data) => request(`/settings/calibration-types/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteCalibrationType = (id) => request(`/settings/calibration-types/${id}`, { method: "DELETE" });

// Cuentas por pagar. La deuda vive en payable, por work order y por parte.
export const getPayableSummary = () => request("/payable/summary");
export const getPayableParties = (kind) => request(`/payable/${kind}/parties`);
export const getPayablePending = (kind, party) => request(`/payable/${kind}/parties/${encodeURIComponent(party)}/pending`);
export const createPayablePayout = (kind, data) => request(`/payable/${kind}/payouts`, { method: "POST", body: JSON.stringify(data) });

export const getPaymentMethods = () => request("/settings/payment-methods");
export const createPaymentMethod = (data) => request("/settings/payment-methods", { method: "POST", body: JSON.stringify(data) });
export const updatePaymentMethod = (id, data) => request(`/settings/payment-methods/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deletePaymentMethod = (id) => request(`/settings/payment-methods/${id}`, { method: "DELETE" });

export const getPaymentStatuses = () => request("/settings/payment-status");
export const createPaymentStatus = (data) => request("/settings/payment-status", { method: "POST", body: JSON.stringify(data) });
export const updatePaymentStatus = (id, data) => request(`/settings/payment-status/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deletePaymentStatus = (id) => request(`/settings/payment-status/${id}`, { method: "DELETE" });

export const getExpenseCategories = () => request("/settings/expense-categories");
export const createExpenseCategory = (data) => request("/settings/expense-categories", { method: "POST", body: JSON.stringify(data) });
export const updateExpenseCategory = (id, data) => request(`/settings/expense-categories/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteExpenseCategory = (id) => request(`/settings/expense-categories/${id}`, { method: "DELETE" });

export const getPriceTiers = () => request("/settings/price-tiers");
export const createPriceTier = (data) => request("/settings/price-tiers", { method: "POST", body: JSON.stringify(data) });
export const updatePriceTier = (id, data) => request(`/settings/price-tiers/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deletePriceTier = (id) => request(`/settings/price-tiers/${id}`, { method: "DELETE" });

export const getPartNumbers = () => request("/settings/part-numbers");
export const createPartNumber = (data) => request("/settings/part-numbers", { method: "POST", body: JSON.stringify(data) });
export const updatePartNumber = (id, data) => request(`/settings/part-numbers/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deletePartNumber = (id) => request(`/settings/part-numbers/${id}`, { method: "DELETE" });

export const getVehicleTypes = () => request("/settings/vehicle-types");
export const createVehicleType = (data) => request("/settings/vehicle-types", { method: "POST", body: JSON.stringify(data) });
export const updateVehicleType = (id, data) => request(`/settings/vehicle-types/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteVehicleType = (id) => request(`/settings/vehicle-types/${id}`, { method: "DELETE" });

export const getJobTypes = () => request("/settings/job-types");
export const createJobType = (data) => request("/settings/job-types", { method: "POST", body: JSON.stringify(data) });
export const updateJobType = (id, data) => request(`/settings/job-types/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteJobType = (id) => request(`/settings/job-types/${id}`, { method: "DELETE" });

export const getBusinessPartners = () => request("/settings/business-partners");
export const createBusinessPartner = (data) => request("/settings/business-partners", { method: "POST", body: JSON.stringify(data) });
export const updateBusinessPartner = (id, data) => request(`/settings/business-partners/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteBusinessPartner = (id) => request(`/settings/business-partners/${id}`, { method: "DELETE" });

export const getPartnerDistributionSettings = () => request("/settings/partner-distribution-settings");
export const updatePartnerDistributionSettings = (data) =>
  request("/settings/partner-distribution-settings", { method: "PUT", body: JSON.stringify(data) });

export const getZipCodes = () => request("/settings/zip-codes");
export const createZipCode = (data) => request("/settings/zip-codes", { method: "POST", body: JSON.stringify(data) });
export const updateZipCode = (id, data) => request(`/settings/zip-codes/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteZipCode = (id) => request(`/settings/zip-codes/${id}`, { method: "DELETE" });

export const getTags = () => request("/settings/tags");
export const createTag = (data) => request("/settings/tags", { method: "POST", body: JSON.stringify(data) });
export const updateTag = (id, data) => request(`/settings/tags/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deleteTag = (id) => request(`/settings/tags/${id}`, { method: "DELETE" });

export const getProfitLossReport = (params = {}) => {
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
  const qs = query.toString();
  return request(`/reports/profit-loss${qs ? `?${qs}` : ""}`);
};
export const getProfitLossMatrixReport = (params = {}) => {
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
  const qs = query.toString();
  return request(`/reports/profit-loss-matrix${qs ? `?${qs}` : ""}`);
};
export const getPartnersReport = (params = {}) => {
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
  const qs = query.toString();
  return request(`/reports/partners${qs ? `?${qs}` : ""}`);
};
export const getSalesReport = () => request("/reports/sales");
export const getTechniciansReport = () => request("/reports/technicians");
export const getExpensesReport = () => request("/reports/expenses");

function withActor(data) {
  const user = getCurrentUser();
  return { ...data, performedBy: user?.name || "System" };
}

export const getPayments = (filters = {}) => {
  const params = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, v]) => v)));
  const qs = params.toString();
  return request(`/payments${qs ? `?${qs}` : ""}`);
};
export const getPaymentsDashboard = () => request("/payments/dashboard");
export const getEligibleWorkOrders = (type, entityId) =>
  request(`/payments/eligible-workorders?type=${encodeURIComponent(type)}&entityId=${encodeURIComponent(entityId)}`);
export const getPayment = (id) => request(`/payments/${id}`);
export const createPayment = (data) => request("/payments", { method: "POST", body: JSON.stringify(withActor(data)) });
export const updatePayment = (id, data) => request(`/payments/${id}`, { method: "PUT", body: JSON.stringify(withActor(data)) });
export const markPaymentReady = (id) => request(`/payments/${id}/mark-ready`, { method: "POST", body: JSON.stringify(withActor({})) });
export const approvePayment = (id) => request(`/payments/${id}/approve`, { method: "POST", body: JSON.stringify(withActor({})) });
export const payPayment = (id, data) => request(`/payments/${id}/pay`, { method: "POST", body: JSON.stringify(withActor(data)) });
export const cancelPayment = (id, reason) => request(`/payments/${id}/cancel`, { method: "POST", body: JSON.stringify(withActor({ reason })) });
export const deletePayment = (id) => request(`/payments/${id}`, { method: "DELETE" });
export const getPaymentNotes = (paymentId) => request(`/payments/${paymentId}/notes`);

function notesApi(basePath) {
  return {
    list: (filters = {}) => {
      const params = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, v]) => v)));
      const qs = params.toString();
      return request(`${basePath}${qs ? `?${qs}` : ""}`);
    },
    dashboard: () => request(`${basePath}/dashboard`),
    get: (id) => request(`${basePath}/${id}`),
    create: (data) => request(basePath, { method: "POST", body: JSON.stringify(withActor(data)) }),
    update: (id, data) => request(`${basePath}/${id}`, { method: "PUT", body: JSON.stringify(withActor(data)) }),
    apply: (id) => request(`${basePath}/${id}/apply`, { method: "POST", body: JSON.stringify(withActor({})) }),
    voidNote: (id, reason) => request(`${basePath}/${id}/void`, { method: "POST", body: JSON.stringify(withActor({ reason })) }),
    remove: (id) => request(`${basePath}/${id}`, { method: "DELETE" }),
  };
}

const creditNotesApi = notesApi("/credit-notes");
export const getCreditNotes = creditNotesApi.list;
export const getCreditNotesDashboard = creditNotesApi.dashboard;
export const getCreditNote = creditNotesApi.get;
export const createCreditNote = creditNotesApi.create;
export const updateCreditNote = creditNotesApi.update;
export const applyCreditNote = creditNotesApi.apply;
export const voidCreditNote = creditNotesApi.voidNote;
export const deleteCreditNote = creditNotesApi.remove;

const debitNotesApi = notesApi("/debit-notes");
export const getDebitNotes = debitNotesApi.list;
export const getDebitNotesDashboard = debitNotesApi.dashboard;
export const getDebitNote = debitNotesApi.get;
export const createDebitNote = debitNotesApi.create;
export const updateDebitNote = debitNotesApi.update;
export const applyDebitNote = debitNotesApi.apply;
export const voidDebitNote = debitNotesApi.voidNote;
export const deleteDebitNote = debitNotesApi.remove;

export const getInvoices = (filters = {}) => {
  const params = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, v]) => v)));
  const qs = params.toString();
  return request(`/invoices${qs ? `?${qs}` : ""}`);
};
export const getInvoice = (id) => request(`/invoices/${id}`);
export const getPublicInvoice = (token) => request(`/invoices/public/${token}`);
export const createInvoiceFromWorkOrder = (workOrderId) =>
  request(`/invoices/from-workorder/${workOrderId}`, { method: "POST", body: JSON.stringify(withActor({})) });
export const updateInvoice = (id, data) => request(`/invoices/${id}`, { method: "PUT", body: JSON.stringify(withActor(data)) });
export const sendInvoice = (id) => request(`/invoices/${id}/send`, { method: "POST", body: JSON.stringify(withActor({})) });
export const recordInvoicePayment = (id, data) => request(`/invoices/${id}/payments`, { method: "POST", body: JSON.stringify(withActor(data)) });
export const voidInvoice = (id, reason) => request(`/invoices/${id}/void`, { method: "POST", body: JSON.stringify(withActor({ reason })) });
export const deleteInvoice = (id) => request(`/invoices/${id}`, { method: "DELETE" });

export const getTableViews = (module) => {
  const user = getCurrentUser();
  const params = new URLSearchParams({ module, performedBy: user?.name || "System" });
  return request(`/table-views?${params.toString()}`);
};
export const createTableView = (data) => request("/table-views", { method: "POST", body: JSON.stringify(withActor(data)) });
export const updateTableView = (id, data) => request(`/table-views/${id}`, { method: "PUT", body: JSON.stringify(withActor(data)) });
export const setDefaultTableView = (id) => request(`/table-views/${id}/set-default`, { method: "POST", body: JSON.stringify(withActor({})) });
export const deleteTableView = (id) => request(`/table-views/${id}`, { method: "DELETE" });

export const getPartnerCompanies = () => request("/partner-companies");
export const getPartnerCompany = (id) => request(`/partner-companies/${id}`);
export const createPartnerCompany = (data) => request("/partner-companies", { method: "POST", body: JSON.stringify(data) });
export const updatePartnerCompany = (id, data) => request(`/partner-companies/${id}`, { method: "PUT", body: JSON.stringify(data) });
export const deletePartnerCompany = (id) => request(`/partner-companies/${id}`, { method: "DELETE" });

export const sendPresenceHeartbeat = (currentPage) =>
  request("/presence/ping", { method: "POST", body: JSON.stringify({ currentPage }) });
export const getOnlineUsers = () => request("/presence");
export const getActiveUsers = () => request("/presence/active-users");
