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
- **Classification Engine**: OpenAI GPT-4o exclusively handles all email gate logic and routing decisions
- **Attachment Processing**: Google Gemini 2.5 Pro reserved specifically for PDF purchase order extraction and parsing
- **Routes**: TEXT_PO, TEXT_SAMPLE, ATTACHMENT_PO, ATTACHMENT_SAMPLE, REVIEW (5-route classification system)
- **Advanced Gate Logic**: Artwork detection, body text sufficiency analysis, sample vs full order distinction, confidence scoring
- **Processing Flow**: Gmail ingestion → OpenAI classification → Gemini PDF extraction (if attachment route) → validation → NetSuite import
- **Specialized Architecture**: Clear separation of responsibilities between AI engines for optimal performance

### Authentication & Authorization
- **Strategy**: Session-based authentication with role-based access control
- **Roles**: Operator role for standard users with potential for additional roles
- **Security**: Password hashing, secure session management

## External Dependencies

### Email Integration
- **Gmail API**: Service account authentication for automated email retrieval
- **Filtering**: Label-based filtering for "purchase-order" and "unprocessed" emails
- **Attachments**: PDF processing and content extraction capabilities

### AI/ML Services
- **OpenAI API**: GPT-4o model exclusively for email gate logic and classification with sophisticated 5-route decision system
- **Google Gemini API**: Gemini 2.5 Pro reserved for PDF attachment extraction with comprehensive purchase order parsing
- **Specialized Prompt Engineering**: Advanced OCR error correction, vendor/customer/ship-to identification, SKU processing with color mapping
- **Classification Logic**: Body vs attachment detection, sample vs purchase order identification, artwork filtering, confidence scoring
- **Clear Separation**: OpenAI handles all email analysis, Gemini handles all PDF extraction - no fallback between engines for different tasks

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