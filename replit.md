# Purchase Order Processing System

## Overview

This is a full-stack web application designed to automate the processing of purchase orders from email sources. The system integrates with multiple external services including Gmail, OpenAI for classification, Airtable for operational data storage, Dropbox for document management, and NetSuite for final sales order creation. The application provides a dashboard interface for monitoring and managing the entire purchase order processing workflow.

## User Preferences

Preferred communication style: Simple, everyday language.
UI Design Priority: Mobile-responsive design is now required across all pages. Users need the system to work well on both desktop and mobile devices.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript using Vite as the build tool
- **UI Components**: Shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with custom design tokens and CSS variables
- **State Management**: TanStack Query (React Query) for server state management
- **Routing**: Wouter for client-side routing
- **Design System**: New York style variant with neutral color palette

### Backend Architecture
- **Runtime**: Node.js with Express.js REST API
- **Language**: TypeScript with ES modules
- **Database ORM**: Drizzle ORM configured for PostgreSQL
- **Schema Sharing**: Shared TypeScript schemas between client and server using Zod validation
- **Development**: Hot reload with Vite middleware integration

### Database Design
- **Primary Database**: Neon PostgreSQL with Drizzle ORM for persistent data storage
- **Tables**: Users (authentication), Purchase Orders (core data), Error Logs (monitoring), Email Queue (processing pipeline), System Health (monitoring), Customers (master data for 5,000+ records)
- **Schema Features**: UUID primary keys, JSONB columns for flexible data storage, timestamp tracking, status enums, full-text search vectors, array columns for alternate names
- **Connection**: Node.js pg driver with connection pooling and SSL support
- **Customer Indexing**: Multi-strategy lookup system with database indexes, in-memory caching, and fuzzy matching algorithms

### Email Processing Pipeline
- **Two-Step Processing Architecture**: Mirrors existing Make.com workflow structure for easier migration
- **Step 1 - Pre-processing**: OpenAI GPT-4o performs simple intent classification (Purchase Order, Sample Request, Rush Order, Follow Up, None)
- **Step 2 - Detailed Analysis**: Advanced 5-route classification only for qualifying emails (Purchase Order, Sample Request, Rush Order)
- **Filtering Logic**: Follow Up and "None of these" emails are filtered out before detailed analysis
- **Classification Routes**: TEXT_PO, TEXT_SAMPLE, ATTACHMENT_PO, ATTACHMENT_SAMPLE, REVIEW (5-route classification system)
- **Advanced Gate Logic**: Artwork detection, body text sufficiency analysis, sample vs full order distinction, confidence scoring
- **AI Document Filtering Layer**: Pre-screens all attachments before Gemini processing to filter out artwork, proofs, invoices, and non-PO documents
- **Multi-Format Document Support**: Enhanced processing for all Gemini-compatible formats (PDFs, images, Word docs, CSVs, Excel, text files)
- **Enhanced MIME Type Detection**: Automatic format recognition and proper MIME type assignment for optimal Gemini processing
- **Dual Gemini Extraction Routes**: 
  - ATTACHMENT_PO: Multi-format document processing with AI filtering → Gemini extraction for validated PO documents only
  - TEXT_PO: Email text processing with structured schema extraction from subject + body + sender
