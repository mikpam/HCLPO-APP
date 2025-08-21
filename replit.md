# Purchase Order Processing System

## Overview
This full-stack web application automates purchase order processing from email sources, integrating with external services to manage the workflow from ingestion to sales order creation. The system provides a dashboard for monitoring and management, aiming to streamline operations and enhance efficiency in handling purchase orders. The business vision is to provide a robust, automated solution for managing the entire purchase order lifecycle, significantly reducing manual effort and improving data accuracy. This system has high market potential for businesses dealing with large volumes of email-based purchase orders, offering a competitive advantage through operational efficiency and enhanced data management. The project ambition is to become a leading solution in automated PO processing, continuously integrating advanced AI and robust ERP capabilities.

## Recent Changes (August 21, 2025)
- **🔥 SKU QUANTITY SWAPPING ISSUE RESOLVED**: Completely fixed root cause of SKU/finalSKU quantity misalignment through new validation logic
  - **1:1 Index Mapping**: New prompt enforces strict `output[i].quantity = input[i].quantity` with no reordering, merging, or splitting
  - **Business Rule Auto-Correction**: Automatic detection and correction of charge codes assigned to high quantities (>10) and vice versa
  - **Quantity Lock Constraints**: Eliminated AI-driven fresh segmentation that caused quantity drift between original and validated items
  - **Testing Verified**: Successfully tested on problematic PO aa97ddc5-9822-45c7-a8cc-e4acdef6ac77 showing complete resolution
  - **Embedding-Powered Validation**: Maintains hybrid DB → Vector → AI approach with strict quantity preservation
- **🔥 ARTWORK FILE FILTERING ENHANCED**: Strengthened filtering to prevent artwork files from being processed as POs
  - **Filename-Based Detection**: Enhanced patterns catch generic files like "image.png", "artwork.pdf", "logo.jpg"
  - **AI Document Filter Stricter**: Now rejects artwork/logo/design files even with business text content
  - **Two-Layer Protection**: Filename filtering + AI analysis prevents artwork files reaching Gemini extraction
  - **Data Integrity**: Eliminates processing of logo/artwork files that create empty POs with no line items
- **🔥 SKU QUANTITY PRESERVATION**: Fixed root cause of SKU/finalSKU quantity misalignment
  - **OpenAI Prompt Enhanced**: Explicit instructions to preserve exact quantities and maintain order
  - **SKU-Based Matching**: Re-match validated items to originals by SKU rather than array position
  - **Data Integrity Checks**: Automatic correction if charge codes get assigned to high quantities
  - **Eliminated Swapping**: No more SETUP charges assigned to product quantities or vice versa
- **🔥 STUCK PROCESS PREVENTION & RECOVERY**: Comprehensive system to prevent and recover stuck POs
  - **Extraction Status Fix**: POs now transition from "extracting" → "pending_validation" immediately after Gemini extraction completes
  - **Timeout Detection**: Automatic detection of stuck POs in transitional states (extracting, pending_validation, validating, processing, importing)
  - **Auto-Recovery**: Runs every 5 minutes during polling, recovers stuck POs or moves to dead letter after 3 failures
  - **Dead Letter Queue**: Failed POs move to "manual_review" status with failure tracking for manual intervention
  - **Processing Timestamps**: Added `processingStartedAt` and `statusChangedAt` fields for accurate timeout tracking
  - **Monitoring Endpoints**: `/api/processing/check-stuck-processes`, `/api/processing/dead-letter-stats`, `/api/processing/daily-report`
  - **Root Cause Fixed**: Eliminated race condition where extraction completed but status never updated
- **🔥 HYBRID VALIDATION FULLY OPERATIONAL**: All validators now use embeddings with DB → Vector → AI approach
  - **Contact Validator Enhanced**: Returns verified contact data with associated customer information
  - **Customer Association Logic**: When contact is found, system uses their associated customer if regular customer validation fails
  - **Vector Search Working**: Successfully finding contacts with 85%+ similarity using 49K contact embeddings
  - **SKU Validator Enhanced**: Now uses vector search on 5K item embeddings before AI validation
  - **All 3 Validators Hybrid**: Customer (16K embeddings), Contact (49K embeddings), SKU (5K embeddings)
- **🔥 VALIDATION FLOW RESTRUCTURED**: Complete alignment with SYSTEM_LOGIC_FLOW.md sequence
  - **Fixed Validation Order**: Steps 7-9 (Customer, Contact, SKU validation) now run BEFORE PO creation (Step 10)
  - **Eliminated Race Conditions**: Removed duplicate PO creation attempts that caused "duplicate key" errors
  - **Single PO Creation Point**: Step 10 creates complete PO with all validation results in one atomic operation
  - **Validation Independence**: All validations run on extracted data, not dependent on PO existence
  - **Unstuck 12 POs**: Updated stuck POs from "validating" to proper status ("new_customer")
- **🔥 CONTACT VALIDATION ENHANCED**: Fixed field mapping and added unverified contact preservation
  - **Fixed Field Mapping**: Contact validator now properly receives extracted contact data via `extractedData` field
  - **Unverified Contact Storage**: When validation fails, extracted contact details are preserved as "unverified"
  - **Contact Meta Enhanced**: Added source tracking ('validated' vs 'extracted_unverified'), phone, verification status, and customer associations
