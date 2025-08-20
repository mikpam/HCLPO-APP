import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean, jsonb, real, vector } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("operator"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const purchaseOrders = pgTable("purchase_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  uuid: varchar("uuid").notNull().default(sql`gen_random_uuid()`).unique(),
  poNumber: text("po_number").notNull().unique(),
  customerMeta: jsonb("customer_meta"),
  contactMeta: jsonb("contact_meta"), // Contact information extracted and validated
  contact: text("contact"), // Contact person name for NetSuite (required field)
  lineItems: jsonb("line_items"), // Validated line items with finalSKU
  clientPONumber: text("client_po_number"), // Customer's original PO number
  shippingCarrier: text("shipping_carrier"),
  shippingMethod: text("shipping_method"),
  originalJson: jsonb("original_json"),
  extractedData: jsonb("extracted_data"), // Gemini PDF extraction results
  originalPdfFilename: text("original_pdf_filename"),
  nsExternalId: text("ns_external_id"),
  nsInternalId: text("ns_internal_id"),
  status: text("status").notNull().default("pending"),
  retryCount: integer("retry_count").notNull().default(0), // Track processing attempts
  lastRetryAt: timestamp("last_retry_at"), // When last retry occurred
  comments: text("comments"),
  pokey: text("pokey").unique(),
  emailId: text("email_id"),
  sender: text("sender"),
  subject: text("subject"),
  route: text("route"), // TEXT_PO, ATTACHMENT_PO, REVIEW
  confidence: real("confidence"),
  // Validation tracking fields
  customerValidated: boolean("customer_validated").default(false),
  contactValidated: boolean("contact_validated").default(false),
  lineItemsValidated: boolean("line_items_validated").default(false),
  validationCompleted: boolean("validation_completed").default(false),
  // File storage paths
  attachmentPaths: text("attachment_paths").array(), // Array of paths to attachments in object storage
  extractionSourceFile: text("extraction_source_file"), // Specific file path used for successful extraction
  emlFilePath: text("eml_file_path"), // Path to .eml file in object storage
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const errorLogs = pgTable("error_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: text("type").notNull(),
  message: text("message").notNull(),
  explanation: text("explanation"), // User-friendly explanation of what the error means
  relatedPoId: varchar("related_po_id").references(() => purchaseOrders.id),
  relatedPoNumber: text("related_po_number"),
  resolved: boolean("resolved").notNull().default(false),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: varchar("resolved_by").references(() => users.id),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const emailQueue = pgTable("email_queue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gmailId: text("gmail_id").notNull().unique(),
  sender: text("sender").notNull(),
  subject: text("subject").notNull(),
  body: text("body"),
  attachments: jsonb("attachments"),
  labels: text("labels").array(),
  status: text("status").notNull().default("pending"), // pending, processing, processed, error, filtered
  preprocessingResult: jsonb("preprocessing_result"), // Step 1: Simple intent classification
  classificationResult: jsonb("classification_result"), // Step 2: Detailed analysis (only for qualifying emails)
  route: text("route"), // TEXT_PO, ATTACHMENT_PO, REVIEW - populated after classification
  confidence: real("confidence"), // Confidence score from detailed classification
  processingError: text("processing_error"),
  processedAt: timestamp("processed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Customer master table for efficient lookups
export const customers = pgTable("customers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerNumber: text("customer_number").notNull().unique(), // C12345
  companyName: text("company_name").notNull(),
  alternateNames: text("alternate_names").array(), // For fuzzy matching
  email: text("email"),
  phone: text("phone"),
  phoneDigits: text("phone_digits"), // Normalized phone digits for exact matching
  address: jsonb("address"),
  netsuiteId: text("netsuite_id"),
  isActive: boolean("is_active").default(true),
  searchVector: text("search_vector"), // For full-text search
  customerEmbedding: vector("customer_embedding", { dimensions: 1536 }), // OpenAI text-embedding-3-small vector
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// HCL Contacts table for contact validation with NetSuite Internal IDs
export const contacts = pgTable("contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  netsuiteInternalId: text("netsuite_internal_id").notNull().unique(), // NetSuite Internal ID
  name: text("name").notNull(),
  jobTitle: text("job_title"),
  phone: text("phone"),
  email: text("email"),
  company: text("company"), // Company name (e.g., "C9272 Halo Branded Solutions")
  officePhone: text("office_phone"), // Office phone number
  fax: text("fax"), // Fax number
  altEmail: text("alt_email"), // Alternative email address
  inactive: boolean("inactive").default(false),
  duplicate: boolean("duplicate").default(false),
  loginAccess: boolean("login_access").default(false),
  verified: boolean("verified").default(false), // Contact has been verified through validation process
  lastVerifiedAt: timestamp("last_verified_at"), // When contact was last verified
  lastVerifiedMethod: text("last_verified_method"), // How contact was last verified (exact_email, vector, etc.)
  verificationConfidence: real("verification_confidence"), // Confidence score of last verification (0.0-1.0)
  searchVector: text("search_vector"), // For full-text search
  contactText: text("contact_text"), // Concatenated text for embedding generation
  contactEmbedding: vector("contact_embedding", { dimensions: 1536 }), // OpenAI text-embedding-3-small vector
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// HCL Items table for SKU validation and product information - Enhanced for hybrid validation
export const items = pgTable("items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  netsuiteId: text("netsuite_id").notNull().unique(), // NetSuite Internal ID
  sku: text("sku").notNull().unique(), // Primary SKU identifier
  finalSku: text("final_sku").notNull(), // Legacy field for compatibility
  upc: text("upc"), // UPC/EAN code
  mpn: text("mpn"), // Manufacturer Part Number
  displayName: text("display_name").notNull(),
  subType: text("sub_type"),
  description: text("description"),
  vendor: text("vendor"), // Vendor/supplier
  manufacturer: text("manufacturer"), // Manufacturer
  category: text("category"), // Product category
  attributes: jsonb("attributes"), // {"color":["navy","midnight"],"size":["xl"],"material":"cotton"}
  uom: text("uom").default("EA"), // Unit of measure: EA, DZ, CS
  moq: integer("moq").default(1), // Minimum order quantity
  basePrice: text("base_price"), // Keep as text since some might be empty
  tierPrices: jsonb("tier_prices"), // {"A": 12.50, "B": 10.75}
  taxSchedule: text("tax_schedule"),
  planner: text("planner"),
  isActive: boolean("is_active").default(true),
  searchVector: text("search_vector"), // For full-text search
  itemText: text("item_text"), // Concatenated text for embedding generation
  itemEmbedding: vector("item_embedding", { dimensions: 1536 }), // OpenAI text-embedding-3-small vector
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Item aliases and alternative SKUs
export const itemAlias = pgTable("item_alias", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  itemId: varchar("item_id").notNull().references(() => items.id, { onDelete: 'cascade' }),
  aliasSku: text("alias_sku").notNull(),
  aliasName: text("alias_name"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Vendor cross-references for customer/vendor item numbers
export const itemVendorXref = pgTable("item_vendor_xref", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  itemId: varchar("item_id").notNull().references(() => items.id, { onDelete: 'cascade' }),
  vendorName: text("vendor_name").notNull(),
  vendorSku: text("vendor_sku").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Deterministic charge mappings
export const chargeMap = pgTable("charge_map", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  chargeCode: text("charge_code").notNull().unique(), // SETUP, FREIGHT, ART, RUSH, SAMPLE
  regex: text("regex").notNull(), // e.g., '(?i)\\b(set[- ]?up|setup)\\b'
  itemId: varchar("item_id").notNull().references(() => items.id),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Line item validation audit table
export const lineItemValidationAudit = pgTable("line_item_validation_audit", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  poId: varchar("po_id").references(() => purchaseOrders.id),
  lineItemIndex: integer("line_item_index").notNull(), // Which line item in the PO
  queryData: jsonb("query_data"), // Normalized input data
  topCandidates: jsonb("top_candidates"), // Top candidate matches with scores
  selectedItemId: varchar("selected_item_id").references(() => items.id),
  confidenceScore: real("confidence_score"),
  method: text("method").notNull(), // exact_sku, upc, vendor_xref, charge_map, vector, vector+llm, none
  reasons: text("reasons").array(), // Array of reason codes
  llmResponse: jsonb("llm_response"), // LLM response if used
  finalScore: real("final_score"),
  sanityChecks: jsonb("sanity_checks"), // Price, MOQ, UOM validation results
  createdAt: timestamp("created_at").defaultNow(),
});

export const systemHealth = pgTable("system_health", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  service: text("service").notNull().unique(),
  status: text("status").notNull(), // online, offline, delayed
  lastCheck: timestamp("last_check").defaultNow(),
  responseTime: integer("response_time"),
  errorMessage: text("error_message"),
});

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});

export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertErrorLogSchema = createInsertSchema(errorLogs).omit({
  id: true,
  createdAt: true,
});



export const insertEmailQueueSchema = createInsertSchema(emailQueue).omit({
  id: true,
  createdAt: true,
});

export const insertSystemHealthSchema = createInsertSchema(systemHealth).omit({
  id: true,
});

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Customer = typeof customers.$inferSelect;
export const insertCustomerSchema = createInsertSchema(customers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const updateCustomerSchema = insertCustomerSchema.partial();

export type Contact = typeof contacts.$inferSelect;
export const insertContactSchema = createInsertSchema(contacts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type Item = typeof items.$inferSelect;
export const insertItemSchema = createInsertSchema(items).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const updateItemSchema = insertItemSchema.partial();

export const insertItemAliasSchema = createInsertSchema(itemAlias).omit({
  id: true,
  createdAt: true,
});

export const insertItemVendorXrefSchema = createInsertSchema(itemVendorXref).omit({
  id: true,
  createdAt: true,
});

export const insertChargeMapSchema = createInsertSchema(chargeMap).omit({
  id: true,
  createdAt: true,
});

export const insertLineItemValidationAuditSchema = createInsertSchema(lineItemValidationAudit).omit({
  id: true,
  createdAt: true,
});

export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type UpdateCustomer = z.infer<typeof updateCustomerSchema>;
export type InsertContact = z.infer<typeof insertContactSchema>;
export type InsertItem = z.infer<typeof insertItemSchema>;
export type UpdateItem = z.infer<typeof updateItemSchema>;
export type InsertItemAlias = z.infer<typeof insertItemAliasSchema>;
export type InsertItemVendorXref = z.infer<typeof insertItemVendorXrefSchema>;
export type InsertChargeMap = z.infer<typeof insertChargeMapSchema>;
export type InsertLineItemValidationAudit = z.infer<typeof insertLineItemValidationAuditSchema>;

export type ItemAlias = typeof itemAlias.$inferSelect;
export type ItemVendorXref = typeof itemVendorXref.$inferSelect;
export type ChargeMap = typeof chargeMap.$inferSelect;
export type LineItemValidationAudit = typeof lineItemValidationAudit.$inferSelect;

export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type InsertPurchaseOrder = z.infer<typeof insertPurchaseOrderSchema>;

export type ErrorLog = typeof errorLogs.$inferSelect;
export type InsertErrorLog = z.infer<typeof insertErrorLogSchema>;

export type EmailQueue = typeof emailQueue.$inferSelect;
export type InsertEmailQueue = z.infer<typeof insertEmailQueueSchema>;

export type SystemHealth = typeof systemHealth.$inferSelect;
export type InsertSystemHealth = z.infer<typeof insertSystemHealthSchema>;

// Classification result type
export const classificationResultSchema = z.object({
  analysis_flags: z.object({
    attachments_present: z.boolean(),
    body_sufficiency: z.boolean(),
    sample_flag: z.boolean(),
    confidence: z.number().min(0).max(1),
    artwork_only: z.boolean(),
  }),
  recommended_route: z.enum(["TEXT_PO", "ATTACHMENT_PO", "REVIEW"]),
  tags: z.array(z.string()),
});

export type ClassificationResult = z.infer<typeof classificationResultSchema>;

// Customer Resolution Audit - tracks hybrid customer validation attempts
export const customerResolutionAudit = pgTable("customer_resolution_audit", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  queryData: jsonb("query_data"),
  topCandidates: jsonb("top_candidates"), 
  selectedCustomerId: text("selected_customer_id"),
  confidenceScore: real("confidence_score"),
  method: text("method"),
  reasons: jsonb("reasons"),
  llmResponse: jsonb("llm_response"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertCustomerResolutionAuditSchema = createInsertSchema(customerResolutionAudit).omit({
  id: true,
  createdAt: true,
});

export type CustomerResolutionAudit = typeof customerResolutionAudit.$inferSelect;
export type InsertCustomerResolutionAudit = z.infer<typeof insertCustomerResolutionAuditSchema>;
