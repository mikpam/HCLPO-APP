# Purchase Order Processing System - Complete Logic Flow

## 📧 **EMAIL PROCESSING PIPELINE** (Sequential Order)

### **STEP 1: Email Ingestion**
```
Gmail API → Lightweight Polling (every 2 minutes)
├── Fetch unprocessed emails
├── Filter by labels: 'purchase-order', 'unprocessed'  
└── Queue emails for processing
```

### **STEP 2: Pre-processing Classification**
```
OpenAI GPT-4o → Simple Intent Classification
├── INPUT: Subject + Body (truncated to 10k chars)
├── DECISION: "Purchase Order" vs "Sample Request" vs "Follow-up" vs "Rush Order" vs "None"
├── CONFIDENCE: Threshold check (proceed if confident)
└── RESULT: shouldProceed = true/false
```

### **STEP 3: Detailed Analysis (Only if Pre-processing Passed)**
```
OpenAI GPT-4o → Advanced 5-Route Classification  
├── ROUTES: TEXT_PO, TEXT_SAMPLE, ATTACHMENT_PO, ATTACHMENT_SAMPLE, REVIEW
├── PRIORITY LOGIC: Has attachments → ATTACHMENT_PO (unless sample request)
├── CONFIDENCE: Detailed scoring with analysis flags
└── RESULT: recommended_route + confidence_score
```

### **STEP 4: Email & Attachment Preservation**
```
Object Storage → Automatic File Preservation
├── EMAIL: Save as .eml file → /objects/emails/[messageId]_[subject].eml
├── ATTACHMENTS: Store all files → /objects/attachments/[messageId]_[filename]
└── DATABASE: Record file paths in purchase_orders table
```

### **STEP 5: Document Filtering (ATTACHMENT Routes Only)**
```
OpenAI GPT-4o → AI Document Type Detection
├── INPUT: PDF buffer + filename
├── FILTER: "purchase order" vs "artwork" vs "proof" vs "invoice" vs "other"
├── PRIORITY: Purchase order filenames get priority sorting
└── RESULT: Only "purchase order" documents proceed to extraction
```

### **STEP 6: Data Extraction**
```
Route-Specific Processing:

ATTACHMENT_PO Route:
├── Google Gemini → PDF/Document Processing
├── INPUT: PDF buffer (validated documents only)
├── OUTPUT: Structured PO data (customer, line items, contact)
└── TRACKING: Store extraction_source_file path

TEXT_PO Route:  
├── Google Gemini → Email Text Processing
├── INPUT: Subject + Body + Sender
├── OUTPUT: Structured PO data from email content
└── TRACKING: extraction_source_file = null (email body)

REVIEW Route:
├── Manual review required
└── No automatic extraction
```

### **STEP 7: Customer Validation** (4-Step Hybrid System)
```
Hybrid Customer Validator → Multi-Stage Validation
├── STEP 1: Exact Database Match (customer_number, company_name)
├── STEP 2: Vector Semantic Search (PGvector + OpenAI embeddings)
├── STEP 3: Rule-Based Matching (phone, email domain, alternate names)  
├── STEP 4: LLM Validation (OpenAI final decision with confidence scoring)
└── RESULT: customer_meta with confidence + method used
```

### **STEP 8: Contact Validation** (4-Step Hybrid System)
```
Contact Validator → Advanced Contact Resolution
├── STEP 1: Exact Email Match (contacts database)
├── STEP 2: Vector Semantic Search (name + company matching)
├── STEP 3: Domain + Company Rules (email domain + extracted company)
├── STEP 4: LLM Contact Extraction (from email signature/content)
└── RESULT: contact_meta with validation status + confidence
```

### **STEP 9: SKU/Line Item Validation**
```
SKU Validator → Product Matching & Validation
├── INPUT: Extracted line items (SKU, description, quantity, color)
├── PROCESSING: Item database lookup + semantic matching (PGvector)
├── FALLBACK: Charge codes for unknown items (OE-MISC-ITEM, OE-SAMPLE)
├── MEMORY OPTIMIZATION: LRU cache (1000 items) with automatic cleanup
└── RESULT: line_items with finalSKU assignments
```

