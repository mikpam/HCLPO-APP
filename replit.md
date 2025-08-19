# Purchase Order Processing System

## Overview
This full-stack web application automates purchase order processing from email sources, integrating with external services to manage the workflow from ingestion to sales order creation. The system provides a dashboard for monitoring and management, aiming to streamline operations and enhance efficiency in handling purchase orders.

## User Preferences
Preferred communication style: Simple, everyday language.
UI Design Priority: Mobile-responsive design is now required across all pages. Users need the system to work well on both desktop and mobile devices.
System Behavior: Automated email processing should start immediately when server launches without manual prompting.
Vector Database Preference: PGvector integration with existing PostgreSQL database preferred over external vector databases like Pinecone for future semantic customer/item matching enhancements.
Development Priority: Wait for contact embeddings to complete (currently 6.13% - 2,673/43,620) before continuing major development work. Background embedding generation running continuously.

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
- **Architecture**: Two-step sequential processing.
- **Classification**: OpenAI GPT-4o for intent classification and advanced 5-route classification (TEXT_PO, TEXT_SAMPLE, ATTACHMENT_PO, ATTACHMENT_SAMPLE, REVIEW), with priority logic for attachments.
- **AI Document Filtering**: Pre-screens attachments to filter non-PO documents.
- **Multi-Format Support**: Enhanced processing for Gemini-compatible formats (PDFs, images, Word docs, CSVs, Excel, text files).
- **Dual Gemini Extraction Routes**: ATTACHMENT_PO for multi-format document processing; TEXT_PO for email body text processing.
- **Processing Flow**: Gmail ingestion → Pre-processing → Detailed analysis → AI document filtering → Gemini extraction → PO extraction → NetSuite import.
- **Data Storage**: Preprocessing, classification, and extracted data stored in Neon PostgreSQL.
- **Email/Attachment Preservation**: Automatic .eml file and attachment storage to object storage.
- **Customer Lookup**: High-performance customer database with NetSuite integration, advanced matching, and disambiguation, including a 5-step hybrid validation system (Exact DB → Vector → Rules → LLM).
- **Contact Validation**: **HYBRID SYSTEM OPERATIONAL** - Advanced contact resolution system following deterministic gate → semantic search → scoring flow with 4-step validation (Exact DB → Vector → Rules → LLM).
- **SKU Validation**: Comprehensive SKU validation system integrating with a product items database, handling charge codes and fallbacks.
- **Item Embedding System**: **COMPLETE** - All 5,373 items embedded (100%) using OpenAI 1536-dimensional vectors and PGvector. Semantic search demonstrates excellent relevancy with 0.47-0.73 similarity scores.
- **Contact Embedding System**: **EXTRAORDINARY PROGRESS** - Reached 13.60% completion (5,932/43,620 contacts embedded). Email processing disabled to focus all resources on embeddings. Restart-resilient strategy delivers +2,434 contacts in one session using sequential batches with timed intervals. Peak rate: ~250 contacts/minute.
- **Hybrid Contact Search**: **FULLY IMPLEMENTED** - Multi-step validation: exact email match → domain+company matching → semantic search with PGvector → scoring with thresholds (≥0.85 accept, 0.75-0.85 review, <0.75 manual).
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
- **Environment Variables Required**:
  - `NETSUITE_ACCOUNT_ID`
  - `NETSUITE_EMAIL`
  - `NETSUITE_PASSWORD`
  - `NETSUITE_ROLE_ID`
  - `NETSUITE_APPLICATION_ID`
  - `NETSUITE_RESTLET_URL`