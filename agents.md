# AI Agents & Automation Documentation

## Overview
This document outlines the AI agents and automated systems that power the High Caliber Line (HCL) Purchase Order Processing Platform. The system uses multiple specialized AI agents working together to automate the complete email-to-validated-PO pipeline.

## Architecture

### Core Processing Pipeline
The system operates on a **12-step automated pipeline** that processes emails from Gmail through to NetSuite-ready purchase orders:

1. **Gmail Ingestion** → 2. **Pre-processing** → 3. **Classification** → 4. **AI Document Filtering** → 5. **Gemini Extraction** → 6. **PO Creation** → 7. **Customer Validation** → 8. **Contact Validation** → 9. **SKU Validation** → 10. **Final Status Assignment** → 11. **NetSuite Import** → 12. **Gmail Labeling**

### Auto-Processing System
- **Endpoint**: Single `/api/processing/process-auto` endpoint handles all automation
- **Polling**: Automatic email checking every 1 minute
- **Lock System**: Sequential processing with `isProcessing` flag prevents concurrent operations
- **Pending PO Recovery**: Automatically picks up and processes pending POs when no new emails available

## AI Agents

### 1. Email Pre-Processing Agent
**Service**: OpenAI GPT-4o  
**Purpose**: Initial email analysis and purchase order detection  
**Input**: Raw email content (subject, body, sender)  
**Output**: Boolean decision on whether email contains purchase order content  

**Key Features**:
- Intent classification for purchase orders vs sample requests
- Confidence scoring for processing decisions
- Business logic filtering to reduce false positives

### 2. Email Classification Agent
**Service**: OpenAI GPT-4o  
**Purpose**: Advanced 5-route email classification  
**Routes**: 
- `TEXT_PO`: Purchase order in email body text
- `TEXT_SAMPLE`: Sample request in email body
- `ATTACHMENT_PO`: Purchase order in email attachments
- `ATTACHMENT_SAMPLE`: Sample request in attachments  
- `REVIEW`: Requires manual review

**Key Features**:
- Priority logic favoring attachments over email text
- Confidence scoring and analysis flags
- Attachment presence detection

### 3. AI Document Filter Agent
**Service**: OpenAI GPT-4o  
**Purpose**: Pre-screens attachments to filter non-PO documents  
**Input**: Attachment filenames and metadata  
**Output**: Filtered list of relevant attachments for processing  

**Key Features**:
- Filename-based filtering for obvious non-PO files
- AI document classification with negative keyword detection
- Reduces processing overhead by filtering irrelevant attachments

### 4. Gemini Extraction Agent
**Service**: Google Gemini Pro  
**Purpose**: Structured data extraction from purchase order documents  
**Supported Formats**: PDFs, images, Word docs, CSVs, Excel files, text  

**Dual Processing Routes**:
- **ATTACHMENT_PO**: Multi-format document processing route
- **TEXT_PO**: Email body text processing route

**Key Features**:
- Advanced prompt engineering for consistent data extraction
- Handles complex PO formats and layouts
- Extracts customer info, line items, pricing, dates, shipping details
- Quantity-aware logic prevents misclassification of high-quantity items

### 5. Hybrid Customer Validator Agent
**Service**: 4-step hybrid validation system  
**Purpose**: Customer matching and validation against HCL database  

**Validation Steps**:
1. **Exact DB Match**: Direct database lookup by company name
2. **Vector Search**: Semantic similarity using OpenAI embeddings + PGvector
3. **Rules Engine**: Business logic and fuzzy matching
4. **LLM Tiebreaker**: OpenAI GPT-4o for complex disambiguation

**Key Features**:
- Company name normalization (handles business entity suffixes)
- 100% complete embedding infrastructure with 1536-dimensional vectors
- Confidence scoring and method tracking
- Comprehensive audit logging with JSON formatting fixes

### 6. Hybrid Contact Validator Agent
**Service**: 4-step hybrid validation system  
**Purpose**: Contact resolution and validation within customer context  

**Validation Steps**:
1. **Exact Email Match**: Direct email address lookup
2. **Domain + Company Matching**: Company-scoped contact search
3. **Vector Search**: Semantic contact matching using embeddings
4. **LLM Scoring**: AI-powered contact disambiguation

**Key Features**:
- Security filtering for forwarder emails (@highcaliberline.com)
- Multi-candidate scoring and ranking
- Contact role and job title extraction
- 97-100% accuracy in production testing

### 7. SKU Validation Agent
**Service**: OpenAI GPT-4o with integrated product database  
**Purpose**: Line item validation against HCL product catalog  

