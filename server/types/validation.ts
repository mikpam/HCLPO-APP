/**
 * Validation Types
 * Unified type definitions for the validation orchestrator system
 */

export type POStatus = 
  | 'pending_validation'
  | 'validating'
  | 'ready_for_netsuite'
  | 'new_customer'
  | 'missing_contact'
  | 'invalid_items'
  | 'pending_review'
  | 'error';

export interface StandardValidationResult {
  matched: boolean;
  confidence: number;
  method: string;
  data: any;
  errors?: string[];
  alternatives?: any[];
  
  // Additional fields for specific validators
  customerNumber?: string;
  customerName?: string;
  contactName?: string;
  contactEmail?: string;
  contactRole?: string;
}

export interface ItemValidationResult extends StandardValidationResult {
  validCount: number;
  totalCount: number;
}

export interface ValidationInput {
  customer?: {
    company?: string;
    customerName?: string;
    email?: string;
    senderEmail?: string;
    customerNumber?: string;
    netsuiteId?: string;
    address?: any;
    contactName?: string;
  };
  contact?: {
    name?: string;
    senderName?: string;
    email?: string;
    senderEmail?: string;
    phone?: string;
    jobTitle?: string;
    extractedData?: any;
  };
  items?: any[];
  metadata?: {
    poNumber?: string;
    emailId?: string;
    sender?: string;
    subject?: string;
  };
}

export interface ValidationResult {
  customer: StandardValidationResult;
  contact: StandardValidationResult;
  items: StandardValidationResult & { validCount: number; totalCount: number };
  status: POStatus;
  validationComplete: boolean;
  processingTimeMs: number;
  timestamp: string;
}

export interface ValidationMetrics {
  totalValidations: number;
  customerMatches: number;
  contactMatches: number;
  itemMatches: number;
  averageConfidence: number;
  averageProcessingTime: number;
  statusBreakdown: Record<POStatus, number>;
}