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
  type InsertSystemHealth,
  users,
  purchaseOrders,
  errorLogs,
  emailQueue,
  systemHealth
} from "@shared/schema";
import { db } from "./db";
import { eq, and, desc, count, gte, lt, not } from "drizzle-orm";
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

  // Customer search for tools-first approach
  searchCustomers(searchType: 'customer_number' | 'email' | 'domain' | 'asi_number' | 'ppai_number' | 'company_name' | 'root_brand', searchValue: string): Promise<any[]>;
}

export class DatabaseStorage implements IStorage {
  constructor() {
    this.initializeSystemHealth();
  }

  private async initializeSystemHealth() {
    // Initialize system health records for all services
    const services = ['Gmail API', 'OpenAI', 'NetSuite'];
    for (const service of services) {
      try {
        await db.insert(systemHealth).values({
          service,
          status: 'online',
          responseTime: Math.floor(Math.random() * 100) + 50,
          errorMessage: null,
        }).onConflictDoUpdate({
          target: systemHealth.service,
          set: {
            lastCheck: new Date(),
          }
        });
      } catch (error) {
        console.log(`System health initialization: ${service} already exists or error occurred`);
      }
    }
  }

  // Users
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  // Purchase Orders
  async createPurchaseOrder(po: InsertPurchaseOrder): Promise<PurchaseOrder> {
    const [purchaseOrder] = await db
      .insert(purchaseOrders)
      .values(po)
      .returning();
    return purchaseOrder;
  }

  async getPurchaseOrder(id: string): Promise<PurchaseOrder | undefined> {
    const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id));
    return po || undefined;
  }

  async getPurchaseOrderByNumber(poNumber: string): Promise<PurchaseOrder | undefined> {
    const [po] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.poNumber, poNumber));
    return po || undefined;
  }

  async updatePurchaseOrder(id: string, updates: Partial<PurchaseOrder>): Promise<PurchaseOrder> {
    const [updated] = await db
      .update(purchaseOrders)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(purchaseOrders.id, id))
      .returning();
    
    if (!updated) {
      throw new Error('Purchase order not found');
    }
    return updated;
  }

  async getPurchaseOrders(filters?: { status?: string; limit?: number }): Promise<PurchaseOrder[]> {
    let query = db.select().from(purchaseOrders);
    
    if (filters?.status) {
      query = query.where(eq(purchaseOrders.status, filters.status));
    }
    
    query = query.orderBy(desc(purchaseOrders.createdAt));
    
    if (filters?.limit) {
      query = query.limit(filters.limit);
    }
    
    return await query;
  }

  // Error Logs
  async createErrorLog(error: InsertErrorLog): Promise<ErrorLog> {
    const [errorLog] = await db
      .insert(errorLogs)
      .values(error)
      .returning();
    return errorLog;
  }

  async getErrorLogs(filters?: { resolved?: boolean; type?: string; limit?: number }): Promise<ErrorLog[]> {
    let query = db.select().from(errorLogs);
    const conditions = [];
    
    if (filters?.resolved !== undefined) {
      conditions.push(eq(errorLogs.resolved, filters.resolved));
    }
    
    if (filters?.type) {
      conditions.push(eq(errorLogs.type, filters.type));
    }
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }
    
    query = query.orderBy(desc(errorLogs.createdAt));
    
    if (filters?.limit) {
      query = query.limit(filters.limit);
    }
    
    return await query;
  }

  async updateErrorLog(id: string, updates: Partial<ErrorLog>): Promise<ErrorLog> {
    const [updated] = await db
      .update(errorLogs)
      .set(updates)
      .where(eq(errorLogs.id, id))
      .returning();
    
    if (!updated) {
      throw new Error('Error log not found');
    }
    return updated;
  }

  // Email Queue
  async createEmailQueueItem(email: InsertEmailQueue): Promise<EmailQueue> {
    const [queueItem] = await db
      .insert(emailQueue)
      .values(email)
      .returning();
    return queueItem;
  }

  async getEmailQueueItem(id: string): Promise<EmailQueue | undefined> {
    const [item] = await db.select().from(emailQueue).where(eq(emailQueue.id, id));
    return item || undefined;
  }

  async getEmailQueueByGmailId(gmailId: string): Promise<EmailQueue | undefined> {
    const [item] = await db.select().from(emailQueue).where(eq(emailQueue.gmailId, gmailId));
    return item || undefined;
  }

  async updateEmailQueueItem(id: string, updates: Partial<EmailQueue>): Promise<EmailQueue> {
    const [updated] = await db
      .update(emailQueue)
      .set(updates)
      .where(eq(emailQueue.id, id))
      .returning();
    
    if (!updated) {
      throw new Error('Email queue item not found');
    }
    return updated;
  }

  async getEmailQueue(filters?: { status?: string; limit?: number }): Promise<EmailQueue[]> {
    let query = db.select().from(emailQueue);
    
    if (filters?.status) {
      query = query.where(eq(emailQueue.status, filters.status));
    }
    
    query = query.orderBy(desc(emailQueue.createdAt));
    
    if (filters?.limit) {
      query = query.limit(filters.limit);
    }
    
    return await query;
  }

  // System Health
  async updateSystemHealth(health: InsertSystemHealth): Promise<SystemHealth> {
    const [updated] = await db
      .insert(systemHealth)
      .values({ ...health, lastCheck: new Date() })
      .onConflictDoUpdate({
        target: systemHealth.service,
        set: {
          status: health.status,
          responseTime: health.responseTime,
          errorMessage: health.errorMessage,
          lastCheck: new Date(),
        }
      })
      .returning();
    
    return updated;
  }

  async getSystemHealth(): Promise<SystemHealth[]> {
    return await db.select().from(systemHealth);
  }

  // Dashboard Metrics
  async getDashboardMetrics(): Promise<{
    emailsProcessedToday: number;
    posProcessed: number;
    pendingReview: number;
    processingErrors: number;
  }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Count emails processed today
    const [emailsResult] = await db
      .select({ count: count() })
      .from(emailQueue)
      .where(
        and(
          eq(emailQueue.status, 'processed'),
          gte(emailQueue.processedAt, today),
          lt(emailQueue.processedAt, tomorrow)
        )
      );

    // Count all created POs (any status except 'error' or 'deleted')
    const [posResult] = await db
      .select({ count: count() })
      .from(purchaseOrders)
      .where(
        and(
          not(eq(purchaseOrders.status, 'error')),
          not(eq(purchaseOrders.status, 'deleted'))
        )
      );

    // Count POs pending review
    const [reviewResult] = await db
      .select({ count: count() })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.route, 'REVIEW'));

    // Count unresolved errors
    const [errorsResult] = await db
      .select({ count: count() })
      .from(errorLogs)
      .where(eq(errorLogs.resolved, false));

    return {
      emailsProcessedToday: emailsResult?.count || 0,
      posProcessed: posResult?.count || 0,
      pendingReview: reviewResult?.count || 0,
      processingErrors: errorsResult?.count || 0,
    };
  }

  // Customer search for tools-first approach
  async searchCustomers(searchType: 'customer_number' | 'email' | 'domain' | 'asi_number' | 'ppai_number' | 'company_name' | 'root_brand', searchValue: string): Promise<any[]> {
    // For now, return empty array since customers table doesn't exist yet
    // This will be implemented when customer database schema is added
    console.log(`🔍 Customer search: ${searchType} = "${searchValue}" (not yet implemented)`);
    return [];
  }
}

export const storage = new DatabaseStorage();