- **Processing Flow**: Gmail ingestion → Pre-processing classification → Detailed analysis (if qualified) → AI document filtering → Gemini extraction (filtered documents or text) → real client PO extraction → NetSuite import
- **Database Storage**: Preprocessing, classification, and extracted data (with real client PO numbers) stored in Neon PostgreSQL
- **Manual Processing Mode**: Development uses single-email processing with detailed console tracing for debugging
- **Enhanced Gmail Labeling**: Preprocessing classifications now automatically apply Gmail labels for auditing (ai-purchase-order, ai-sample-request, ai-rush-order, ai-follow-up, ai-none-of-these)
- **Successful Implementation**: Both ATTACHMENT_PO and TEXT_PO routes successfully extracting real client PO numbers with enhanced AI filtering system and complete email queue tracking including filtered emails (August 15, 2025)
- **Admin Portal**: Comprehensive purchase order management interface with search, filtering, sorting, status badges, customer data display, and detailed modal views successfully implemented and displaying authentic Gemini-extracted data (August 15, 2025)
- **Customer Lookup System**: High-performance customer database with 6,185+ HCL customer records imported, advanced customer finder service with priority matching (email > ASI/PPAI > name > address), brand overrides, and sophisticated disambiguation logic (August 16, 2025)
- **HCL Customer Integration**: Successfully imported 6,185 customer records from NetSuite with Internal IDs and CNumbers, enabling precise customer attribution for forwarded emails (August 16, 2025)
- **Advanced Customer Finder**: Intelligent customer matching service implementing comprehensive search strategies including query expansion, root brand extraction, and Gemini-powered disambiguation when multiple matches found (August 16, 2025)
- **Forwarded Email Processing**: Enhanced @highcaliberline.com email processing with CNumber extraction, HCL customer lookup, and fallback logic - uses Gemini extraction first, then HCL customer database for accurate attribution (August 16, 2025)
- **Complete Frontend Integration**: Successfully displaying HCL customer data with CNumber badges, forwarded email indicators, and proper customer attribution in both desktop and mobile views (August 16, 2025)
- **Architecture Simplification**: Removed Airtable and Dropbox integrations, streamlined to use only Neon PostgreSQL for data storage and Replit object storage for documents (August 16, 2025)
- **Email Preservation System**: Added automatic .eml file preservation for classified emails (Purchase Order, Sample Request, Rush Order) stored in object storage for complete audit trails and compliance (August 16, 2025)
- **New Customer Flagging**: Enhanced system to flag purchase orders with unknown customers as "new_customer" status for CSR review instead of proceeding to NetSuite (August 16, 2025)
- **Customer Database Maintenance**: Successfully resolved Target Business Services (C58346) missing customer issue, demonstrating system's ability to handle customer corrections and database updates for missing HCL customers (August 16, 2025)
- **OpenAI Customer Finder Integration**: Enhanced customer matching with sophisticated OpenAI-powered system using exact original prompt structure, email domain matching priority, name variation confidence (singular/plural), brand overrides, and root-first disambiguation for superior customer identification accuracy (August 17, 2025)
- **OpenAI SKU Validator Implementation**: Successfully implemented comprehensive SKU validation system processing ALL line items from Gemini JSON output with 5,372+ HCL items database integration, multi-item parsing via `____` separators, charge code detection (SETUP, 48-RUSH, P, etc.), and proper fallback handling for unknown SKUs as OE-MISC-ITEM (August 17, 2025)
- **Customer Admin Interface**: Replaced basic customer import functionality with comprehensive customer management admin tab featuring search, filtering, pagination, detailed customer modals, and mobile-responsive design for managing 6,185+ HCL customer records (August 17, 2025)
- **Comprehensive Customer Database Import**: Successfully imported complete HCL customer database increasing coverage from 6,189 to 13,662+ customer records with enhanced search aliases and data - now includes all missing customers for 100% HCL coverage (August 17, 2025)
- **Complete CRUD Customer Management**: Implemented full Create, Read, Update, Delete functionality for admin users with CustomerFormModal and DeleteCustomerModal components, proper form validation, role-based access control, and seamless integration with customer management interface - admin users can now create new customers, edit existing records, and deactivate/reactivate customers through intuitive modal interfaces (August 17, 2025)

### Authentication & Authorization
- **Strategy**: Session-based authentication with role-based access control
- **Roles**: Operator role for standard users with potential for additional roles
- **Security**: Password hashing, secure session management

## External Dependencies

### Email Integration
- **Gmail API**: Service account authentication for automated email retrieval from hcl@metrixdigital.com
- **Filtering**: Label-based filtering for "purchase-order" and "unprocessed" emails
- **Attachments**: PDF processing and content extraction capabilities

### AI/ML Services
- **OpenAI API**: GPT-4o model for both pre-processing intent classification AND detailed 5-route email gate logic
- **Pre-processing Prompt**: Exact replica of Make.com workflow classification (Purchase Order, Sample Request, Rush Order, Follow Up, None)
- **Detailed Classification**: Advanced gate logic with artwork detection, body text analysis, attachment routing decisions
- **Google Gemini API**: Gemini 2.5 Flash for dual extraction routes with structured purchase order parsing
- **ATTACHMENT_PO Route**: Gemini processes PDF attachments using file upload API with OCR and data extraction
- **TEXT_PO Route**: Gemini processes email text content (subject + body + sender) using structured schema extraction
- **Specialized Prompt Engineering**: Advanced OCR error correction, vendor/customer/ship-to identification, SKU processing with color mapping
- **Two-Step Workflow**: Pre-processing filters emails → Detailed analysis for qualified emails → Gemini extraction (PDF or text-based)
- **Real Client PO Numbers**: System extracts actual client PO numbers (e.g., "650494") instead of generating synthetic ones
- **Clear Separation**: OpenAI handles all email classification, Gemini handles all structured data extraction for both routes

### Data Storage Services
- **Neon PostgreSQL**: Primary database for purchase orders, customers, error logs, and operational monitoring
- **Persistent Storage**: All data stored locally in PostgreSQL with no external database dependencies

### Document Management
- **Object Storage**: PDF and document storage using Replit's built-in object storage
- **File Management**: Original purchase order PDFs, artwork filtering, and document attachments stored securely

### ERP Integration
- **NetSuite REST API**: Sales order creation with custom User Event scripts
- **Features**: Customer lookup/creation, shipping method mapping, line item matching, fallback SKU handling
- **Data Mapping**: FinalSKU preference with OE_MISC_ITEM fallbacks

### Development & Deployment
- **Replit Platform**: Development environment with live reload and error overlay
- **Build Process**: Vite for frontend, esbuild for backend bundling
- **Environment Variables**: Secure API key management for all external services