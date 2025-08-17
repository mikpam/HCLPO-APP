# Purchase Order Processing System

## Overview
This full-stack web application automates purchase order processing from email sources, integrating with external services to manage the workflow from ingestion to sales order creation. The system provides a dashboard for monitoring and management, aiming to streamline operations and enhance efficiency in handling purchase orders.

## User Preferences
Preferred communication style: Simple, everyday language.
UI Design Priority: Mobile-responsive design is now required across all pages. Users need the system to work well on both desktop and mobile devices.
System Behavior: Automated email processing should start immediately when server launches without manual prompting.

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

### Email Processing Pipeline
- **Architecture**: Two-step processing mirroring Make.com workflow.
- **Pre-processing**: OpenAI GPT-4o for intent classification (Purchase Order, Sample Request, Rush Order, Follow Up, None).
- **Detailed Analysis**: Advanced 5-route classification for qualifying emails (TEXT_PO, TEXT_SAMPLE, ATTACHMENT_PO, ATTACHMENT_SAMPLE, REVIEW).
- **AI Document Filtering**: Pre-screens attachments to filter out non-PO documents before Gemini processing.
- **Multi-Format Support**: Enhanced processing for Gemini-compatible formats (PDFs, images, Word docs, CSVs, Excel, text files).
- **Dual Gemini Extraction Routes**:
    - **ATTACHMENT_PO**: Multi-format document processing with AI filtering.
    - **TEXT_PO**: Email text processing with structured schema extraction from subject, body, and sender.
- **Processing Flow**: Gmail ingestion → Pre-processing → Detailed analysis → AI document filtering → Gemini extraction → PO extraction → NetSuite import.
- **Database Storage**: Preprocessing, classification, and extracted data stored in Neon PostgreSQL.
- **Email Preservation**: Automatic .eml file preservation for classified emails in object storage.
- **Customer Lookup**: High-performance customer database with NetSuite integration for precise customer attribution, including advanced matching and disambiguation.
- **SKU Validation**: Comprehensive SKU validation system integrating with a product items database, handling charge codes and fallbacks.
- **Admin Portal**: Comprehensive PO management interface, customer management, and item management with CRUD functionality and role-based access control.
- **Comprehensive Error Logging**: Advanced error tracking system that captures all processing failures with detailed context:
    - **Pre-processing Failures**: Classification errors and filtering issues
    - **Customer Lookup Failures**: Failed customer matches and new customer flags requiring review
    - **SKU Validation Failures**: Missing line items and product validation errors
    - **AI Extraction Failures**: Failed data extraction from emails and documents
    - **AI Filter Failures**: Potential false negatives in attachment screening
    - **Gmail Labeling Failures**: Email labeling and organization errors
    - **Error Metadata**: Detailed context including email IDs, PO numbers, processing steps, and troubleshooting data

### Authentication & Authorization
- **Strategy**: Session-based authentication with role-based access control.
- **Roles**: Operator role and potential for additional roles.

## External Dependencies

### Email Integration
- **Gmail API**: Service account authentication for email retrieval and labeling.

### AI/ML Services
- **OpenAI API**: Used for email pre-processing intent classification and detailed email gate logic.
- **Google Gemini API**: Used for structured purchase order parsing and data extraction from both attachments and email text.

### Data Storage Services
- **Neon PostgreSQL**: Primary database for all persistent application data.

### Document Management
- **Object Storage**: Replit's built-in object storage for PDF and document storage.

### ERP Integration
- **NetSuite REST API**: For sales order creation, including customer lookup/creation, shipping method mapping, and line item matching.

## System Status & Recent Changes

### Latest Updates (August 17, 2025)
- **✅ Comprehensive Error Logging System**: Implemented complete error tracking across all processing stages
  - All processing failures now logged to database with detailed context and metadata
  - Customer lookup failures (not found, new customer flags) tracked for manual review
  - SKU validation issues logged (missing line items, validation failures)
  - AI extraction failures captured (no data extracted, route failures)
  - AI attachment filtering logged for potential false negatives
  - Gmail labeling failures tracked across SSE and auto-processing modes
  - Error resolution workflow integrated with admin interface

### System Performance
- **Email Processing**: Automated background processing with 61+ POs processed successfully
- **Customer Database**: 13,662+ HCL customer records with advanced matching algorithms
- **SKU Validation**: 5,267+ product items with comprehensive fuzzy matching
- **Real-time Dashboard**: Live processing visualization with synchronized animations
- **Error Tracking**: Comprehensive logging ensures no failed items are lost

### Architecture Highlights
- **Dual AI Processing**: OpenAI for classification, Gemini for extraction
- **Multi-format Support**: PDF, images, Word docs, Excel, CSV processing
- **Intelligent Routing**: 5-route classification system (TEXT_PO, ATTACHMENT_PO, etc.)
- **Forwarded Email Handling**: Advanced CNumber extraction from @highcaliberline.com domains
- **Real-time Updates**: Dashboard polling with 3-second intervals for live status
- **Mobile Responsive**: Complete mobile optimization across all interfaces