# Purchase Order Processing System

## Overview
This full-stack web application automates purchase order processing from email sources, integrating with external services to manage the workflow from ingestion to sales order creation. The system provides a dashboard for monitoring and management, aiming to streamline operations and enhance efficiency in handling purchase orders. The business vision is to provide a robust, automated solution for managing the entire purchase order lifecycle, significantly reducing manual effort and improving data accuracy. This system has high market potential for businesses dealing with large volumes of email-based purchase orders, offering a competitive advantage through operational efficiency and enhanced data management. The project ambition is to become a leading solution in automated PO processing, continuously integrating advanced AI and robust ERP capabilities.

## User Preferences
Preferred communication style: Simple, everyday language.
UI Design Priority: Mobile-responsive design is now required across all pages. Users need the system to work well on both desktop and mobile devices.
System Behavior: Automated email processing now active with full hybrid validation using 100% complete embedding infrastructure.
Vector Database Preference: PGvector integration with existing PostgreSQL database preferred over external vector databases like Pinecone for future semantic customer/item matching enhancements.
Database Enforcement: Only use Neon PostgreSQL endpoint: ep-mute-bush-afa56yb4-pooler.c-2.us-west-2.aws.neon.tech. Never change DATABASE_URL environment variable.

## System Architecture

### Frontend
- **Framework**: React 18 with TypeScript using Vite.
- **UI Components**: Shadcn/ui (Radix UI primitives).
- **Styling**: Tailwind CSS with custom design tokens.
- **State Management**: TanStack Query (React Query).
- **Routing**: Wouter.
- **Design System**: New York style variant with neutral color palette.

### Backend
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
- **Purchase Order Fields**: Enhanced with `emailIntent` (rush_order, purchase_order, sample_request, follow_up, none) and `shipToAddress` (JSONB containing name, company, address1, address2, city, state, zipCode, country).

### Email Processing Pipeline
- **Architecture**: Complete 12-step automated pipeline with NS payload generation. Single `/api/processing/process-auto` endpoint with no manual triggers.
- **Sequential Processing Lock**: System uses `isProcessing` flag to prevent concurrent operations.
- **Validation Orchestration**: Unified ValidationOrchestrator service coordinates all validation operations with parallel processing where possible.
- **Classification**: OpenAI GPT-4o for intent classification and advanced 5-route classification (TEXT_PO, TEXT_SAMPLE, ATTACHMENT_PO, ATTACHMENT_SAMPLE, REVIEW), with priority logic for attachments.
- **Email Intent Tracking**: Captures and stores email intent in the `emailIntent` field.
- **AI Document Filtering**: Pre-screens attachments to filter non-PO documents using filename-based filtering and AI document classification.
- **Multi-Format Support**: Enhanced processing for Gemini-compatible formats (PDFs, images, Word docs, CSVs, Excel, text files).
- **Dual Gemini Extraction Routes**: ATTACHMENT_PO for multi-format document processing; TEXT_PO for email body text processing.
- **Processing Flow**: Gmail ingestion → Pre-processing → Detailed analysis → AI document filtering → Gemini extraction → Unified validation → NS payload generation → NetSuite ready.
- **Data Storage**: Preprocessing, classification, extracted data, and NS payload stored in Neon PostgreSQL.
- **Email/Attachment Preservation**: Automatic .eml file and attachment storage to object storage, with file paths stored in database records for audit trails.
- **Unified Validation**: ValidationOrchestrator runs customer + contact validation in parallel, then items sequentially. Single source of truth for all validation results. Includes hybrid customer validator (Exact DB → Vector → Rules → LLM) and OpenAI contact/SKU validators.
- **NS Payload Generation**: Automatic NetSuite payload creation when PO reaches "ready_for_netsuite" status, using OpenAI to format validated data.
- **Embedding Systems**: All contacts, customers, and items are 100% embedded using OpenAI 1536-dimensional vectors and PGvector for semantic search.
- **Forwarded Email Detection**: Enhanced detection for common patterns.
- **Status Determination**: Centralized in ValidationOrchestrator: new_customer → missing_contact → invalid_items → ready_for_netsuite.
- **Performance**: Approximately 30% faster validation through parallel processing. 30-second email polling interval.
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
- **OpenAI API**: Used for email pre-processing intent classification, detailed email gate logic, and comprehensive validation (customer, contact, SKU), and NetSuite payload generation.
- **Google Gemini API**: Used for structured purchase order parsing and data extraction from both attachments and email text.

### Data Storage Services
- **Neon PostgreSQL**: Primary database for all persistent application data.

### Document Management
- **Object Storage**: Replit's built-in object storage for PDF and document storage.

### ERP Integration
- **NetSuite REST API**: For sales order creation using TBA NLAuth authentication with 2FA support.