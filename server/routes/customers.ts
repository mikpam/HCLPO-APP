import type { Express } from "express";
import { customerLookupService } from "../services/customer-lookup";
import { db } from "../db";
import { customers, insertCustomerSchema, updateCustomerSchema } from "@shared/schema";
import { eq, or, ilike, sql, and } from "drizzle-orm";
import { z } from "zod";

export function registerCustomerRoutes(app: Express): void {
  // Get all customers (with optional pagination)
  app.get("/api/customers", async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10000; // Default to show all records, configurable via limit parameter
      const offset = (page - 1) * limit;
      const search = req.query.search as string;
      const status = req.query.status as string; // "all", "active", "inactive"

      let query = db
        .select({
          id: customers.id,
          customer_number: customers.customerNumber,
          company_name: customers.companyName,
          alternate_names: customers.alternateNames,
          email: customers.email,
          phone: customers.phone,
          address: customers.address,
          netsuite_id: customers.netsuiteId,
          is_active: customers.isActive,
          created_at: customers.createdAt,
          updated_at: customers.updatedAt
        })
        .from(customers);

      // Build where conditions with proper types
      let whereCondition: any = undefined;

      // Add search filtering if search parameter provided
      if (search && search.trim()) {
        const searchTerm = `%${search.trim()}%`;
        const searchCondition = or(
          ilike(customers.companyName, searchTerm),
          ilike(customers.email, searchTerm),
          sql`${customers.alternateNames}::text ILIKE ${searchTerm}`
        );
        whereCondition = whereCondition ? and(whereCondition, searchCondition) : searchCondition;
      }

      // Add status filtering
      if (status && status !== "all") {
        const statusCondition = status === "active" 
          ? eq(customers.isActive, true)
          : eq(customers.isActive, false);
        whereCondition = whereCondition ? and(whereCondition, statusCondition) : statusCondition;
      }

      // Apply where condition if it exists
      if (whereCondition) {
        query = query.where(whereCondition);
      }

      const allCustomers = await query
        .orderBy(customers.companyName)
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

  // OpenAI-powered customer finder endpoint
  app.post("/api/customers/find", async (req, res) => {
    try {
      const { customerName, customerEmail, senderEmail, asiNumber, ppaiNumber, address } = req.body;
      
      // Import OpenAI customer finder service
      const { OpenAICustomerFinderService } = await import("../services/openai-customer-finder");
      const finderService = new OpenAICustomerFinderService();
      
      const result = await finderService.findCustomer({
        customerName,
        customerEmail,
        senderEmail,
        asiNumber,
        ppaiNumber,
        address
      });
      
      res.json(result);
    } catch (error) {
      console.error("Error finding customer with OpenAI:", error);
      res.status(500).json({ error: "Customer finder failed" });
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



  // Create a new customer (Admin only)
  app.post("/api/customers", async (req, res) => {
    try {
      // Basic validation - in a real app, you'd want proper authentication middleware
      const userRole = req.headers['user-role'] || 'operator';
      if (userRole !== 'admin') {
        return res.status(403).json({ error: "Admin access required" });
      }

      const validatedData = insertCustomerSchema.parse(req.body);
      
      // Check if customer number already exists
      const existingCustomer = await db
        .select()
        .from(customers)
        .where(eq(customers.customerNumber, validatedData.customerNumber))
        .limit(1);

      if (existingCustomer.length > 0) {
        return res.status(400).json({ error: "Customer number already exists" });
      }

      const newCustomer = await db
        .insert(customers)
        .values({
          ...validatedData,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      // Refresh customer cache after creation
      await customerLookupService.refreshCache();

      res.status(201).json(newCustomer[0]);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          error: "Validation error", 
          details: error.errors 
        });
      }
      console.error("Error creating customer:", error);
      res.status(500).json({ error: "Failed to create customer" });
    }
  });

  // Update an existing customer (Admin only)
  app.put("/api/customers/:id", async (req, res) => {
    try {
      // Basic validation - in a real app, you'd want proper authentication middleware
      const userRole = req.headers['user-role'] || 'operator';
      if (userRole !== 'admin') {
        return res.status(403).json({ error: "Admin access required" });
      }

      const customerId = req.params.id;
      const validatedData = updateCustomerSchema.parse(req.body);

      // Check if customer exists
      const existingCustomer = await db
        .select()
        .from(customers)
        .where(eq(customers.id, customerId))
        .limit(1);

      if (existingCustomer.length === 0) {
        return res.status(404).json({ error: "Customer not found" });
      }

      // If customer number is being changed, check for duplicates
      if (validatedData.customerNumber) {
        const duplicateCustomer = await db
          .select()
          .from(customers)
          .where(eq(customers.customerNumber, validatedData.customerNumber))
          .limit(1);

        if (duplicateCustomer.length > 0 && duplicateCustomer[0].id !== customerId) {
          return res.status(400).json({ error: "Customer number already exists" });
        }
      }

      const updatedCustomer = await db
        .update(customers)
        .set({
          ...validatedData,
          updatedAt: new Date(),
        })
        .where(eq(customers.id, customerId))
        .returning();

      // Refresh customer cache after update
      await customerLookupService.refreshCache();

      res.json(updatedCustomer[0]);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          error: "Validation error", 
          details: error.errors 
        });
      }
      console.error("Error updating customer:", error);
      res.status(500).json({ error: "Failed to update customer" });
    }
  });

  // Delete a customer (Admin only)
  app.delete("/api/customers/:id", async (req, res) => {
    try {
      // Basic validation - in a real app, you'd want proper authentication middleware
      const userRole = req.headers['user-role'] || 'operator';
      if (userRole !== 'admin') {
        return res.status(403).json({ error: "Admin access required" });
      }

      const customerId = req.params.id;

      // Check if customer exists
      const existingCustomer = await db
        .select()
        .from(customers)
        .where(eq(customers.id, customerId))
        .limit(1);

      if (existingCustomer.length === 0) {
        return res.status(404).json({ error: "Customer not found" });
      }

      // Instead of hard delete, mark as inactive (soft delete)
      // This preserves data integrity for historical records
      const updatedCustomer = await db
        .update(customers)
        .set({
          isActive: false,
          updatedAt: new Date(),
        })
        .where(eq(customers.id, customerId))
        .returning();

      // Refresh customer cache after deletion
      await customerLookupService.refreshCache();

      res.json({ 
        message: "Customer deactivated successfully",
        customer: updatedCustomer[0]
      });
    } catch (error) {
      console.error("Error deleting customer:", error);
      res.status(500).json({ error: "Failed to delete customer" });
    }
  });

  // Reactivate a customer (Admin only)
  app.patch("/api/customers/:id/reactivate", async (req, res) => {
    try {
      // Basic validation - in a real app, you'd want proper authentication middleware
      const userRole = req.headers['user-role'] || 'operator';
      if (userRole !== 'admin') {
        return res.status(403).json({ error: "Admin access required" });
      }

      const customerId = req.params.id;

      const updatedCustomer = await db
        .update(customers)
        .set({
          isActive: true,
          updatedAt: new Date(),
        })
        .where(eq(customers.id, customerId))
        .returning();

      if (updatedCustomer.length === 0) {
        return res.status(404).json({ error: "Customer not found" });
      }

      // Refresh customer cache after reactivation
      await customerLookupService.refreshCache();

      res.json({ 
        message: "Customer reactivated successfully",
        customer: updatedCustomer[0]
      });
    } catch (error) {
      console.error("Error reactivating customer:", error);
      res.status(500).json({ error: "Failed to reactivate customer" });
    }
  });
}