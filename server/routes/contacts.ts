import { Express } from "express";
import { db } from "../db";
import { contacts, insertContactSchema } from "../../shared/schema";
import { and, eq, or, ilike, sql } from "drizzle-orm";
import { z } from "zod";

export function registerContactRoutes(app: Express): void {
  // Get contact statistics
  app.get("/api/contacts/stats", async (req, res) => {
    try {
      const [
        totalContacts,
        verifiedContacts,
        activeContacts,
        contactsWithEmail
      ] = await Promise.all([
        db.select({ count: sql<number>`count(*)` }).from(contacts),
        db.select({ count: sql<number>`count(*)` }).from(contacts).where(eq(contacts.verified, true)),
        db.select({ count: sql<number>`count(*)` }).from(contacts).where(eq(contacts.inactive, false)),
        db.select({ count: sql<number>`count(*)` }).from(contacts).where(sql`${contacts.email} IS NOT NULL AND ${contacts.email} != ''`)
      ]);

      res.json({
        total: totalContacts[0].count,
        verified: verifiedContacts[0].count,
        active: activeContacts[0].count,
        withEmail: contactsWithEmail[0].count
      });
    } catch (error) {
      console.error("Error fetching contact statistics:", error);
      res.status(500).json({ error: "Failed to fetch contact statistics" });
    }
  });

  // Get all contacts (with optional pagination and filtering)
  app.get("/api/contacts", async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50; // Default to 50 contacts per page
      const offset = (page - 1) * limit;
      const search = req.query.search as string;
      const status = req.query.status as string; // "all", "active", "inactive"
      const verification = req.query.verification as string; // "all", "verified", "unverified"

      let query = db
        .select({
          id: contacts.id,
          netsuite_internal_id: contacts.netsuiteInternalId,
          name: contacts.name,
          job_title: contacts.jobTitle,
          phone: contacts.phone,
          email: contacts.email,
          inactive: contacts.inactive,
          duplicate: contacts.duplicate,
          login_access: contacts.loginAccess,
          verified: contacts.verified,
          last_verified_at: contacts.lastVerifiedAt,
          last_verified_method: contacts.lastVerifiedMethod,
          verification_confidence: contacts.verificationConfidence,
          created_at: contacts.createdAt,
          updated_at: contacts.updatedAt
        })
        .from(contacts);

      // Build where conditions
      let whereCondition: any = undefined;

      // Add search filtering if search parameter provided
      if (search && search.trim()) {
        const searchTerm = `%${search.trim()}%`;
        const searchCondition = or(
          ilike(contacts.name, searchTerm),
          ilike(contacts.email, searchTerm),
          ilike(contacts.jobTitle, searchTerm),
          ilike(contacts.phone, searchTerm)
        );
        whereCondition = whereCondition ? and(whereCondition, searchCondition) : searchCondition;
      }

      // Add status filtering (active/inactive)
      if (status && status !== "all") {
        const statusCondition = status === "active" 
          ? eq(contacts.inactive, false)
          : eq(contacts.inactive, true);
        whereCondition = whereCondition ? and(whereCondition, statusCondition) : statusCondition;
      }

      // Add verification filtering
      if (verification && verification !== "all") {
        const verificationCondition = verification === "verified"
          ? eq(contacts.verified, true)
          : eq(contacts.verified, false);
        whereCondition = whereCondition ? and(whereCondition, verificationCondition) : verificationCondition;
      }

      // Apply where condition and execute query
      let result;
      if (whereCondition) {
        result = await query
          .where(whereCondition)
          .orderBy(contacts.name)
          .limit(limit)
          .offset(offset);
      } else {
        result = await query
          .orderBy(contacts.name)
          .limit(limit)
          .offset(offset);
      }

      const allContacts = result;

      // Get total count for pagination
      const totalCountQuery = db.select({ count: sql<number>`count(*)` }).from(contacts);
      let totalCount;
      if (whereCondition) {
        totalCount = await totalCountQuery.where(whereCondition);
      } else {
        totalCount = await totalCountQuery;
      }

      res.json({
        data: allContacts,
        pagination: {
          page,
          limit,
          total: totalCount[0].count,
          totalPages: Math.ceil(totalCount[0].count / limit)
        }
      });
    } catch (error) {
      console.error("Error fetching contacts:", error);
      res.status(500).json({ error: "Failed to fetch contacts" });
    }
  });

  // Get contact by ID
  app.get("/api/contacts/:id", async (req, res) => {
    try {
      const contactId = req.params.id;

      const contact = await db
        .select()
        .from(contacts)
        .where(eq(contacts.id, contactId))
        .limit(1);

      if (contact.length === 0) {
        return res.status(404).json({ error: "Contact not found" });
      }

      res.json(contact[0]);
    } catch (error) {
      console.error("Error fetching contact:", error);
      res.status(500).json({ error: "Failed to fetch contact" });
    }
  });

  // Search contacts by various criteria (for contact validation/lookup)
  app.post("/api/contacts/search", async (req, res) => {
    try {
      const { name, email, jobTitle, phone, limit = 10 } = req.body;

      let query = db.select().from(contacts);
      let whereCondition: any = undefined;

      if (name) {
        const nameCondition = ilike(contacts.name, `%${name}%`);
        whereCondition = whereCondition ? and(whereCondition, nameCondition) : nameCondition;
      }

      if (email) {
        const emailCondition = ilike(contacts.email, `%${email}%`);
        whereCondition = whereCondition ? and(whereCondition, emailCondition) : emailCondition;
      }

      if (jobTitle) {
        const jobTitleCondition = ilike(contacts.jobTitle, `%${jobTitle}%`);
        whereCondition = whereCondition ? and(whereCondition, jobTitleCondition) : jobTitleCondition;
      }

      if (phone) {
        const phoneCondition = ilike(contacts.phone, `%${phone}%`);
        whereCondition = whereCondition ? and(whereCondition, phoneCondition) : phoneCondition;
      }

      let searchResults;
      if (whereCondition) {
        searchResults = await query
          .where(whereCondition)
          .orderBy(contacts.name)
          .limit(limit);
      } else {
        searchResults = await query
          .orderBy(contacts.name)
          .limit(limit);
      }

      res.json(searchResults);
    } catch (error) {
      console.error("Error searching contacts:", error);
      res.status(500).json({ error: "Failed to search contacts" });
    }
  });

  // Create new contact
  app.post("/api/contacts", async (req, res) => {
    try {
      const validatedData = insertContactSchema.parse(req.body);

      // Check if NetSuite ID already exists
      const existingContact = await db
        .select()
        .from(contacts)
        .where(eq(contacts.netsuiteInternalId, validatedData.netsuiteInternalId))
        .limit(1);

      if (existingContact.length > 0) {
        return res.status(400).json({ error: "Contact with this NetSuite ID already exists" });
      }

      const newContact = await db
        .insert(contacts)
        .values({
          ...validatedData,
          verified: false,
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .returning();

      res.status(201).json(newContact[0]);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          error: "Validation error", 
          details: error.errors 
        });
      }
      console.error("Error creating contact:", error);
      res.status(500).json({ error: "Failed to create contact" });
    }
  });

  // Update contact
  app.put("/api/contacts/:id", async (req, res) => {
    try {
      const contactId = req.params.id;
      
      // Create partial update schema
      const updateContactSchema = insertContactSchema.partial();
      const validatedData = updateContactSchema.parse(req.body);

      // Check if contact exists
      const existingContact = await db
        .select()
        .from(contacts)
        .where(eq(contacts.id, contactId))
        .limit(1);

      if (existingContact.length === 0) {
        return res.status(404).json({ error: "Contact not found" });
      }

      const updatedContact = await db
        .update(contacts)
        .set({
          ...validatedData,
          updatedAt: new Date()
        })
        .where(eq(contacts.id, contactId))
        .returning();

      res.json(updatedContact[0]);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          error: "Validation error", 
          details: error.errors 
        });
      }
      console.error("Error updating contact:", error);
      res.status(500).json({ error: "Failed to update contact" });
    }
  });

  // Delete contact (soft delete by marking as inactive)
  app.delete("/api/contacts/:id", async (req, res) => {
    try {
      const contactId = req.params.id;

      // Check if contact exists
      const existingContact = await db
        .select()
        .from(contacts)
        .where(eq(contacts.id, contactId))
        .limit(1);

      if (existingContact.length === 0) {
        return res.status(404).json({ error: "Contact not found" });
      }

      // Soft delete by marking as inactive
      const updatedContact = await db
        .update(contacts)
        .set({
          inactive: true,
          updatedAt: new Date()
        })
        .where(eq(contacts.id, contactId))
        .returning();

      res.json({ 
        message: "Contact deactivated successfully",
        contact: updatedContact[0]
      });
    } catch (error) {
      console.error("Error deleting contact:", error);
      res.status(500).json({ error: "Failed to delete contact" });
    }
  });

  // Reactivate contact
  app.patch("/api/contacts/:id/reactivate", async (req, res) => {
    try {
      const contactId = req.params.id;

      const updatedContact = await db
        .update(contacts)
        .set({
          inactive: false,
          updatedAt: new Date()
        })
        .where(eq(contacts.id, contactId))
        .returning();

      if (updatedContact.length === 0) {
        return res.status(404).json({ error: "Contact not found" });
      }

      res.json({ 
        message: "Contact reactivated successfully",
        contact: updatedContact[0]
      });
    } catch (error) {
      console.error("Error reactivating contact:", error);
      res.status(500).json({ error: "Failed to reactivate contact" });
    }
  });
}