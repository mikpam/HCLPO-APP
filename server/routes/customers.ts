import type { Express } from "express";
import { customerLookupService } from "../services/customer-lookup";
import { db } from "../db";
import { customers } from "@shared/schema";
import { eq } from "drizzle-orm";

export function registerCustomerRoutes(app: Express): void {
  // Get all customers (paginated)
  app.get("/api/customers", async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = (page - 1) * limit;

      const allCustomers = await db
        .select()
        .from(customers)
        .where(eq(customers.isActive, true))
        .limit(limit)
        .offset(offset);

      res.json(allCustomers);
    } catch (error) {
      console.error("Error fetching customers:", error);
      res.status(500).json({ error: "Failed to fetch customers" });
    }
  });

  // Customer lookup endpoint
  app.post("/api/customers/lookup", async (req, res) => {
    try {
      const { customerNumber, companyName, email } = req.body;

      const result = await customerLookupService.lookupCustomer({
        customerNumber,
        companyName,
        email,
      });

      res.json(result);
    } catch (error) {
      console.error("Error looking up customer:", error);
      res.status(500).json({ error: "Customer lookup failed" });
    }
  });

  // Refresh customer cache
  app.post("/api/customers/refresh-cache", async (req, res) => {
    try {
      await customerLookupService.refreshCache();
      res.json({ message: "Customer cache refreshed successfully" });
    } catch (error) {
      console.error("Error refreshing customer cache:", error);
      res.status(500).json({ error: "Failed to refresh customer cache" });
    }
  });

  // Bulk import customers from CSV/JSON
  app.post("/api/customers/bulk-import", async (req, res) => {
    try {
      const { customers: customerData, format = 'json' } = req.body;
      
      if (!customerData || !Array.isArray(customerData)) {
        return res.status(400).json({ error: "Invalid customer data format" });
      }

      console.log(`📥 Bulk importing ${customerData.length} customers...`);
      
      // Validate and transform data
      const validCustomers = [];
      const errors = [];
      
      for (let i = 0; i < customerData.length; i++) {
        const customer = customerData[i];
        
        // Validate required fields
        if (!customer.customerNumber || !customer.companyName) {
          errors.push({
            row: i + 1,
            error: "Missing required fields: customerNumber or companyName",
            data: customer
          });
          continue;
        }
        
        // Normalize and prepare customer data
        const normalizedCustomer = {
          customerNumber: customer.customerNumber.toString().trim(),
          companyName: customer.companyName.trim(),
          alternateNames: customer.alternateNames || [],
          email: customer.email?.trim() || null,
          phone: customer.phone?.trim() || null,
          address: customer.address || null,
          netsuiteId: customer.netsuiteId?.trim() || null,
          isActive: customer.isActive !== false, // Default to true
        };
        
        validCustomers.push(normalizedCustomer);
      }
      
      // Insert customers in batches
      const batchSize = 100;
      let imported = 0;
      
      for (let i = 0; i < validCustomers.length; i += batchSize) {
        const batch = validCustomers.slice(i, i + batchSize);
        
        try {
          await db.insert(customers).values(batch).onConflictDoUpdate({
            target: customers.customerNumber,
            set: {
              companyName: customers.companyName,
              alternateNames: customers.alternateNames,
              email: customers.email,
              phone: customers.phone,
              address: customers.address,
              netsuiteId: customers.netsuiteId,
              isActive: customers.isActive,
              updatedAt: new Date(),
            }
          });
          
          imported += batch.length;
          console.log(`   ✅ Imported batch: ${imported}/${validCustomers.length}`);
        } catch (batchError) {
          console.error(`Error importing batch:`, batchError);
          errors.push({
            batch: `${i + 1}-${Math.min(i + batchSize, validCustomers.length)}`,
            error: batchError instanceof Error ? batchError.message : 'Unknown error'
          });
        }
      }
      
      // Refresh cache after import
      await customerLookupService.refreshCache();
      
      res.json({
        success: true,
        imported,
        errors: errors.length,
        errorDetails: errors.slice(0, 10), // Show first 10 errors
        message: `Successfully imported ${imported} customers`
      });
      
    } catch (error) {
      console.error("Error in bulk import:", error);
      res.status(500).json({ error: "Bulk import failed" });
    }
  });

  // Create/update single customer
  app.post("/api/customers", async (req, res) => {
    try {
      const customerData = req.body;
      
      const [newCustomer] = await db
        .insert(customers)
        .values(customerData)
        .returning();

      // Refresh cache after adding new customer
      await customerLookupService.refreshCache();
      
      res.json(newCustomer);
    } catch (error) {
      console.error("Error creating customer:", error);
      res.status(500).json({ error: "Failed to create customer" });
    }
  });
}