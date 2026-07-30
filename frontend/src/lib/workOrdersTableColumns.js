import { isCompletedWorkOrderStatus } from "./workOrderStatuses";

export const CATEGORIES = [
  "workOrder",
  "customer",
  "vehicle",
  "insurance",
  "appointment",
  "glass",
  "distributor",
  "technician",
  "invoice",
  "payments",
  "financial",
  "documents",
];

const VISIBLE_BY_DEFAULT = new Set([
  "acciones",
  "woNo",
  "customerName",
  "phone",
  "year",
  "make",
  "model",
  "insuranceCompany",
  "claimNumber",
  "partNumber",
  "appointmentDate",
  "appointmentTime",
  "assignedTech",
  "status",
  "distributorName",
  "totalSale",
  "balanceDue",
  "invoiceStatus",
]);

const PINNED_BY_DEFAULT = new Set(["acciones"]);

const CATALOG_KEYS = [
  ["workOrder", ["acciones", "woNo", "quoteNo", "status", "priority", "jobType", "createdDate", "lastUpdated", "completionDate", "assignedTech", "specialInstructions"]],
  ["customer", ["customerName", "firstName", "lastName", "phone", "mobile", "email", "address", "city", "state", "zipCode"]],
  ["vehicle", ["year", "make", "model", "trim", "bodyStyle", "vin", "plate", "mileage", "color"]],
  ["insurance", ["insuranceCompany", "claimNumber", "policyNumber", "deductible", "agentName", "authorizationNumber", "roNumber", "coverageType"]],
  ["appointment", ["appointmentDate", "appointmentTime", "serviceType", "serviceAddress", "serviceCity", "serviceState", "serviceZipCode"]],
  ["glass", ["partNumber", "partDescription", "nagsNumber", "glassType", "calibrationRequired", "calibrationCost"]],
  ["distributor", ["distributorName", "poNumber", "trackingNumber", "orderDate", "deliveryDate", "distributorCost"]],
  ["technician", ["technicianPhone", "technicianEmail", "assignmentDate", "notificationStatus", "lastNotificationSent"]],
  ["invoice", ["invoiceNumber", "invoiceStatus", "invoiceDate", "dueDate", "invoiceTotal", "amountPaid", "balanceDue"]],
  ["payments", ["paymentStatus", "paymentMethod", "paymentDate", "paymentAmount", "remainingBalance"]],
  ["financial", ["glassCost", "laborCost", "materialCost", "tax", "discount", "totalCost", "totalSale", "grossProfit", "netProfit"]],
  ["documents", ["customerSignature", "technicianSignature", "documentsAttached", "photosUploaded", "invoicePdf", "workOrderPdf"]],
];

export const DEFAULT_COLUMNS = CATALOG_KEYS.flatMap(([category, keys]) =>
  keys.map((key) => ({
    key,
    category,
    visible: VISIBLE_BY_DEFAULT.has(key),
    pinned: PINNED_BY_DEFAULT.has(key),
  }))
);

export const MONEY_COLUMNS = new Set([
  "invoiceTotal",
  "amountPaid",
  "balanceDue",
  "paymentAmount",
  "remainingBalance",
  "glassCost",
  "laborCost",
  "materialCost",
  "tax",
  "discount",
  "totalCost",
  "totalSale",
  "grossProfit",
  "netProfit",
  "distributorCost",
  "calibrationCost",
  "deductible",
]);

function fmtDate(d) {
  return d ? new Date(d).toLocaleString() : "";
}

