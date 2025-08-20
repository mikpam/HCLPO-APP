import { db } from "../db";
import { customers } from "@shared/schema";
import { sql, isNull, isNotNull, eq } from "drizzle-orm";
import OpenAI from "openai";

// Lazy initialization of OpenAI client
let openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY environment variable is required");
    }
    openai = new OpenAI({ apiKey });
  }
  return openai;
}

export class CustomerEmbeddingService {
  
  /**
   * Generate embeddings for customers missing embeddings
   */
  async generateMissingEmbeddings(batchSize: number = 50): Promise<{
    processed: number;
    errors: number;
    total: number;
  }> {
    console.log(`🔮 CUSTOMER EMBEDDINGS: Generating missing embeddings (batch size: ${batchSize})`);

    // Get customers without embeddings
    const customersNeedingEmbeddings = await db
      .select({
        id: customers.id,
        customerNumber: customers.customerNumber,
        companyName: customers.companyName,
        alternateNames: customers.alternateNames,
        email: customers.email,
        phone: customers.phone,
        address: customers.address
      })
      .from(customers)
      .where(isNull(customers.customerEmbedding))
      .limit(batchSize);

    console.log(`   📋 Found ${customersNeedingEmbeddings.length} customers needing embeddings`);

    if (customersNeedingEmbeddings.length === 0) {
      return { processed: 0, errors: 0, total: 0 };
    }

    let processed = 0;
    let errors = 0;
    const client = getOpenAIClient();

    // Process customers in parallel batches
    const concurrency = 10;
    for (let i = 0; i < customersNeedingEmbeddings.length; i += concurrency) {
      const batch = customersNeedingEmbeddings.slice(i, i + concurrency);
      
      const promises = batch.map(async (customer) => {
        try {
          // Create customer text for embedding
          const customerText = this.createCustomerText(customer);
          
          // Generate embedding
          const embeddingResponse = await client.embeddings.create({
            model: "text-embedding-3-small",
            input: customerText
          });

          const embedding = embeddingResponse.data[0].embedding;

          // Extract and normalize phone digits
          const phoneDigits = customer.phone ? customer.phone.replace(/\D/g, '') : null;

          // Update customer with embedding and phone digits
          await db
            .update(customers)
            .set({
              customerEmbedding: sql`${JSON.stringify(embedding)}::vector`,
              phoneDigits: phoneDigits
            })
            .where(eq(customers.id, customer.id));

          console.log(`   ✅ Generated embedding for: ${customer.companyName} (${customer.customerNumber})`);
          return { success: true };
        } catch (error) {
          console.error(`   ❌ Failed to generate embedding for ${customer.companyName}:`, error);
          return { success: false };
        }
      });

      const results = await Promise.allSettled(promises);
      
      results.forEach(result => {
        if (result.status === 'fulfilled' && result.value.success) {
          processed++;
        } else {
          errors++;
        }
      });

      // Add small delay between batches to respect rate limits
      if (i + concurrency < customersNeedingEmbeddings.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`   📊 Batch complete: ${processed} processed, ${errors} errors`);

    return {
      processed,
      errors,
      total: customersNeedingEmbeddings.length
    };
  }

  /**
   * Get embedding generation statistics
   */
  async getEmbeddingStats(): Promise<{
    totalCustomers: number;
    customersWithEmbeddings: number;
    customersWithoutEmbeddings: number;
    completionPercentage: number;
  }> {
    const totalResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(customers);

    const withEmbeddingsResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(customers)
      .where(isNotNull(customers.customerEmbedding));

    const total = totalResult[0]?.count || 0;
    const withEmbeddings = withEmbeddingsResult[0]?.count || 0;
    const withoutEmbeddings = total - withEmbeddings;
    const completionPercentage = total > 0 ? (withEmbeddings / total) * 100 : 0;

    return {
      totalCustomers: total,
      customersWithEmbeddings: withEmbeddings,
      customersWithoutEmbeddings: withoutEmbeddings,
      completionPercentage: Math.round(completionPercentage * 100) / 100
    };
  }

  /**
   * Generate embedding for a single customer
   */
  async generateCustomerEmbedding(customerId: string): Promise<boolean> {
    try {
      const customer = await db
        .select()
        .from(customers)
        .where(eq(customers.id, customerId))
        .limit(1);

      if (!customer.length) {
        throw new Error(`Customer not found: ${customerId}`);
      }

      const customerData = customer[0];
      const customerText = this.createCustomerText(customerData);
      
      const client = getOpenAIClient();
      const embeddingResponse = await client.embeddings.create({
        model: "text-embedding-3-small",
        input: customerText
      });

      const embedding = embeddingResponse.data[0].embedding;
      const phoneDigits = customerData.phone ? customerData.phone.replace(/\D/g, '') : null;

      await db
        .update(customers)
        .set({
          customerEmbedding: sql`${JSON.stringify(embedding)}::vector`,
          phoneDigits: phoneDigits
        })
        .where(eq(customers.id, customerId));

      console.log(`✅ Generated embedding for customer: ${customerData.companyName}`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to generate embedding for customer ${customerId}:`, error);
      return false;
    }
  }

  /**
   * Create comprehensive customer text for embedding
   * Format: "company | aliases | domain | city state | phone_digits"
   */
  private createCustomerText(customer: any): string {
    const parts = [];
    
    // Company name
    if (customer.companyName) {
      parts.push(customer.companyName);
    }

    // Alternate names/aliases
    if (customer.alternateNames && customer.alternateNames.length > 0) {
      parts.push(customer.alternateNames.join(' '));
    }

    // Email domain
    if (customer.email) {
      const domain = customer.email.split('@')[1];
      if (domain) {
        parts.push(domain);
      }
    }

    // Address (city, state)
    if (customer.address) {
      const addressParts = [];
      if (customer.address.city) addressParts.push(customer.address.city);
      if (customer.address.state) addressParts.push(customer.address.state);
      if (addressParts.length > 0) {
        parts.push(addressParts.join(' '));
      }
    }

    // Phone digits
    if (customer.phone) {
      const phoneDigits = customer.phone.replace(/\D/g, '');
      if (phoneDigits) {
        parts.push(phoneDigits);
      }
    }

    return parts.join(' | ');
  }

  /**
   * Ultra-optimized customer embedding generation using mega-batches
   * Processes thousands of customers in single OpenAI API calls
   */
  async generateActiveCustomerEmbeddingsOptimized(batchSize: number = 2000): Promise<number> {
    console.log(`🚀 ACTIVE CUSTOMERS ULTRA-OPTIMIZED EMBEDDING: Starting mega-batch processing (batch size: ${batchSize})`);

    // Get active customers without embeddings
    const customersNeedingEmbeddings = await db
      .select({
        id: customers.id,
        customerNumber: customers.customerNumber,
        companyName: customers.companyName,
        alternateNames: customers.alternateNames,
        email: customers.email,
        phone: customers.phone,
        address: customers.address
      })
      .from(customers)
      .where(isNull(customers.customerEmbedding))
      .limit(batchSize);

    console.log(`   📊 Found ${customersNeedingEmbeddings.length} customers without embeddings`);

    if (customersNeedingEmbeddings.length === 0) {
      return 0;
    }

    // Create texts for all customers in the batch
    const customerTexts = customersNeedingEmbeddings.map(customer => this.createCustomerText(customer));
    
    console.log(`   🔥 BATCH PROCESSING: Sending ${customersNeedingEmbeddings.length} texts to OpenAI in ONE request`);
    
    // Single API call for all customers
    const client = getOpenAIClient();
    const embeddingResponse = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: customerTexts
    });

    console.log(`   ✅ RECEIVED ${embeddingResponse.data.length} embeddings in single API call`);

    // Prepare all updates in parallel
    const updatePromises = customersNeedingEmbeddings.map(async (customer, index) => {
      const embedding = embeddingResponse.data[index].embedding;
      const phoneDigits = customer.phone ? customer.phone.replace(/\D/g, '') : null;

      return db
        .update(customers)
        .set({
          customerEmbedding: sql`${JSON.stringify(embedding)}::vector`,
          phoneDigits: phoneDigits
        })
        .where(eq(customers.id, customer.id));
    });

    // Execute all database updates in parallel
    await Promise.all(updatePromises);
    
    console.log(`   💾 Updated ${customersNeedingEmbeddings.length} customers with embeddings`);
    
    return customersNeedingEmbeddings.length;
  }
}

// Export service instance
export const customerEmbeddingService = new CustomerEmbeddingService();