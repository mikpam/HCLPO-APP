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

  // Create/update customer
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