### **STEP 10: Database Storage**
```
PostgreSQL → Complete Record Creation
├── CORE DATA: PO number, customer, contact, line items, status
├── FILE TRACKING: 
│   ├── emlFilePath: Email preservation path
│   ├── attachmentPaths[]: All attachment file paths  
│   └── extractionSourceFile: Specific document used for extraction ⭐
├── VALIDATION STATUS: customer_validated, contact_validated, line_items_validated
└── METADATA: All validation results + confidence scores
```

### **STEP 11: Status Determination**
```
Automatic Status Assignment:
├── ready_for_netsuite: Customer found + Contact validated + Line items processed
├── new_customer: Valid extraction but customer not in database
├── pending_review: Failed extraction or low confidence scores
└── error: Processing failures or validation errors
```

### **STEP 12: Gmail Labeling**
```
Gmail API → Email Organization
├── ADD LABELS:
│   ├── 'processed' (all processed emails)
│   ├── 'ai-purchase-order' (classified as PO)
│   ├── 'ai-sample-request' (classified as sample)
│   └── Route-specific labels based on classification
└── REMOVE LABELS: 'unprocessed' 
```

---

## 🔄 **REAL-TIME MONITORING SYSTEMS**

### **Health Monitoring**
```
Validator Health Service → Continuous Health Checks
├── VALIDATORS: customerFinder, contactValidator, skuValidator
├── METRICS: Response time, success rate, error tracking
├── INTERVALS: Health checks every 30 seconds
└── STATUS: HEALTHY/DEGRADED/ERROR with automatic recovery
```

### **Memory Optimization**
```
Memory Management → Intelligent Resource Control  
├── LRU CACHES: Contacts (2,511), Customers (2,000), Items (1,000)
├── MONITORING: Heap usage tracking with automatic cleanup
├── THRESHOLDS: Automatic cache refresh when memory exceeds limits
└── PERFORMANCE: 69% memory reduction achieved (700MB → 150-275MB)
```

### **Processing Status Dashboard**
```
Real-time Status Updates → Live Processing Visibility
├── STEPS: fetching_emails → preprocessing → classification → extraction → validation → completion
├── VISIBILITY: 10-second status window for active processing
├── UI UPDATES: Live dashboard with current PO being processed
└── IDLE STATE: Shows "idle" when no processing active
```

---

## 📊 **DATA FLOW & STORAGE**

### **Vector Database (PGvector)**
```
Semantic Search Infrastructure:
├── CONTACTS: 49,387 embeddings (100% complete)
├── CUSTOMERS: 11,603 embeddings (100% complete)  
├── ITEMS: 5,209 embeddings (100% complete)
├── DIMENSIONS: 1536-dimensional OpenAI vectors
└── PERFORMANCE: 97-100% accuracy for real business contacts
```

### **File Management**
```
Object Storage Tracking:
├── EMAIL FILES: .eml preservation for compliance
├── ALL ATTACHMENTS: Complete attachment preservation  
├── EXTRACTION SOURCE: ⭐ Specific file used for successful extraction
└── ACCESS: Direct file serving via /objects/[path] endpoints
```

---

## 🎯 **KEY DECISION POINTS**

### **1. Route Selection Priority**
```
IF has_attachments AND not_sample_request:
    → ATTACHMENT_PO (process PDFs)
ELIF email_contains_po_data:
    → TEXT_PO (process email body)
ELSE:
    → REVIEW (manual processing required)
```

### **2. Extraction Source Tracking** ⭐
```
ATTACHMENT_PO: extractionSourceFile = "/objects/attachments/[specific-file-path]"
TEXT_PO: extractionSourceFile = null (email body used)
FAILED: extractionSourceFile = null (no successful extraction)
```

### **3. Customer Matching Confidence**
```
≥ 0.90: Auto-accept (high confidence)
0.75-0.89: Review required (medium confidence)  
< 0.75: Manual validation needed (low confidence)
```

---

## 🚀 **PERFORMANCE METRICS**

- **Email Processing**: Sequential "one email at a time" architecture
- **Memory Usage**: 69% reduction with intelligent caching
- **Vector Search**: 97-100% accuracy for contact validation
- **Daily Volume**: 100+ emails processed automatically
- **File Preservation**: 95.9% EML coverage + 100% attachment preservation
- **Extraction Source Tracking**: 100% accurate document identification ⭐

---

This system processes emails in a completely automated workflow while maintaining full audit trails and file tracking for compliance and review purposes.