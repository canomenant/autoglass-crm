-- ============================================================
-- AutoGlass CRM PostgreSQL schema
-- Run via: npm run migrate:schema  (or  npm run migrate:schema -- --reset)
-- ============================================================

-- ---------- Wave 1: catalogs / lookups / misc ----------

CREATE TABLE job_types (
  id   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('Parts','Services','Molding'))
);

CREATE TABLE part_numbers (
  id               INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  part_number      TEXT NOT NULL,
  job_type         TEXT NOT NULL DEFAULT '',   -- name-string ref to job_types, NOT a FK (documented gap)
  nags_description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE calibration_types (
  id     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0
);

CREATE TABLE price_tiers (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE vehicle_types (
  id        INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  year      INTEGER NOT NULL,
  make      TEXT NOT NULL,
  model     TEXT NOT NULL,
  body_type TEXT NOT NULL DEFAULT ''
);

CREATE TABLE zip_codes (
  id                  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  city                TEXT NOT NULL DEFAULT '',
  county              TEXT NOT NULL DEFAULT '',
  state               TEXT NOT NULL DEFAULT 'CA',
  zipcode             TEXT NOT NULL UNIQUE,
  tax                 NUMERIC(6,4) NOT NULL DEFAULT 0,
  service_area        BOOLEAN NOT NULL DEFAULT true,
  long_trip_required  BOOLEAN NOT NULL DEFAULT false,
  long_trip_fee       NUMERIC(12,2) NOT NULL DEFAULT 0,
  distance_from_base  NUMERIC(10,2) NOT NULL DEFAULT 0
);

CREATE TABLE payment_methods (
  id   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE payment_statuses (   -- catalog dropdown list, distinct from payments.status enum
  id   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE tags (
  id   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('Quote','Work Order')),
  UNIQUE (name, type)
);

CREATE TABLE expense_categories (
  id   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE partner_companies (
  id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_name TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  phone        TEXT NOT NULL DEFAULT '',
  email        TEXT NOT NULL DEFAULT '',
  lead_price   NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes        TEXT NOT NULL DEFAULT '',
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id                  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name                TEXT NOT NULL DEFAULT '',
  email               TEXT UNIQUE,
  phone               TEXT NOT NULL DEFAULT '',
  role                TEXT NOT NULL CHECK (role IN ('Admin','Tech','Sales','Employee')) DEFAULT 'Employee',
  bank_name           TEXT NOT NULL DEFAULT '',
  bank_account_number TEXT NOT NULL DEFAULT '',
  commission          NUMERIC(12,2) NOT NULL DEFAULT 0,
  salary              NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes               TEXT NOT NULL DEFAULT '',
  attachments         JSONB NOT NULL DEFAULT '[]',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE expenses (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category    TEXT NOT NULL DEFAULT '',   -- name-string ref to expense_categories, NOT a FK (documented gap)
  date        DATE,
  amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes       TEXT NOT NULL DEFAULT '',
  attachments JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE table_views (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  module     TEXT NOT NULL,
  scope      TEXT NOT NULL CHECK (scope IN ('Company','Personal')),
  user_name  TEXT,
  view_name  TEXT NOT NULL DEFAULT 'Untitled View',
  columns    JSONB NOT NULL DEFAULT '[]',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_table_views_module ON table_views (module);

CREATE TABLE attachments (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  related_type  TEXT NOT NULL DEFAULT '',   -- generic polymorphic, no FK possible
  related_id    INTEGER,
  file_name     TEXT NOT NULL DEFAULT '',
  url           TEXT NOT NULL DEFAULT '',
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_attachments_related ON attachments (related_type, related_id);

-- ---------- Wave 2: actor / reference entities ----------

CREATE TABLE agents (
  id               INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name             TEXT NOT NULL DEFAULT '',
  company_name     TEXT NOT NULL DEFAULT '',
  phone            TEXT NOT NULL DEFAULT '',
  email            TEXT UNIQUE,
  password         TEXT NOT NULL DEFAULT '',   -- bcrypt hash post-migration
  address          TEXT NOT NULL DEFAULT '',
  commission_type  TEXT NOT NULL CHECK (commission_type IN ('Fixed','Percentage')) DEFAULT 'Percentage',
  commission_rate  NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_id           TEXT NOT NULL DEFAULT '',
  notes            TEXT NOT NULL DEFAULT '',
  photo            TEXT,
  status           TEXT NOT NULL CHECK (status IN ('Active','Inactive')) DEFAULT 'Active',
  active           BOOLEAN NOT NULL DEFAULT true,
  deleted_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_agents_active ON agents (id) WHERE active = true;

CREATE TABLE technicians (
  id                    INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name                  TEXT NOT NULL DEFAULT '',
  company_name          TEXT NOT NULL DEFAULT '',
  phone                 TEXT NOT NULL DEFAULT '',
  mobile                TEXT NOT NULL DEFAULT '',
  email                 TEXT UNIQUE,
  password              TEXT NOT NULL DEFAULT '',   -- bcrypt hash post-migration
  address               TEXT NOT NULL DEFAULT '',
  city                  TEXT NOT NULL DEFAULT '',
  state                 TEXT NOT NULL DEFAULT '',
  zip_code              TEXT NOT NULL DEFAULT '',
  tax_id                TEXT NOT NULL DEFAULT '',
  driver_license        TEXT NOT NULL DEFAULT '',
  insurance_expiration  DATE,
  notes                 TEXT NOT NULL DEFAULT '',
  photo                 TEXT,
  status                TEXT NOT NULL CHECK (status IN ('Active','Inactive')) DEFAULT 'Active',
  default_labor_rate    NUMERIC(12,2) NOT NULL DEFAULT 0,
  default_commission    NUMERIC(12,2) NOT NULL DEFAULT 0,
  service_areas         JSONB NOT NULL DEFAULT '[]',
  languages             JSONB NOT NULL DEFAULT '[]',
  can_receive_sms       BOOLEAN NOT NULL DEFAULT true,
  can_receive_links     BOOLEAN NOT NULL DEFAULT true,
  calendar_color        TEXT NOT NULL DEFAULT '#2563eb',
  active                BOOLEAN NOT NULL DEFAULT true,
  deleted_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_technicians_active ON technicians (id) WHERE active = true;

CREATE TABLE distributors (
  id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name            TEXT NOT NULL DEFAULT '',
  contact_name    TEXT NOT NULL DEFAULT '',
  phone           TEXT NOT NULL DEFAULT '',
  mobile          TEXT NOT NULL DEFAULT '',
  email           TEXT NOT NULL DEFAULT '',
  address         TEXT NOT NULL DEFAULT '',
  city            TEXT NOT NULL DEFAULT '',
  state           TEXT NOT NULL DEFAULT '',
  zip_code        TEXT NOT NULL DEFAULT '',
  website         TEXT NOT NULL DEFAULT '',
  account_number  TEXT NOT NULL DEFAULT '',
  payment_terms   TEXT NOT NULL DEFAULT '',
  tax_id          TEXT NOT NULL DEFAULT '',
  notes           TEXT NOT NULL DEFAULT '',
  logo            TEXT,
  status          TEXT NOT NULL CHECK (status IN ('Active','Inactive')) DEFAULT 'Active',
  active          BOOLEAN NOT NULL DEFAULT true,
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_distributors_active ON distributors (id) WHERE active = true;

CREATE TABLE insurance_companies (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',
  email      TEXT NOT NULL DEFAULT '',
  address    TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  active     BOOLEAN NOT NULL DEFAULT true,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_insurance_active ON insurance_companies (id) WHERE active = true;

CREATE TABLE customers (
  id                INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  first_name        TEXT NOT NULL DEFAULT '',
  last_name         TEXT NOT NULL DEFAULT '',
  phone             TEXT NOT NULL DEFAULT '',
  phone_alt         TEXT NOT NULL DEFAULT '',
  email             TEXT NOT NULL DEFAULT '',
  address           TEXT NOT NULL DEFAULT '',
  address_type      TEXT NOT NULL DEFAULT '',
  unit_number       TEXT NOT NULL DEFAULT '',
  city              TEXT NOT NULL DEFAULT '',
  state             TEXT NOT NULL DEFAULT '',
  zip_code          TEXT NOT NULL DEFAULT '',
  vehicle_year      TEXT NOT NULL DEFAULT '',
  vehicle_make      TEXT NOT NULL DEFAULT '',
  vehicle_model     TEXT NOT NULL DEFAULT '',
  vehicle_body_type TEXT NOT NULL DEFAULT '',
  vehicle_vin       TEXT NOT NULL DEFAULT '',
  vehicle_plate     TEXT NOT NULL DEFAULT '',
  active            BOOLEAN NOT NULL DEFAULT true,
  deleted_at        TIMESTAMPTZ,
  created_by        TEXT NOT NULL DEFAULT 'System',
  updated_by        TEXT NOT NULL DEFAULT 'System',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_customers_active ON customers (id) WHERE active = true;
CREATE INDEX idx_customers_vin ON customers (vehicle_vin) WHERE vehicle_vin <> '';

-- ---------- Wave 3: quotes ----------

CREATE TABLE quotes (
  id                            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  quote_no                      TEXT NOT NULL UNIQUE,
  status                        TEXT NOT NULL CHECK (status IN
                                   ('Draft','Waiting Customer','Ready For Review','Approved','Converted','Rejected')) DEFAULT 'Draft',
  document_type                 TEXT NOT NULL CHECK (document_type IN ('WorkOrder','Appointment')) DEFAULT 'WorkOrder',
  payment_type                  TEXT NOT NULL CHECK (payment_type IN ('Personal','Insurance')) DEFAULT 'Personal',
  call_direction                TEXT NOT NULL CHECK (call_direction IN ('In','Out')) DEFAULT 'In',
  name                          TEXT NOT NULL DEFAULT '',
  date                          DATE,
  zip_code                      TEXT NOT NULL DEFAULT '',
  long_trip_fee                 NUMERIC(12,2) NOT NULL DEFAULT 0,
  service_area                  BOOLEAN NOT NULL DEFAULT true,
  long_trip_required            BOOLEAN NOT NULL DEFAULT false,
  distance_from_base            NUMERIC(10,2) NOT NULL DEFAULT 0,
  customer_type                 TEXT NOT NULL CHECK (customer_type IN ('New','Existing')) DEFAULT 'Existing',
  customer_id                   INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  customer_name                 TEXT NOT NULL DEFAULT '',
  new_customer                  JSONB NOT NULL DEFAULT '{}',
  insurance_company_id          INTEGER REFERENCES insurance_companies(id) ON DELETE SET NULL,
  agent_id                      INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  agent_name                    TEXT NOT NULL DEFAULT '',
  policy_number                 TEXT NOT NULL DEFAULT '',
  claim_number                  TEXT NOT NULL DEFAULT '',
  appointment_date              DATE,
  start_time                    TEXT NOT NULL DEFAULT '',
  end_time                      TEXT NOT NULL DEFAULT '',
  vehicle_year                  TEXT NOT NULL DEFAULT '',
  vehicle_make                  TEXT NOT NULL DEFAULT '',
  vehicle_model                 TEXT NOT NULL DEFAULT '',
  vehicle_body_type             TEXT NOT NULL DEFAULT '',
  vehicle_vin                   TEXT NOT NULL DEFAULT '',
  vehicle_plate                 TEXT NOT NULL DEFAULT '',
  glass_type                    TEXT NOT NULL DEFAULT '',
  part_number                   TEXT NOT NULL DEFAULT '',
  nags_description              TEXT NOT NULL DEFAULT '',
  glass_cost                    NUMERIC(12,2) NOT NULL DEFAULT 0,
  calibration_type              TEXT NOT NULL DEFAULT '',
  damage_notes                  TEXT NOT NULL DEFAULT '',
  insurance                     JSONB NOT NULL DEFAULT '{}',
  discount                      JSONB NOT NULL DEFAULT '{"type":"Percentage","value":0,"reason":""}',
  insurance_adjustment          JSONB NOT NULL DEFAULT '{"amount":0,"notes":""}',
  crm_photos                    JSONB NOT NULL DEFAULT '[]',
  customer_photos                JSONB NOT NULL DEFAULT '[]',
  tax_rate                      NUMERIC(6,4) NOT NULL DEFAULT 0,
  upsell                        NUMERIC(12,2) NOT NULL DEFAULT 0,
  commission                    NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_amount                   NUMERIC(12,2) NOT NULL DEFAULT 0,
  cash_comeback                 NUMERIC(12,2) NOT NULL DEFAULT 0,
  customer_suggested_price      NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment                       JSONB NOT NULL DEFAULT '{}',  -- method/zipCode/firstName/lastName/amount/authorizationId ONLY (cardNumber/cvv/expirationDate dropped)
  lost_info                     JSONB NOT NULL DEFAULT '{}',
  lost_info_partner_company_id  INTEGER REFERENCES partner_companies(id) ON DELETE SET NULL,  -- shadow FK
  intake_token                  TEXT UNIQUE,
  intake_token_expires_at       TIMESTAMPTZ,
  intake_sent_at                TIMESTAMPTZ,
  intake_opened_at              TIMESTAMPTZ,
  intake_completed_at           TIMESTAMPTZ,
  intake_photos                 JSONB NOT NULL DEFAULT '{"driverSide":[],"passengerSide":[],"front":[],"rear":[],"damageArea":[],"insuranceCard":[]}',
  active                        BOOLEAN NOT NULL DEFAULT true,
  deleted_at                    TIMESTAMPTZ,
  created_by                    TEXT NOT NULL DEFAULT 'System',
  updated_by                    TEXT NOT NULL DEFAULT 'System',
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_quotes_active ON quotes (id) WHERE active = true;
CREATE INDEX idx_quotes_status ON quotes (status);
CREATE INDEX idx_quotes_agent ON quotes (agent_id);
CREATE INDEX idx_quotes_customer ON quotes (customer_id);
CREATE INDEX idx_quotes_insurance ON quotes (insurance_company_id);

CREATE TABLE quote_line_items (
  id                INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  quote_id          INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  position          INTEGER NOT NULL DEFAULT 0,
  job_type          TEXT NOT NULL DEFAULT '',
  part_number       TEXT NOT NULL DEFAULT '',
  nags_description  TEXT NOT NULL DEFAULT '',
  calibration_type  TEXT NOT NULL DEFAULT '',
  price_tier        TEXT NOT NULL DEFAULT '',
  price_part        NUMERIC(12,2) NOT NULL DEFAULT 0,
  distributor       TEXT NOT NULL DEFAULT '',
  order_number      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_quote_line_items_quote ON quote_line_items (quote_id, position);

-- ---------- Wave 4: work orders ----------

CREATE TABLE workorders (
  id                            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  work_order_no                 TEXT NOT NULL UNIQUE,
  quote_id                      INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
  quote_no                      TEXT NOT NULL DEFAULT '',
  customer_id                   INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  customer_name                 TEXT NOT NULL DEFAULT '',
  work_order_type               TEXT NOT NULL CHECK (work_order_type IN ('Personal','Insurance')) DEFAULT 'Personal',
  phone                         TEXT NOT NULL DEFAULT '',
  email                         TEXT NOT NULL DEFAULT '',
  address                       TEXT NOT NULL DEFAULT '',
  vehicle_year                  TEXT NOT NULL DEFAULT '',
  vehicle_make                  TEXT NOT NULL DEFAULT '',
  vehicle_model                 TEXT NOT NULL DEFAULT '',
  vehicle_body_type             TEXT NOT NULL DEFAULT '',
  vehicle_vin                   TEXT NOT NULL DEFAULT '',
  vehicle_plate                 TEXT NOT NULL DEFAULT '',
  insurance_company_id          INTEGER REFERENCES insurance_companies(id) ON DELETE SET NULL,
  claim_number                  TEXT NOT NULL DEFAULT '',
  policy_number                 TEXT NOT NULL DEFAULT '',
  distributor_id                INTEGER REFERENCES distributors(id) ON DELETE SET NULL,
  distributor                   TEXT NOT NULL DEFAULT '',
  tech                          TEXT NOT NULL DEFAULT '',
  technician_id                 INTEGER REFERENCES technicians(id) ON DELETE SET NULL,
  tech_assigned_at              TIMESTAMPTZ,
  part_number                   TEXT NOT NULL DEFAULT '',
  glass_type                    TEXT NOT NULL DEFAULT '',
  nags_description              TEXT NOT NULL DEFAULT '',
  job_type                      TEXT NOT NULL DEFAULT '',
  priority                      TEXT NOT NULL DEFAULT 'Normal',
  labor_cost                    NUMERIC(12,2) NOT NULL DEFAULT 0,
  glass_cost                    NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_sale                    NUMERIC(12,2) NOT NULL DEFAULT 0,
  status                        TEXT NOT NULL CHECK (status IN
                                   ('Scheduled','Assigned','In Progress','Completed','Paid','Closed','Cancelled')) DEFAULT 'Scheduled',
  appointment_date               DATE,
  appointment_time              TEXT NOT NULL DEFAULT '',
  appointment_duration_minutes  INTEGER NOT NULL DEFAULT 60,
  special_instructions          TEXT NOT NULL DEFAULT '',
  tech_instructions             TEXT NOT NULL DEFAULT '',
  internal_notes                TEXT NOT NULL DEFAULT '',
  cancellation_reason           TEXT NOT NULL DEFAULT '',
  cancelled_at                  TIMESTAMPTZ,
  payment                       JSONB NOT NULL DEFAULT '{"method":"","amount":0,"paid":false,"cashComeback":0,"authorizationId":""}',
  payment_history                JSONB NOT NULL DEFAULT '[]',
  public_token                   TEXT UNIQUE,
  tech_photos                    JSONB NOT NULL DEFAULT '[]',
  active                         BOOLEAN NOT NULL DEFAULT true,
  deleted_at                     TIMESTAMPTZ,
  created_by                     TEXT NOT NULL DEFAULT 'System',
  updated_by                     TEXT NOT NULL DEFAULT 'System',
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_workorders_active ON workorders (id) WHERE active = true;
CREATE INDEX idx_workorders_status ON workorders (status);
CREATE INDEX idx_workorders_technician ON workorders (technician_id);
CREATE INDEX idx_workorders_distributor ON workorders (distributor_id);
CREATE INDEX idx_workorders_quote ON workorders (quote_id);
CREATE INDEX idx_workorders_customer ON workorders (customer_id);

CREATE TABLE work_order_notifications (
  id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  work_order_id   INTEGER NOT NULL REFERENCES workorders(id) ON DELETE CASCADE,
  technician_id   INTEGER REFERENCES technicians(id) ON DELETE SET NULL,
  method          TEXT NOT NULL DEFAULT 'SMS',
  recipient       TEXT NOT NULL DEFAULT '',
  message         TEXT NOT NULL DEFAULT '',
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  status          TEXT NOT NULL CHECK (status IN ('Pending','Sent','Delivered','Failed')) DEFAULT 'Sent'
);
CREATE INDEX idx_won_workorder ON work_order_notifications (work_order_id, sent_at DESC);

CREATE TABLE quote_intake_notifications (
  id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  quote_id   INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  method     TEXT NOT NULL DEFAULT 'SMS',
  recipient  TEXT NOT NULL DEFAULT '',
  message    TEXT NOT NULL DEFAULT '',
  sent_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  status     TEXT NOT NULL DEFAULT 'Sent'
);
CREATE INDEX idx_qin_quote ON quote_intake_notifications (quote_id, sent_at DESC);

-- ---------- Wave 5: financial core ----------

CREATE TABLE payments (
  id                  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_number      TEXT NOT NULL UNIQUE,
  type                TEXT NOT NULL CHECK (type IN ('TECHNICIAN','DISTRIBUTOR','AGENT')),
  status              TEXT NOT NULL CHECK (status IN ('Pending','Approved','Scheduled','Paid','Overdue','Cancelled')) DEFAULT 'Pending',
  payment_method      TEXT NOT NULL DEFAULT '',
  payment_date        DATE,
  notes               TEXT NOT NULL DEFAULT '',
  technician_id       INTEGER REFERENCES technicians(id) ON DELETE SET NULL,
  work_order_id       INTEGER REFERENCES workorders(id) ON DELETE SET NULL,
  customer_id         INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  vehicle             TEXT NOT NULL DEFAULT '',
  job_type            TEXT NOT NULL DEFAULT '',
  base_amount         NUMERIC(12,2) NOT NULL DEFAULT 0,
  bonus               NUMERIC(12,2) NOT NULL DEFAULT 0,
  deductions          NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
  distributor_id      INTEGER REFERENCES distributors(id) ON DELETE SET NULL,
  invoice_number      TEXT NOT NULL DEFAULT '',
  po_number           TEXT NOT NULL DEFAULT '',
  part_number         TEXT NOT NULL DEFAULT '',
  invoice_date        DATE,
  due_date            DATE,
  tax_amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
  subtotal            NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  attachment          JSONB,
  agent_id            INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  commission_type     TEXT NOT NULL CHECK (commission_type IN ('Fixed','Percentage')) DEFAULT 'Percentage',
  commission_rate     NUMERIC(12,2) NOT NULL DEFAULT 0,
  gross_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  commission_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
  credit_notes_total  NUMERIC(12,2) NOT NULL DEFAULT 0,
  debit_notes_total   NUMERIC(12,2) NOT NULL DEFAULT 0,
  transactions        JSONB NOT NULL DEFAULT '[]',
  audit_log           JSONB NOT NULL DEFAULT '[]',
  active              BOOLEAN NOT NULL DEFAULT true,
  deleted_at          TIMESTAMPTZ,
  created_by          TEXT NOT NULL DEFAULT 'System',
  updated_by          TEXT NOT NULL DEFAULT 'System',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payments_active ON payments (id) WHERE active = true;
CREATE INDEX idx_payments_type ON payments (type);
CREATE INDEX idx_payments_status ON payments (status);
CREATE INDEX idx_payments_technician ON payments (technician_id);
CREATE INDEX idx_payments_distributor ON payments (distributor_id);
CREATE INDEX idx_payments_agent ON payments (agent_id);
CREATE INDEX idx_payments_workorder ON payments (work_order_id);

CREATE TABLE notes (  -- Credit + Debit notes, discriminated by note_type
  id                  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  note_number         TEXT NOT NULL UNIQUE,
  note_type           TEXT NOT NULL CHECK (note_type IN ('CREDIT','DEBIT')),
  entity_type         TEXT NOT NULL CHECK (entity_type IN ('DISTRIBUTOR','TECHNICIAN','AGENT')),
  entity_id           INTEGER,  -- polymorphic target, no single FK possible
  entity_name         TEXT NOT NULL DEFAULT '',
  related_payment_id  INTEGER REFERENCES payments(id) ON DELETE SET NULL,
  amount              NUMERIC(12,2) NOT NULL DEFAULT 0,
  reason              TEXT NOT NULL DEFAULT '',
  description         TEXT NOT NULL DEFAULT '',
  issue_date          DATE,
  attachment          JSONB,
  status              TEXT NOT NULL CHECK (status IN ('Active','Applied','Void','Cancelled')) DEFAULT 'Active',
  created_by          TEXT NOT NULL DEFAULT 'System',
  audit_log           JSONB NOT NULL DEFAULT '[]',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notes_type ON notes (note_type);
CREATE INDEX idx_notes_entity ON notes (entity_type, entity_id);
CREATE INDEX idx_notes_related_payment ON notes (related_payment_id);
CREATE INDEX idx_notes_status ON notes (status);

CREATE TABLE invoices (
  id                     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_number         TEXT NOT NULL UNIQUE,
  work_order_id          INTEGER NOT NULL REFERENCES workorders(id) ON DELETE RESTRICT,
  work_order_no          TEXT NOT NULL DEFAULT '',
  quote_id               INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
  customer_id            INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  customer_name          TEXT NOT NULL DEFAULT '',
  customer_phone         TEXT NOT NULL DEFAULT '',
  customer_email         TEXT NOT NULL DEFAULT '',
  vehicle_year           TEXT NOT NULL DEFAULT '',
  vehicle_make           TEXT NOT NULL DEFAULT '',
  vehicle_model          TEXT NOT NULL DEFAULT '',
  vehicle_body_type      TEXT NOT NULL DEFAULT '',
  vehicle_vin            TEXT NOT NULL DEFAULT '',
  vehicle_plate          TEXT NOT NULL DEFAULT '',
  insurance_company_id   INTEGER REFERENCES insurance_companies(id) ON DELETE SET NULL,
  claim_number           TEXT NOT NULL DEFAULT '',
  technician             TEXT NOT NULL DEFAULT '',
  bill_to                TEXT NOT NULL CHECK (bill_to IN ('Customer','Insurance','Split')) DEFAULT 'Customer',
  split_customer_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
  split_insurance_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  split_deductible       NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax                    NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount               NUMERIC(12,2) NOT NULL DEFAULT 0,
  invoice_date           DATE,
  due_date               DATE,
  status                 TEXT NOT NULL CHECK (status IN
                            ('Draft','Sent','Viewed','Partially_Paid','Paid','Overdue','Void')) DEFAULT 'Draft',
  public_token           TEXT UNIQUE,
  template               TEXT NOT NULL CHECK (template IN ('Personal','Insurance','Custom')) DEFAULT 'Personal',
  custom_sections         JSONB NOT NULL DEFAULT '{}',
  notes                   TEXT NOT NULL DEFAULT '',
  internal_notes          TEXT NOT NULL DEFAULT '',
  payments                JSONB NOT NULL DEFAULT '[]',  -- embedded ledger, distinct from top-level payments table
  audit_log                JSONB NOT NULL DEFAULT '[]',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_invoices_workorder ON invoices (work_order_id);
CREATE INDEX idx_invoices_quote ON invoices (quote_id);
CREATE INDEX idx_invoices_status ON invoices (status);

CREATE TABLE invoice_line_items (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id    INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  description   TEXT NOT NULL DEFAULT '',
  quantity      NUMERIC(12,2) NOT NULL DEFAULT 1,
  unit_price    NUMERIC(12,2) NOT NULL DEFAULT 0
);
CREATE INDEX idx_invoice_line_items_invoice ON invoice_line_items (invoice_id, position);
