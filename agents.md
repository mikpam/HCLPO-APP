# AGENTS.md - HCL Procurement Platform

This file provides context and instructions for AI coding agents working on the High Caliber Line (HCL) Purchase Order Processing Platform - an automated procurement system that processes purchase orders from email to NetSuite integration.

## Project Context

This is a full-stack TypeScript application that automates purchase order processing through a 12-step AI-powered pipeline. The system ingests emails from Gmail, processes them through multiple AI agents, validates customers and products, and outputs NetSuite-ready purchase orders.

**Key Technologies:** React + TypeScript frontend, Express.js backend, PostgreSQL with PGvector, OpenAI GPT-4o, Google Gemini, Gmail API, NetSuite integration.

## Development Environment Tips

- Use `npm run dev` to start both frontend (Vite) and backend (Express) on port 5000
- Database changes: Run `npm run db:push` to sync schema changes (use `--force` if needed)
- Never manually write SQL migrations - always use Drizzle ORM with `npm run db:push`
- Access logs via workflow console - all processing steps are logged with emoji prefixes
- Use `execute_sql_tool` for database queries during development, never direct SQL manipulation
- The system auto-processes emails every minute when running

## Architecture Guidelines

### File Organization
- **Frontend:** `client/src/` - React components with shadcn/ui and Tailwind CSS
- **Backend:** `server/` - Express.js routes and services
- **Shared:** `shared/schema.ts` - Database schema and types (source of truth)
- **Database:** PostgreSQL with Drizzle ORM, PGvector for embeddings

### Core Processing Pipeline
The system follows a strict 12-step automated pipeline:
1. Gmail Ingestion → 2. Pre-processing → 3. Classification → 4. Document Filtering → 5. Gemini Extraction → 6. PO Creation → 7. Customer Validation → 8. Contact Validation → 9. SKU Validation → 10. Status Assignment → 11. NetSuite Import → 12. Gmail Labeling

### Database Safety Rules
- **CRITICAL:** Never change primary key ID column types (serial ↔ varchar) - this breaks existing data
- Always check existing schema before modifications: `SELECT * FROM information_schema.columns WHERE table_name = 'table_name'`
- Use `npm run db:push --force` for schema sync if regular push fails
- Match Drizzle schema to existing database structure, never the reverse

## API Integration Guidelines

### Required Environment Variables
- `OPENAI_API_KEY` - For all LLM-based processing and validation
- `GEMINI_API_KEY` - For document extraction and parsing  
- `GMAIL_SERVICE_ACCOUNT_EMAIL` / `GMAIL_PRIVATE_KEY` - For Gmail API access
- `NETSUITE_*` - NetSuite API credentials for sales order creation
- `DATABASE_URL` - Neon PostgreSQL connection string

### AI Service Usage Patterns
- **OpenAI GPT-4o:** Email pre-processing, classification, customer/contact validation, SKU validation
- **Google Gemini:** Document extraction from PDFs, images, Word docs, Excel files
- **Embedding System:** OpenAI 1536-dimensional vectors stored in PGvector for semantic search

## Testing Instructions

### Manual Testing
- Use `/api/processing/process-auto` endpoint to trigger email processing
- Monitor processing via `/api/processing/current-status` endpoint
- Check logs in workflow console for detailed step-by-step processing
- Use retry buttons in admin UI for testing specific PO validation flows

### Database Testing
- Run queries via `execute_sql_tool` for debugging
- Check PO status progression: `pending` → `validating` → `customer_found` → `ready_for_import`
- Verify embeddings: `SELECT * FROM customers WHERE embedding IS NOT NULL LIMIT 5`

### Validation Testing
- Test customer validation: Check company name normalization (Inc., LLC handling)
- Test contact validation: Verify email domain matching and contact resolution
- Test SKU validation: Ensure quantity preservation and proper charge code handling

## Common Issues and Solutions

### Processing Stuck/Failed
- Check `/api/processing/current-status` for lock status
- Use `/api/processing/check-stuck-processes` to recover stuck POs
- Reset processing lock: Set `isProcessing` to false in memory if needed
- Check error logs: Query `error_logs` table for processing failures

### Database Issues
- **ID column changes:** Never alter existing ID column types - causes migration failures
- **Embedding issues:** Ensure OpenAI API key is valid and vector dimensions are 1536
- **JSON errors:** Check audit logging - ensure proper JSON.stringify() for PostgreSQL JSONB columns

### AI Service Issues
- **OpenAI rate limits:** Implement exponential backoff, check API quota
- **Gemini extraction failures:** Verify supported file formats, check file size limits
- **Validation accuracy:** Review confidence thresholds in hybrid validation services

## Code Modification Guidelines

### When Modifying Validation Logic
- All validation services use 4-step hybrid approach: Exact DB → Vector → Rules → LLM
- Maintain audit logging for all validation decisions
- Preserve quantity locks in SKU validation to prevent data corruption
- Update confidence thresholds carefully - affects accuracy vs false positives

### When Adding New Features
- Follow existing error logging patterns with user-friendly explanations
- Add proper TypeScript types in `shared/schema.ts` first
- Implement comprehensive logging with emoji prefixes for consistency
- Test with real data - never use mock/placeholder data

### When Debugging
- Start with workflow console logs - they show complete processing flow
- Check database state at each validation step
- Use LSP diagnostics tool for TypeScript errors
- Monitor memory usage - the system has LRU caching for performance

## Status Definitions

### Purchase Order Statuses
- `pending` - Awaiting customer validation
- `validating` - Currently processing through validation pipeline  
- `customer_found` - Customer validated, contact validation needed
- `contact_validation_needed` - Customer found, contact resolution needed
- `sku_validation_needed` - Customer and contact found, SKU validation needed
- `ready_for_import` - All validations passed, ready for NetSuite
- `new_customer` - Unknown customer, requires manual setup
- `manual_review` - Requires human intervention
- `validation_failed` - Technical validation error occurred

### Processing Architecture
- Single auto-processing endpoint prevents concurrent operations
- Processing lock system ensures sequential email handling
- Pending PO recovery automatically processes incomplete validations
- Health monitoring tracks validator performance and availability

## Recent Critical Fixes (August 2025)

### SKU Validation Enhancements
- Fixed quantity-aware logic for high-quantity items (prevents OE-MISC-CHARGE misclassification)
- Resolved Gemini SKU+color concatenation issue (extracts clean base SKUs)
- Standardized setup charge format: "SET UP" → "SETUP"

### Customer Validation Improvements  
- Enhanced company name normalization for business entity suffixes (Inc., LLC, Corp)
- Fixed OpenAI JSON prompt formatting errors
- Resolved PostgreSQL JSON audit logging syntax errors

### System Architecture Updates
- Complete validation pipeline integration (customer → contact → SKU → status assignment)
- Enhanced retry mechanisms with proper status progression
- TypeScript import fixes across all validation services
- Memory optimization with LRU caching for performance

Remember: This system processes real business data for High Caliber Line. Always prioritize data integrity, comprehensive logging, and proper error handling. The auto-processing pipeline runs continuously - changes affect live email processing.