**Key Features**:
- **Quantity-Aware Logic**: High quantities (>50) automatically treated as products
- **Enhanced Charge Detection**: Prevents misclassification of product lines as charges
- **SKU Separation Fix**: Extracts clean base SKUs without color concatenation
- **Fallback Handling**: OE-MISC-ITEM for unknown products, OE-MISC-CHARGE for charges
- **Memory Optimization**: LRU cache with top 1000 most common items
- **Color Code Resolution**: Comprehensive color mapping and variant validation

## Data Storage & Management

### Vector Database Integration
- **Technology**: PGvector with existing PostgreSQL database
- **Embeddings**: OpenAI 1536-dimensional vectors
- **Coverage**: 100% embedded contacts, customers, and items
- **Performance**: Optimized for hybrid search with exact + semantic matching

### Embedding Systems
- **Contact Embeddings**: Full contact database with real-time updates
- **Customer Embeddings**: Complete customer list with company variations
- **Item Embeddings**: Product catalog with SKU and description vectors
- **Semantic Search**: Cosine similarity scoring with configurable thresholds

### Audit & Monitoring
- **Processing Logs**: Complete step-by-step processing trails
- **Validation Audit**: Customer and contact validation audit tables
- **Health Monitoring**: Validator performance and availability tracking
- **Error Logging**: Comprehensive error categorization with user-friendly explanations

## Error Handling & Recovery

### Stuck Process Prevention
- **Automatic Detection**: Monitors POs stuck in processing states
- **Dead Letter Queue**: Manual review queue for failed validations
- **Recovery System**: Automatic retry mechanisms with exponential backoff
- **Health Checks**: Continuous monitoring of validator availability

### Manual Intervention
- **Retry System**: Manual retry buttons for all PO statuses
- **Admin Portal**: Comprehensive PO management interface
- **Status Override**: Manual status changes for edge cases
- **Data Correction**: Edit capabilities for extracted data

## Performance Optimizations

### Memory Management
- **LRU Caching**: Intelligent caching for items, customers, and contacts
- **Memory Monitoring**: Real-time heap and RSS tracking
- **Cache Refresh**: Automatic cache updates with TTL management
- **Garbage Collection**: Optimized for long-running processes

### Processing Efficiency
- **Parallel Processing**: Simultaneous validation operations where possible
- **Batching**: Efficient database operations with bulk updates
- **Connection Pooling**: Optimized database connection management
- **Rate Limiting**: API call optimization to stay within service limits

## Configuration & Environment

### Required API Keys
- **OpenAI API**: For all LLM-based processing and validation
- **Google Gemini API**: For document extraction and parsing
- **Gmail API**: For email retrieval and labeling
- **NetSuite API**: For sales order creation and customer lookup

### Database Configuration
- **Primary Database**: Neon PostgreSQL with PGvector extension
- **Embedding Storage**: Vector columns in existing tables
- **Audit Tables**: Comprehensive logging and tracking tables
- **Schema Management**: Drizzle ORM with automatic migrations

## Recent Improvements (August 2025)

### SKU Validation Enhancements
- **Quantity-Aware Logic**: Fixed OE-MISC-CHARGE high quantity classification
- **Gemini SKU Separation**: Prevented incorrect SKU+color concatenation
- **Setup Charge Format**: Standardized "SET UP" → "SETUP" format

### Customer Validation Fixes
- **Company Name Normalization**: Enhanced business entity suffix matching
- **JSON Prompt Fix**: Resolved OpenAI API formatting errors
- **Audit Logging**: Fixed PostgreSQL JSON syntax errors

### System Architecture Updates
- **Complete Pipeline**: Full auto-processing with pending PO recovery
- **TypeScript Fixes**: Resolved all import and type validation errors
- **Status Progression**: Smart final status assignment logic
- **Error Recovery**: Enhanced retry mechanisms with complete validation flow

## Future Roadmap

### Planned Enhancements
- **Advanced Analytics**: Processing performance metrics and trends
- **Machine Learning**: Adaptive validation thresholds based on accuracy
- **Real-time Notifications**: Instant alerts for critical processing events
- **API Extensions**: Enhanced NetSuite integration capabilities

### Scalability Considerations
- **Horizontal Scaling**: Multi-instance processing capability
- **Database Optimization**: Advanced indexing and query optimization
- **Caching Strategy**: Redis integration for distributed caching
- **Monitoring**: Advanced observability with detailed metrics

---

*Last Updated: August 22, 2025*  
*Version: 5.0 - Complete Validation Pipeline*