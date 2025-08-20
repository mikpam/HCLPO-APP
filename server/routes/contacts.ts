import { Express } from "express";
import { db } from "../db";
import { contacts } from "../../shared/schema";
import { and, eq, or, ilike, sql } from "drizzle-orm";

export function registerContactRoutes(app: Express): void {
  // Get all contacts (with optional pagination and filtering)
  app.get("/api/contacts", async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 1000; // Higher limit for contacts since they're often browsed
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

      res.json(allContacts);
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
}