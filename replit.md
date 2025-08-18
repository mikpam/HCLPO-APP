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
- **UUID Column Added (2025-08-18)**: Added dedicated UUID column to purchase_orders table for enhanced tracking and reference.
- **Enhanced Customer Lookup Fallback (2025-08-18)**: Improved customer finder to handle cases where Gemini extraction has missing/incomplete customer data by falling back to sender email analysis.
- **Critical Routing Fix Analysis (2025-08-18)**: Confirmed PO 138261 failed extraction due to incorrect TEXT_PO routing instead of ATTACHMENT_PO, bypassing attachment screening entirely. This demonstrates the routing fix prevents future misclassifications.
- **Major Classification Priority Fix (2025-08-18)**: Fixed systematic routing issue where 47 emails incorrectly went to TEXT_PO instead of ATTACHMENT_PO. Updated OpenAI classification prompt to prioritize ATTACHMENT_PO over TEXT_PO and made artwork-only detection more conservative.
- **Bulletproof Attachment Routing (2025-08-18)**: Implemented double-layer protection ensuring ANY email with attachments routes to ATTACHMENT_PO/ATTACHMENT_SAMPLE. Added code-level override that forces correct routing even if OpenAI classification gets confused.
- **Domain-Specific Routing Exception (2025-08-18)**: Added special handling for @4allpromos.com domain - emails from this domain route to TEXT_PO/TEXT_SAMPLE even when attachments are present, since their PO details are typically in email body text.
- **Complete Forwarded Email Processing Fix (2025-08-18)**: Fixed critical validation issue where contact validator and customer finder were using HCL forwarder emails instead of original sender emails. All validation services now correctly use original sender data for forwarded emails, ensuring accurate customer/contact matching.
- **Performance Optimization - Server-Side Pagination (2025-08-18)**: Implemented comprehensive server-side pagination for customers and items APIs. Default limit reduced from 50,000 to 50 items per page with proper search and status filtering. Fixed email queue route display bug showing correct classification routes instead of always "TEXT_PO".
- **Database Schema Cleanup (2025-08-18)**: Removed deprecated `validated_json` column from purchase_orders table. Updated NetSuite import functionality to rely on `extractedData` field instead. All existing purchase orders preserved during migration.
- **Customer Indexing**: Multi-strategy lookup with database indexes, in-memory caching, and fuzzy matching.
- **Error Tracking**: Comprehensive error logging system with detailed metadata, step tracking, and resolution status.

### Email Processing Pipeline
- **Architecture**: Two-step sequential processing mirroring Make.com workflow. Emails are processed one at a time.
- **Pre-processing**: OpenAI GPT-4o for intent classification (Purchase Order, Sample Request, Rush Order, Follow Up, None).
- **Detailed Analysis**: Advanced 5-route classification for qualifying emails (TEXT_PO, TEXT_SAMPLE, ATTACHMENT_PO, ATTACHMENT_SAMPLE, REVIEW).
- **Critical Routing Fix (2025-08-17)**: Fixed classification priority to ensure ATTACHMENT_PO takes precedence over TEXT_PO when legitimate attachments are present. Previously emails with both attachments and body text incorrectly routed to TEXT_PO.
- **Object Storage Fix (2025-08-17)**: Completely resolved attachment and email preservation issues by fixing all four processing paths (Gmail service, SSE processing, background processing, and main auto-processing). Previously attachments were downloaded for Gemini but never stored to object storage.
- **Object Storage Authentication Fix (2025-08-18)**: Resolved critical authentication failures ("401 Unauthorized", "no allowed resources") by creating new object storage bucket with proper permissions. Files now successfully store to object storage instead of fallback paths.
- **AI Document Filtering**: Pre-screens attachments to filter out non-PO documents before Gemini processing.
- **Multi-Format Support**: Enhanced processing for Gemini-compatible formats (PDFs, images, Word docs, CSVs, Excel, text files).
- **Dual Gemini Extraction Routes**: ATTACHMENT_PO for multi-format document processing with AI filtering; TEXT_PO for email text processing with structured schema extraction.
- **Processing Flow**: Gmail ingestion → Pre-processing → Detailed analysis → AI document filtering → Gemini extraction → PO extraction → NetSuite import.
- **Data Storage**: Preprocessing, classification, and extracted data stored in Neon PostgreSQL.
- **Email Preservation**: Automatic .eml file preservation for classified emails in object storage (now working).
- **Attachment Storage**: All email attachments automatically stored to object storage during processing (now working).
- **Customer Lookup**: High-performance customer database with NetSuite integration for precise customer attribution, including advanced matching and disambiguation.
- **Comprehensive Contact Validation**: Advanced 7-priority OpenAI-powered contact resolution system with sophisticated matching logic.
- **SKU Validation**: Comprehensive SKU validation system integrating with a product items database, handling charge codes and fallbacks.
- **Admin Portal**: Comprehensive PO management interface, customer management, and item management with CRUD functionality and role-based access control.
- **Comprehensive Error Logging**: Advanced error tracking system that captures all processing failures with detailed context.
- **Validator Architecture**: Per-email validator instances to prevent race conditions and ensure reliability.
- **Validation Completion System**: Immediate database updates after each validation step (customer, contact, line items) for real-time data storage and consistency.
- **Validator Health Monitoring**: Real-time health checks, circuit breaker pattern, performance metrics, and automatic recovery for all validators.

### Authentication & Authorization
- **Strategy**: Session-based authentication with role-based access control.
- **Roles**: Operator role and potential for additional roles.

## External Dependencies

### Email Integration
- **Gmail API**: Service account authentication for email retrieval and labeling.

### AI/ML Services
- **OpenAI API**: Used for email pre-processing intent classification, detailed email gate logic, and comprehensive validation (customer, contact, SKU).
- **Google Gemini API**: Used for structured purchase order parsing and data extraction from both attachments and email text, including multi-attachment screening.

### Data Storage Services
- **Neon PostgreSQL**: Primary database for all persistent application data.

### Document Management
- **Object Storage**: Replit's built-in object storage for PDF and document storage.

### ERP Integration
- **NetSuite REST API**: For sales order creation, including customer lookup/creation, shipping method mapping, and line item matching.