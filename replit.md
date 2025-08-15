# Purchase Order Processing System

## Overview

This is a full-stack web application designed to automate the processing of purchase orders from email sources. The system integrates with multiple external services including Gmail, OpenAI for classification, Airtable for operational data storage, Dropbox for document management, and NetSuite for final sales order creation. The application provides a dashboard interface for monitoring and managing the entire purchase order processing workflow.

## User Preferences

Preferred communication style: Simple, everyday language.

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
- **Tables**: Users (authentication), Purchase Orders (core data), Error Logs (monitoring), Email Queue (processing pipeline), System Health (monitoring)
- **Schema Features**: UUID primary keys, JSONB columns for flexible data storage, timestamp tracking, status enums
- **Connection**: Node.js pg driver with connection pooling and SSL support

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
- **Airtable-Style Admin Portal**: Comprehensive purchase order management interface with search, filtering, sorting, status badges, customer data display, and detailed modal views successfully implemented and displaying authentic Gemini-extracted data (August 15, 2025)

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
- **Airtable API**: Operational database for purchase orders and error logs
- **Tables**: Purchase Orders table with status tracking, Error Logs table for operational monitoring
- **Sync**: Bidirectional synchronization between local PostgreSQL and Airtable

### Document Management
- **Dropbox API**: PDF storage and retrieval by filename
- **File Management**: Original purchase order PDFs, artwork filtering, document attachment to NetSuite records

### ERP Integration
- **NetSuite REST API**: Sales order creation with custom User Event scripts
- **Features**: Customer lookup/creation, shipping method mapping, line item matching, fallback SKU handling
- **Data Mapping**: FinalSKU preference with OE_MISC_ITEM fallbacks

### Development & Deployment
- **Replit Platform**: Development environment with live reload and error overlay
- **Build Process**: Vite for frontend, esbuild for backend bundling
- **Environment Variables**: Secure API key management for all external services