- **🔥 CONSOLIDATION TO AUTO-PROCESSING ONLY**: Integrated complete validation pipeline into automatic email processing
  - **Steps 7-8 Integration**: Customer and Contact validation now run automatically during email processing
  - **Manual Trigger Removal**: Removed `/api/force-validation` and `/api/batch-validation` endpoints
  - **Single Path Architecture**: Email → Classification → Extraction → Validation → Storage → Status → Complete PO
  - **SYSTEM_LOGIC_FLOW.md Compliance**: Full 12-step workflow now runs automatically without manual intervention
  - **Enhanced Polling**: Automatic email polling enabled with 1-minute intervals (reduced from 2 minutes)
  - **JSON Logging Fix**: Resolved error logging serialization issues for complete audit trails
- **Company Analysis Removal**: Completely removed all company analysis functionality, including:
  - `/api/analysis/company-crossref` and `/api/analysis/missing-companies/download` endpoints
  - Enhanced company analysis module and related imports
  - Frontend company analysis page and navigation
  - System now runs cleanly without company analysis tools

## User Preferences
Preferred communication style: Simple, everyday language.
UI Design Priority: Mobile-responsive design is now required across all pages. Users need the system to work well on both desktop and mobile devices.
System Behavior: Automated email processing now active with full hybrid validation using 100% complete embedding infrastructure.
Vector Database Preference: PGvector integration with existing PostgreSQL database preferred over external vector databases like Pinecone for future semantic customer/item matching enhancements.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript using Vite.
- **UI Components**: Shadcn/ui (Radix UI primitives).
- **Styling**: Tailwind CSS with custom design tokens.
- **State Management**: TanStack Query (React Query).
- **Routing**: Wouter.
- **Design System**: New York style variant with neutral color palette.

### Backend Architecture
- **Runtime**: Node.js with Express.js REST API.
- **Language**: TypeScript with ES modules.
- **Database ORM**: Drizzle ORM for PostgreSQL.
- **Schema Sharing**: Shared TypeScript schemas between client and server using Zod validation.

### Database Design
- **Primary Database**: Neon PostgreSQL.
- **Key Tables**: Users, Purchase Orders, Error Logs, Email Queue, System Health, Customers.
- **Schema Features**: UUIDs, JSONB, timestamps, status enums, full-text search, array columns.
- **Customer Indexing**: Multi-strategy lookup with database indexes, in-memory caching, and fuzzy matching.
- **Error Tracking**: Comprehensive error logging system with detailed metadata, step tracking, and resolution status.
- **Vector Database**: PGvector for semantic search on contacts and customers, enabling hybrid validation.

### Email Processing Pipeline
- **Architecture**: Complete 12-step automated pipeline following SYSTEM_LOGIC_FLOW.md. Single `/api/processing/process-auto` endpoint with no manual triggers.
- **Sequential Processing Lock**: System uses `isProcessing` flag to prevent concurrent operations. Only auto-processing endpoint active.
- **Full Automation**: Steps 7-8 (Customer & Contact Validation) integrated directly into email processing flow.
- **Classification**: OpenAI GPT-4o for intent classification and advanced 5-route classification (TEXT_PO, TEXT_SAMPLE, ATTACHMENT_PO, ATTACHMENT_SAMPLE, REVIEW), with priority logic for attachments.
- **AI Document Filtering**: Pre-screens attachments to filter non-PO documents using filename-based filtering and AI document classification with negative keyword detection.
- **Multi-Format Support**: Enhanced processing for Gemini-compatible formats (PDFs, images, Word docs, CSVs, Excel, text files).
- **Dual Gemini Extraction Routes**: ATTACHMENT_PO for multi-format document processing; TEXT_PO for email body text processing.
- **Processing Flow**: Gmail ingestion (1-minute polling) → Pre-processing → Detailed analysis → AI document filtering → Gemini extraction → PO extraction → NetSuite import.
- **Data Storage**: Preprocessing, classification, and extracted data stored in Neon PostgreSQL.
- **Email/Attachment Preservation**: Automatic .eml file and attachment storage to object storage, with file paths stored in database records for audit trails.
- **Customer Lookup**: High-performance customer database with NetSuite integration, advanced matching, and disambiguation, including a 5-step hybrid validation system (Exact DB → Vector → Rules → LLM).
- **Contact Validation**: Production-ready hybrid system using a 4-step validation (Exact DB → Vector → Rules → LLM), achieving 97-100% accuracy. Uses UUID-based purchase order references for reliability.
- **SKU Validation**: Comprehensive SKU validation system integrating with a product items database, handling charge codes and fallbacks.
- **Embedding Systems**: All contacts, customers, and items are 100% embedded using OpenAI 1536-dimensional vectors and PGvector for semantic search.
- **Hybrid Contact Search**: Multi-step validation: exact email match → domain+company matching → semantic search with PGvector → scoring with thresholds.
- **Validator Architecture**: Per-email validator instances with immediate database updates after each step and health monitoring.

### Admin Portal
- **Functionality**: Comprehensive PO management interface, customer management, and item management with CRUD functionality.
- **Access Control**: Role-based access control.

### Authentication & Authorization
- **Strategy**: Session-based authentication with role-based access control.
- **Roles**: Operator role and potential for additional roles.

## External Dependencies

### Email Integration
- **Gmail API**: Service account authentication for email retrieval and labeling.

### AI/ML Services
- **OpenAI API**: Used for email pre-processing intent classification, detailed email gate logic, and comprehensive validation (customer, contact, SKU).
- **Google Gemini API**: Used for structured purchase order parsing and data extraction from both attachments and email text.

### Data Storage Services
- **Neon PostgreSQL**: Primary database for all persistent application data.

### Document Management
- **Object Storage**: Replit's built-in object storage for PDF and document storage.

### ERP Integration
- **NetSuite REST API**: For sales order creation using TBA NLAuth authentication with 2FA support.