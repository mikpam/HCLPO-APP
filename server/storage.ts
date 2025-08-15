import { 
  type User, 
  type InsertUser, 
  type PurchaseOrder, 
  type InsertPurchaseOrder,
  type ErrorLog,
  type InsertErrorLog,
  type EmailQueue,
  type InsertEmailQueue,
  type SystemHealth,
  type InsertSystemHealth
} from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Purchase Orders
  createPurchaseOrder(po: InsertPurchaseOrder): Promise<PurchaseOrder>;
  getPurchaseOrder(id: string): Promise<PurchaseOrder | undefined>;
  getPurchaseOrderByNumber(poNumber: string): Promise<PurchaseOrder | undefined>;
  updatePurchaseOrder(id: string, updates: Partial<PurchaseOrder>): Promise<PurchaseOrder>;
  getPurchaseOrders(filters?: { status?: string; limit?: number }): Promise<PurchaseOrder[]>;

  // Error Logs
  createErrorLog(error: InsertErrorLog): Promise<ErrorLog>;
  getErrorLogs(filters?: { resolved?: boolean; type?: string; limit?: number }): Promise<ErrorLog[]>;
  updateErrorLog(id: string, updates: Partial<ErrorLog>): Promise<ErrorLog>;

  // Email Queue
  createEmailQueueItem(email: InsertEmailQueue): Promise<EmailQueue>;
  getEmailQueueItem(id: string): Promise<EmailQueue | undefined>;
  getEmailQueueByGmailId(gmailId: string): Promise<EmailQueue | undefined>;
  updateEmailQueueItem(id: string, updates: Partial<EmailQueue>): Promise<EmailQueue>;
  getEmailQueue(filters?: { status?: string; limit?: number }): Promise<EmailQueue[]>;

  // System Health
  updateSystemHealth(health: InsertSystemHealth): Promise<SystemHealth>;
  getSystemHealth(): Promise<SystemHealth[]>;

  // Dashboard metrics
  getDashboardMetrics(): Promise<{
    emailsProcessedToday: number;
    posProcessed: number;
    pendingReview: number;
    processingErrors: number;
  }>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User> = new Map();
  private purchaseOrders: Map<string, PurchaseOrder> = new Map();
  private errorLogs: Map<string, ErrorLog> = new Map();
  private emailQueue: Map<string, EmailQueue> = new Map();
  private systemHealth: Map<string, SystemHealth> = new Map();

  constructor() {
    // Initialize system health
    const services = ['Gmail API', 'OpenAI', 'Airtable', 'NetSuite', 'Dropbox'];
    services.forEach(service => {
      const health: SystemHealth = {
        id: randomUUID(),
        service,
        status: 'online',
        lastCheck: new Date(),
        responseTime: Math.floor(Math.random() * 100) + 50,
        errorMessage: null,
      };
      this.systemHealth.set(service, health);
    });

    // Set Airtable to delayed status for demo
    const airtableHealth = this.systemHealth.get('Airtable');
    if (airtableHealth) {
      airtableHealth.status = 'delayed';
      airtableHealth.responseTime = 2500;
    }
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(user => user.username === username);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id, role: insertUser.role || 'operator', createdAt: new Date() };
    this.users.set(id, user);
    return user;
  }

  async createPurchaseOrder(po: InsertPurchaseOrder): Promise<PurchaseOrder> {
    const id = randomUUID();
    const now = new Date();
    const purchaseOrder: PurchaseOrder = { 
      ...po, 
      id, 
      status: po.status || 'pending',
      customerMeta: po.customerMeta || null,
      createdAt: now, 
      updatedAt: now 
    };
    this.purchaseOrders.set(id, purchaseOrder);
    return purchaseOrder;
  }

  async getPurchaseOrder(id: string): Promise<PurchaseOrder | undefined> {
    return this.purchaseOrders.get(id);
  }

  async getPurchaseOrderByNumber(poNumber: string): Promise<PurchaseOrder | undefined> {
    return Array.from(this.purchaseOrders.values()).find(po => po.poNumber === poNumber);
  }

  async updatePurchaseOrder(id: string, updates: Partial<PurchaseOrder>): Promise<PurchaseOrder> {
    const existing = this.purchaseOrders.get(id);
    if (!existing) {
      throw new Error('Purchase order not found');
    }
    
    const updated: PurchaseOrder = { 
      ...existing, 
      ...updates, 
      updatedAt: new Date() 
    };
    this.purchaseOrders.set(id, updated);
    return updated;
  }

  async getPurchaseOrders(filters?: { status?: string; limit?: number }): Promise<PurchaseOrder[]> {
    let orders = Array.from(this.purchaseOrders.values());
    
    if (filters?.status) {
      orders = orders.filter(po => po.status === filters.status);
    }
    
    orders.sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
    
    if (filters?.limit) {
      orders = orders.slice(0, filters.limit);
    }
    
    return orders;
  }

  async createErrorLog(error: InsertErrorLog): Promise<ErrorLog> {
    const id = randomUUID();
    const errorLog: ErrorLog = { 
      ...error, 
      id, 
      relatedPoId: error.relatedPoId || null,
      relatedPoNumber: error.relatedPoNumber || null,
      resolved: error.resolved || false,
      resolvedAt: error.resolvedAt || null,
      resolvedBy: error.resolvedBy || null,
      metadata: error.metadata || null,
      createdAt: new Date() 
    };
    this.errorLogs.set(id, errorLog);
    return errorLog;
  }

  async getErrorLogs(filters?: { resolved?: boolean; type?: string; limit?: number }): Promise<ErrorLog[]> {
    let logs = Array.from(this.errorLogs.values());
    
    if (filters?.resolved !== undefined) {
      logs = logs.filter(log => log.resolved === filters.resolved);
    }
    
    if (filters?.type) {
      logs = logs.filter(log => log.type === filters.type);
    }
    
    logs.sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
    
    if (filters?.limit) {
      logs = logs.slice(0, filters.limit);
    }
    
    return logs;
  }

  async updateErrorLog(id: string, updates: Partial<ErrorLog>): Promise<ErrorLog> {
    const existing = this.errorLogs.get(id);
    if (!existing) {
      throw new Error('Error log not found');
    }
    
    const updated: ErrorLog = { ...existing, ...updates };
    this.errorLogs.set(id, updated);
    return updated;
  }

  async createEmailQueueItem(email: InsertEmailQueue): Promise<EmailQueue> {
    const id = randomUUID();
    const queueItem: EmailQueue = { 
      ...email, 
      id, 
      status: email.status || 'pending',
      body: email.body || null,
      createdAt: new Date() 
    };
    this.emailQueue.set(id, queueItem);
    return queueItem;
  }

  async getEmailQueueItem(id: string): Promise<EmailQueue | undefined> {
    return this.emailQueue.get(id);
  }

  async getEmailQueueByGmailId(gmailId: string): Promise<EmailQueue | undefined> {
    return Array.from(this.emailQueue.values()).find(item => item.gmailId === gmailId);
  }

  async updateEmailQueueItem(id: string, updates: Partial<EmailQueue>): Promise<EmailQueue> {
    const existing = this.emailQueue.get(id);
    if (!existing) {
      throw new Error('Email queue item not found');
    }
    
    const updated: EmailQueue = { ...existing, ...updates };
    this.emailQueue.set(id, updated);
    return updated;
  }

  async getEmailQueue(filters?: { status?: string; limit?: number }): Promise<EmailQueue[]> {
    let queue = Array.from(this.emailQueue.values());
    
    if (filters?.status) {
      queue = queue.filter(item => item.status === filters.status);
    }
    
    queue.sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
    
    if (filters?.limit) {
      queue = queue.slice(0, filters.limit);
    }
    
    return queue;
  }

  async updateSystemHealth(health: InsertSystemHealth): Promise<SystemHealth> {
    const existing = this.systemHealth.get(health.service);
    const id = existing?.id || randomUUID();
    
    const updated: SystemHealth = { 
      ...health, 
      id,
      responseTime: health.responseTime || null,
      errorMessage: health.errorMessage || null,
      lastCheck: new Date() 
    };
    this.systemHealth.set(health.service, updated);
    return updated;
  }

  async getSystemHealth(): Promise<SystemHealth[]> {
    return Array.from(this.systemHealth.values());
  }

  async getDashboardMetrics(): Promise<{
    emailsProcessedToday: number;
    posProcessed: number;
    pendingReview: number;
    processingErrors: number;
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const emailsProcessedToday = Array.from(this.emailQueue.values())
      .filter(item => 
        item.status === 'processed' && 
        item.processedAt && 
        item.processedAt >= today
      ).length;
    
    const posProcessed = Array.from(this.purchaseOrders.values())
      .filter(po => po.status === 'processed').length;
    
    const pendingReview = Array.from(this.purchaseOrders.values())
      .filter(po => po.route === 'REVIEW' || po.status === 'pending_review').length;
    
    const processingErrors = Array.from(this.errorLogs.values())
      .filter(error => !error.resolved).length;
    
    return {
      emailsProcessedToday,
      posProcessed,
      pendingReview,
      processingErrors
    };
  }
}

export const storage = new MemStorage();
