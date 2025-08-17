import { Router } from "express";
import { db } from "../db";
import { items, insertItemSchema, updateItemSchema } from "@shared/schema";
import { eq, ilike, or, count, asc, desc } from "drizzle-orm";
import type { InsertItem, UpdateItem } from "@shared/schema";
import { z } from "zod";

const router = Router();

// Role-based access control middleware
const requireAdmin = (req: any, res: any, next: any) => {
  const userRole = req.headers["user-role"];
  if (userRole !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
};

// GET /api/items - List all items with pagination and search
router.get("/", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limitParam = parseInt(req.query.limit as string) || 25;
    const limit = Math.min(50000, Math.max(1, limitParam)); // Allow up to 50k items like customers
    const offset = (page - 1) * limit;
    const search = req.query.search as string;
    const sortBy = req.query.sortBy as string || "displayName";
    const sortOrder = req.query.sortOrder as string || "asc";

    // Build where conditions
    const whereConditions = [];
    
    if (search) {
      whereConditions.push(
        or(
          ilike(items.finalSku, `%${search}%`),
          ilike(items.displayName, `%${search}%`),
          ilike(items.description, `%${search}%`),
          ilike(items.netsuiteId, `%${search}%`)
        )
      );
    }

    // Build sort order
    const sortColumn = sortBy === "finalSku" ? items.finalSku
                     : sortBy === "displayName" ? items.displayName
                     : sortBy === "netsuiteId" ? items.netsuiteId
                     : sortBy === "basePrice" ? items.basePrice
                     : sortBy === "isActive" ? items.isActive
                     : items.displayName;

    const orderBy = sortOrder === "desc" ? desc(sortColumn) : asc(sortColumn);

    // Get total count
    const totalResult = await db
      .select({ count: count() })
      .from(items)
      .where(whereConditions.length > 0 ? whereConditions[0] : undefined);
    
    const total = totalResult[0]?.count || 0;

    // Get items
    const itemsResult = await db
      .select()
      .from(items)
      .where(whereConditions.length > 0 ? whereConditions[0] : undefined)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset);

    res.json({
      items: itemsResult,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching items:", error);
    res.status(500).json({ error: "Failed to fetch items" });
  }
});

// GET /api/items/stats - Get item statistics
router.get("/stats", async (req, res) => {
  try {
    const totalResult = await db.select({ count: count() }).from(items);
    const activeResult = await db
      .select({ count: count() })
      .from(items)
      .where(eq(items.isActive, true));
    
    res.json({
      total: totalResult[0]?.count || 0,
      active: activeResult[0]?.count || 0,
      inactive: (totalResult[0]?.count || 0) - (activeResult[0]?.count || 0),
    });
  } catch (error) {
    console.error("Error fetching item stats:", error);
    res.status(500).json({ error: "Failed to fetch item statistics" });
  }
});

// POST /api/items - Create new item (admin only)
router.post("/", requireAdmin, async (req, res) => {
  try {
    const validatedData = insertItemSchema.parse(req.body);
    
    // Create search vector for full-text search
    const searchTerms = [
      validatedData.finalSku,
      validatedData.displayName,
      validatedData.description,
      validatedData.subType
    ].filter(Boolean).join(" ");

    const itemData: InsertItem = {
      ...validatedData,
      searchVector: searchTerms.toLowerCase(),
    };

    const [newItem] = await db.insert(items).values(itemData).returning();
    
    res.status(201).json(newItem);
  } catch (error) {
    console.error("Error creating item:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: error.errors 
      });
    }
    res.status(500).json({ error: "Failed to create item" });
  }
});

// PUT /api/items/:id - Update item (admin only)
router.put("/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const validatedData = updateItemSchema.parse(req.body);

    // Update search vector if relevant fields are being updated
    let updateData: any = { ...validatedData };
    
    if (validatedData.finalSku || validatedData.displayName || validatedData.description || validatedData.subType) {
      // Get current item to build complete search vector
      const [currentItem] = await db.select().from(items).where(eq(items.id, id));
      
      if (!currentItem) {
        return res.status(404).json({ error: "Item not found" });
      }

      const searchTerms = [
        validatedData.finalSku || currentItem.finalSku,
        validatedData.displayName || currentItem.displayName,
        validatedData.description || currentItem.description,
        validatedData.subType || currentItem.subType
      ].filter(Boolean).join(" ");

      updateData.searchVector = searchTerms.toLowerCase();
    }

    updateData.updatedAt = new Date();

    const [updatedItem] = await db
      .update(items)
      .set(updateData)
      .where(eq(items.id, id))
      .returning();

    if (!updatedItem) {
      return res.status(404).json({ error: "Item not found" });
    }

    res.json(updatedItem);
  } catch (error) {
    console.error("Error updating item:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: error.errors 
      });
    }
    res.status(500).json({ error: "Failed to update item" });
  }
});

// DELETE /api/items/:id - Delete/deactivate item (admin only)
router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Instead of hard delete, we deactivate the item
    const [updatedItem] = await db
      .update(items)
      .set({ 
        isActive: false,
        updatedAt: new Date()
      })
      .where(eq(items.id, id))
      .returning();

    if (!updatedItem) {
      return res.status(404).json({ error: "Item not found" });
    }

    res.json({ message: "Item deactivated successfully", item: updatedItem });
  } catch (error) {
    console.error("Error deactivating item:", error);
    res.status(500).json({ error: "Failed to deactivate item" });
  }
});

// POST /api/items/:id/activate - Reactivate item (admin only)
router.post("/:id/activate", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const [updatedItem] = await db
      .update(items)
      .set({ 
        isActive: true,
        updatedAt: new Date()
      })
      .where(eq(items.id, id))
      .returning();

    if (!updatedItem) {
      return res.status(404).json({ error: "Item not found" });
    }

    res.json({ message: "Item reactivated successfully", item: updatedItem });
  } catch (error) {
    console.error("Error reactivating item:", error);
    res.status(500).json({ error: "Failed to reactivate item" });
  }
});

export default router;