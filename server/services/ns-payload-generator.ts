import { type PurchaseOrder } from "@shared/schema";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Generates NetSuite-ready payload from validated purchase order data
 * Uses OpenAI to format and structure the data according to NetSuite requirements
 */
export async function generateNSPayload(po: PurchaseOrder): Promise<any> {
  try {
    // Map email intent from our format to NetSuite format
    const mapEmailIntent = (intent: string | null): string => {
      if (!intent) return "None";
      const intentMap: Record<string, string> = {
        'rush_order': 'Rush',
        'purchase_order': 'Purchase Order',
        'sample_request': 'Sample',
        'follow_up': 'Follow Up',
        'none': 'None'
      };
      return intentMap[intent.toLowerCase()] || 'Purchase Order';
    };

    // Extract data from the jsonb fields
    const extractedData = po.extractedData as any || {};
    const purchaseOrderData = extractedData.purchaseOrder || {};
    const subtotals = extractedData.subtotals || {};
    const lineItemsArray = Array.isArray(po.lineItems) ? po.lineItems : [];

    // Prepare the validated data for OpenAI formatting
    const validatedData = {
      purchaseOrder: {
        purchaseOrderNumber: po.poNumber,
        orderDate: purchaseOrderData.orderDate || new Date().toISOString().split('T')[0],
        inHandsDate: purchaseOrderData.inHandsDate || null,
        requiredShipDate: purchaseOrderData.requiredShipDate || null,
        customer: po.customerMeta || {},
        ppaiNumber: purchaseOrderData.ppaiNumber || "",
        asiNumber: purchaseOrderData.asiNumber || "",
        salesPersonName: purchaseOrderData.salesPersonName || "",
        salesPersonEmail: purchaseOrderData.salesPersonEmail || "",
        vendor: purchaseOrderData.vendor || {
          name: "HIGH CALIBER LINE USA",
          address1: "6250 N IRWINDALE AVE",
          city: "IRWINDALE",
          state: "California",
          zipCode: "91702",
          country: "United States"
        },
        shipTo: po.shipToAddress || purchaseOrderData.shipTo || {},
        lineItems: lineItemsArray,
        subtotals: subtotals || calculateSubtotals(lineItemsArray),
        shippingMethod: po.shippingMethod || purchaseOrderData.shippingMethod || "",
        shippingCarrier: po.shippingCarrier || purchaseOrderData.shippingCarrier || "",
        specialInstructions: extractedData.specialInstructions || "",
        emailIntent: mapEmailIntent(po.emailIntent),
        sourceDocumentUrl: po.extractionSourceFile || "",
        emlUrl: po.emlFilePath || ""
      }
    };

    // Use OpenAI to format and validate the NS payload
    const prompt = `You are an AI extraction agent for the HCL Purchase Order App.

Task:
Format the provided validated purchase order data for NetSuite. Return a single valid JSON object with no markdown or extra text.

Rules:
- If finalSKU is not present in line items, use the original SKU
- If finalSKU cannot be determined, set it to "OE-MISC-CHARGE" for charges or "OE-MISC-ITEM" for products
- Preserve exact quantities and prices
- Ensure all required fields are populated
- Use the provided URLs for sourceDocumentUrl and emlUrl

Input Data:
${JSON.stringify(validatedData, null, 2)}

Output: Only return the formatted JSON object following the NetSuite schema.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o", // Latest OpenAI model
      messages: [
        {
          role: "system",
          content: "You are a precise data formatter for NetSuite integration. Return only valid JSON with no markdown or explanations."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0
    });

    const nsPayload = JSON.parse(response.choices[0].message.content || "{}");
    
    // Ensure critical fields are present
    if (!nsPayload.purchaseOrder) {
      throw new Error("Invalid NS payload structure - missing purchaseOrder");
    }

    console.log(`✅ NS Payload generated for PO ${po.poNumber}`);
    return nsPayload;

  } catch (error) {
    console.error(`❌ Failed to generate NS payload for PO ${po.poNumber}:`, error);
    
    // Return a basic structure if OpenAI fails
    return {
      purchaseOrder: {
        purchaseOrderNumber: po.poNumber,
        orderDate: new Date().toISOString().split('T')[0],
        customer: po.customerMeta || {},
        lineItems: po.lineItems || [],
        subtotals: calculateSubtotals(po.lineItems || []),
        emailIntent: mapEmailIntent(po.emailIntent),
        sourceDocumentUrl: po.extractionSourceFile || "",
        emlUrl: po.emlFilePath || "",
        error: "Failed to generate complete NS payload"
      }
    };
  }
}

/**
 * Calculate subtotals from line items
 */
function calculateSubtotals(lineItems: any[]): any {
  let merchandiseSubtotal = 0;
  let additionalChargesSubtotal = 0;

  lineItems.forEach(item => {
    const totalPrice = item.totalPrice || (item.quantity * item.unitPrice) || 0;
    
    // Determine if it's a charge or merchandise based on SKU patterns
    const isCharge = /^(SETUP|FREIGHT|ART|RUSH|SAMPLE|OE-MISC-CHARGE)/i.test(item.finalSKU || item.sku || "");
    
    if (isCharge) {
      additionalChargesSubtotal += totalPrice;
    } else {
      merchandiseSubtotal += totalPrice;
    }
  });

  return {
    merchandiseSubtotal: Math.round(merchandiseSubtotal * 100) / 100,
    additionalChargesSubtotal: Math.round(additionalChargesSubtotal * 100) / 100,
    grandTotal: Math.round((merchandiseSubtotal + additionalChargesSubtotal) * 100) / 100
  };
}