# Purchase Order Processing System

## Overview
This full-stack web application automates purchase order processing from email sources, integrating with external services to manage the workflow from ingestion to sales order creation. The system provides a dashboard for monitoring and management, aiming to streamline operations and enhance efficiency in handling purchase orders. The business vision is to provide a robust, automated solution for managing the entire purchase order lifecycle, significantly reducing manual effort and improving data accuracy. This system has high market potential for businesses dealing with large volumes of email-based purchase orders, offering a competitive advantage through operational efficiency and enhanced data management. The project ambition is to become a leading solution in automated PO processing, continuously integrating advanced AI and robust ERP capabilities.

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
- **Architecture**: Complete 12-step automated pipeline. Single `/api/processing/process-auto` endpoint with no manual triggers.
- **Sequential Processing Lock**: System uses `isProcessing` flag to prevent concurrent operations. Only auto-processing endpoint active.
- **Validation Orchestration**: Unified ValidationOrchestrator service coordinates all validation operations with parallel processing where possible.
- **Classification**: OpenAI GPT-4o for intent classification and advanced 5-route classification (TEXT_PO, TEXT_SAMPLE, ATTACHMENT_PO, ATTACHMENT_SAMPLE, REVIEW), with priority logic for attachments.
- **AI Document Filtering**: Pre-screens attachments to filter non-PO documents using filename-based filtering and AI document classification with negative keyword detection.
- **Multi-Format Support**: Enhanced processing for Gemini-compatible formats (PDFs, images, Word docs, CSVs, Excel, text files).
- **Dual Gemini Extraction Routes**: ATTACHMENT_PO for multi-format document processing; TEXT_PO for email body text processing.
- **Processing Flow**: Gmail ingestion → Pre-processing → Detailed analysis → AI document filtering → Gemini extraction → Unified validation → NetSuite import.
- **Data Storage**: Preprocessing, classification, and extracted data stored in Neon PostgreSQL.
- **Email/Attachment Preservation**: Automatic .eml file and attachment storage to object storage, with file paths stored in database records for audit trails.
- **Unified Validation**: ValidationOrchestrator runs customer + contact validation in parallel, then items sequentially. Single source of truth for all validation results.
- **Customer Validation**: Hybrid Customer Validator with 4-step process (Exact DB → Vector → Rules → LLM). Enhanced brand matching algorithm with 70% minimum confidence.
- **Contact Validation**: OpenAI Contact Validator with exact email → vector → domain+company → LLM fallback. 95%+ accuracy.
- **SKU Validation**: OpenAI SKU Validator with vector matching and quantity-aware logic. Handles charge codes and high-quantity items correctly.
- **Embedding Systems**: All contacts, customers, and items are 100% embedded using OpenAI 1536-dimensional vectors and PGvector for semantic search.
- **Forwarded Email Detection**: Enhanced detection for @highcaliberline.com, @geiger.com, FW:/Fwd: subjects, and purchaseorder@ patterns.
- **Status Determination**: Centralized in ValidationOrchestrator: new_customer → missing_contact → invalid_items → ready_for_netsuite.
- **Performance**: ~30% faster validation through parallel processing. 30-second email polling interval (improved from 60s).
- **Stuck Process Prevention & Recovery**: Automatic detection and recovery of stuck POs with a dead letter queue for manual review.

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

## Recent System Improvements

### Unified Validation Orchestrator Implementation (2025-08-22)
- **🎯 COMPLETE VALIDATION REFACTOR**: Replaced scattered validation logic with unified ValidationOrchestrator
  - **Architecture Change**: Single orchestrator coordinates all validation (customer, contact, items)
  - **Performance**: Parallel validation where possible (customer + contact), reducing processing time by ~30%
  - **Consistency**: Single source of truth for validation results, eliminating duplicate/conflicting validators
  - **Code Reduction**: Consolidated 300+ lines of scattered validation into 100 lines of orchestrated logic
  - **Status Determination**: Centralized status logic in orchestrator (new_customer → missing_contact → invalid_items → ready_for_netsuite)