export function getColumnValue(key, wo, ctx = {}) {
  const { companies = [], users = [], invoices = [] } = ctx;
  const invoice = invoices.find((i) => i.workOrderId === wo.id);
  const technician = users.find((u) => u.id === wo.technicianId);
  const [firstName, ...rest] = (wo.customerName || "").split(" ");

  switch (key) {
    case "woNo": return wo.workOrderNo;
    case "quoteNo": return wo.quoteNo;
    case "status": return wo.status;
    case "priority": return wo.priority;
    case "jobType": return wo.jobType;
    case "createdDate": return wo.createdAt ? wo.createdAt.slice(0, 10) : "";
    case "lastUpdated": return fmtDate(wo.updatedAt);
    case "completionDate": return isCompletedWorkOrderStatus(wo.status) ? fmtDate(wo.updatedAt) : "";
    case "assignedTech": return wo.tech;
    case "specialInstructions": return wo.specialInstructions;

    case "customerName": return wo.customerName;
    case "firstName": return firstName || "";
    case "lastName": return rest.join(" ");
    case "phone": return wo.phone;
    case "mobile": return "";
    case "email": return wo.email;
    case "address": return wo.address;
    case "city": return "";
    case "state": return "";
    case "zipCode": return "";

    case "year": return wo.vehicle?.year;
    case "make": return wo.vehicle?.make;
    case "model": return wo.vehicle?.model;
    case "trim": return "";
    case "bodyStyle": return wo.vehicle?.bodyType;
    case "vin": return wo.vehicle?.vin;
    case "plate": return wo.vehicle?.plate;
    case "mileage": return "";
    case "color": return "";

    case "insuranceCompany": return (companies || []).find((c) => c.id === wo.insuranceCompanyId)?.name || "";
    case "claimNumber": return wo.claimNumber;
    case "policyNumber": return wo.policyNumber;
    case "deductible": return "";
    case "agentName": return "";
    case "authorizationNumber": return "";
    case "roNumber": return "";
    case "coverageType": return "";

    case "appointmentDate": return wo.appointmentDate;
    case "appointmentTime": return wo.appointmentTime;
    case "serviceType": return wo.jobType;
    case "serviceAddress": return wo.address;
    case "serviceCity": return "";
    case "serviceState": return "";
    case "serviceZipCode": return "";

    case "partNumber": return wo.partNumber;
    case "partDescription": return wo.nagsDescription;
    case "nagsNumber": return "";
    case "glassType": return wo.glassType;
    case "calibrationRequired": return wo.glassType ? "" : "";
    case "calibrationCost": return "";

    case "distributorName": return wo.distributor;
    case "poNumber": return "";
    case "trackingNumber": return "";
    case "orderDate": return "";
    case "deliveryDate": return "";
    case "distributorCost": return "";

    case "technicianPhone": return technician?.phone || "";
    case "technicianEmail": return technician?.email || "";
    case "assignmentDate": return fmtDate(wo.techAssignedAt);
    case "notificationStatus": return wo.lastNotification?.status || "";
    case "lastNotificationSent": return wo.lastNotification?.sentAt ? fmtDate(wo.lastNotification.sentAt) : "";

    case "invoiceNumber": return invoice?.invoiceNumber || "";
    case "invoiceStatus": return invoice?.status || "";
    case "invoiceDate": return invoice?.invoiceDate || "";
    case "dueDate": return invoice?.dueDate || "";
    case "invoiceTotal": return invoice?.total ?? "";
    case "amountPaid": return invoice?.amountPaid ?? "";
    case "balanceDue": return invoice?.balance ?? "";

    case "paymentStatus": return invoice?.status || (wo.payment?.paid ? "Paid" : "Pending");
    case "paymentMethod": return wo.payment?.method;
    case "paymentDate": return "";
    case "paymentAmount": return wo.payment?.amount;
    case "remainingBalance": return invoice?.balance ?? "";

    case "glassCost": return wo.glassCost;
    case "laborCost": return wo.laborCost;
    case "materialCost": return "";
    case "tax": return "";
    case "discount": return "";
    case "totalCost": return Number(wo.glassCost || 0) + Number(wo.laborCost || 0);
    case "totalSale": return wo.totalSale;
    case "grossProfit": return Number(wo.totalSale || 0) - Number(wo.glassCost || 0) - Number(wo.laborCost || 0);
    case "netProfit": return "";

    case "customerSignature": return "";
    case "technicianSignature": return "";
    case "documentsAttached": return "";
    case "photosUploaded": return wo.techPhotos?.length || 0;
    case "invoicePdf": return invoice ? "PDF" : "";
    case "workOrderPdf": return "";

    default: return "";
  }
}
