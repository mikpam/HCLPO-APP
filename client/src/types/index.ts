export interface DashboardMetrics {
  emailsProcessedToday: number;
  posProcessed: number;
  pendingReview: number;
  processingErrors: number;
}

export interface SystemHealthItem {
  id: string;
  service: string;
  status: 'online' | 'offline' | 'delayed';
  lastCheck: string;
  responseTime?: number;
  errorMessage?: string;
}

export interface ProcessingQueueStatus {
  classification: number;
  import: number;
  review: number;
  errors: number;
}

export interface RecentEmailItem {
  id: string;
  sender: string;
  subject: string;
  status: 'processed' | 'pending' | 'error';
  route: 'TEXT_PO' | 'ATTACHMENT_PO' | 'REVIEW';
  confidence: number;
  processedAt: string;
}

export interface ErrorLogItem {
  id: string;
  type: string;
  message: string;
  relatedPoNumber?: string;
  resolved: boolean;
  createdAt: string;
}