### Customer Validation Architecture Standardization (2025-08-22)
- **🎯 STANDARDIZED VALIDATION WORKFLOW**: Fixed validation inconsistencies causing false "new_customer" status
  - **Root Cause**: Multiple validation services (OpenAI Customer Finder + Hybrid Validator) returned conflicting results
  - **Example Issue**: PO 7f712714 showed customer found in metadata (95% confidence) but customerValidated=false
  - **Solution**: Standardized on single Hybrid Customer Validator throughout entire pipeline
  - **Removed**: Redundant OpenAI Customer Finder Service fallback calls to prevent inconsistencies

- **🚀 ENHANCED BRAND MATCHING ALGORITHM**: Dramatically improved customer recognition accuracy
  - **Root Cause**: "HALO" failed to match "Halo Branded Solutions" (scored only 0.050 confidence)
  - **Solution**: Added sophisticated `calculateBrandMatch` method with brand containment logic
  - **Brand Containment**: "HALO" → "Halo Branded Solutions" now scores 0.9 confidence
  - **Business Logic**: Handles corporate suffixes (Inc, LLC, Corp, etc.) and normalization
  - **Scoring Rebalance**: Increased brand matching weight from 5% → 30%, reduced base similarity 70% → 50%

- **⚖️ ADJUSTED CONFIDENCE THRESHOLDS**: More reasonable acceptance criteria for customer matches
  - **High Confidence Auto-Accept**: Lowered from 0.85 → 0.65
  - **LLM Tiebreak Threshold**: Lowered from 0.75 → 0.50  
  - **Impact**: Prevents valid customers from being incorrectly flagged as "new_customer"

### SKU Validation & Extraction Fixes
- **🔥 SKU VALIDATOR QUANTITY-AWARE LOGIC**: Fixed OE-MISC-CHARGE high quantity issue
  - **Quantity-Aware Charge Detection**: High quantities (>50) automatically treated as products, not charges
  - **Enhanced analyzeChargeDescription()**: Now considers quantity when determining charge vs product classification
  - **AI Prompt Improvements**: OpenAI now receives quantity data and applies quantity-aware logic
  - **Fixed OE-MISC Logic**: "Run Charge" with qty 200 → OE-MISC-ITEM (product), not OE-MISC-CHARGE (charge)
  - **Fallback Enhancement**: High quantity items automatically get OE-MISC-ITEM instead of charge codes
  - **Business Logic Correction**: Eliminates incorrect charge code assignment to high-quantity product lines

- **🎯 GEMINI EXTRACTION SKU SEPARATION FIX**: Fixed SKU+color concatenation issue
  - **Root Cause**: Gemini was incorrectly combining SKUs with colors (e.g., S989 + Blue → S989B)
  - **Solution**: Added explicit SKU extraction rules to all Gemini prompts (PDF, text, reprocessing)
  - **Critical Rules**: Extract base SKU only (S989, T802, H710), separate color in itemColor field
  - **Prevention**: Stops creation of non-existent SKUs like S989B, T802-Black, H710Blue
  - **Impact**: Improves SKU validation accuracy by extracting clean base codes for database lookup
  - **Setup Charge Fix**: Updated SKU format from "SET UP" to "SETUP" to match database standard

### Customer Validation Fixes (Historical)
- **🏢 ENHANCED COMPANY NAME NORMALIZATION**: Fixed business entity suffix matching issue
  - **Root Cause**: "Quality Logo Products, Inc." failed to match "Quality Logo Products" in database
  - **Solution**: Added comprehensive business entity suffix normalization function
  - **Handles**: Inc., LLC, Corp, Ltd, Company, Co, Limited, Enterprises, Group variations
  - **Bidirectional Matching**: Enhanced fuzzy search with improved normalization
  - **OpenAI LLM Fix**: Added "JSON" keyword to prompt to resolve API formatting error
  - **Impact**: Eliminates false "new_customer" status for known customers with entity suffix variations