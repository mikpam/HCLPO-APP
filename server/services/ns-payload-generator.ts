import { type PurchaseOrder } from "@shared/schema";
import OpenAI from "openai";
import { ObjectStorageService } from "../objectStorage";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const objectStorageService = new ObjectStorageService();

/**
 * Generate a presigned URL for an object storage path
 * Converts internal paths like /objects/attachments/... to accessible URLs
 */
async function generatePresignedUrl(objectPath: string | null): Promise<string> {
  if (!objectPath || objectPath === '') return '';
  
  try {
    // Remove /objects/ prefix if present
    let cleanPath = objectPath;
    if (cleanPath.startsWith('/objects/')) {
      cleanPath = cleanPath.substring(9); // Remove '/objects/'
    }
    
    // Generate presigned URL using object storage service with cleaned path
    const url = await objectStorageService.generatePresignedGetUrl(cleanPath, 7 * 24 * 60 * 60); // 7 days TTL
    console.log(`   ✅ Generated presigned URL for ${cleanPath}`);
    return url;
  } catch (error) {
    console.error(`Failed to generate presigned URL for ${objectPath}:`, error);
    return ''; // Return empty string if generation fails
  }
}

/**
 * Generates NetSuite-ready payload from validated purchase order data
 * Uses OpenAI to format and structure the data according to NetSuite requirements
 */
export async function generateNSPayload(po: PurchaseOrder): Promise<any> {
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

  // Helper function to calculate subtotals
  const calculateSubtotals = (lineItems: any[]): any => {
    const subtotal = lineItems.reduce((sum, item) => {
      const price = parseFloat(item.unitPrice || item.price || '0');
      const quantity = parseInt(item.quantity || '0');
      return sum + (price * quantity);
    }, 0);
    
    return {
      subtotal: subtotal.toFixed(2),
      tax: '0.00',
      shipping: '0.00',
      total: subtotal.toFixed(2)
    };
  };

  try {
    // Extract data from the jsonb fields
    const extractedData = po.extractedData as any || {};
    const purchaseOrderData = extractedData.purchaseOrder || {};
    const subtotals = extractedData.subtotals || {};
    const lineItemsArray = Array.isArray(po.lineItems) ? po.lineItems : [];

    // Generate presigned URLs for documents
    const sourceDocumentUrl = await generatePresignedUrl(po.extractionSourceFile);
    const emlUrl = await generatePresignedUrl(po.emlFilePath);

    // Prepare the validated data for OpenAI formatting
    const validatedData = {
      purchaseOrder: {
        purchaseOrderNumber: po.poNumber,
        externalId: po.poNumber, // Add externalId for NetSuite
        poNumber: po.poNumber, // Add poNumber field as well
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
        sourceDocumentUrl: sourceDocumentUrl,
        emlUrl: emlUrl
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
    
    // Generate presigned URLs even for fallback
    const fallbackSourceUrl = await generatePresignedUrl(po.extractionSourceFile);
    const fallbackEmlUrl = await generatePresignedUrl(po.emlFilePath);
    
    // Return a basic structure if OpenAI fails
    return {
      purchaseOrder: {
        purchaseOrderNumber: po.poNumber,
        orderDate: new Date().toISOString().split('T')[0],
        customer: po.customerMeta || {},
        lineItems: po.lineItems || [],
        subtotals: calculateSubtotals(po.lineItems || []),
        emailIntent: mapEmailIntent(po.emailIntent),
        sourceDocumentUrl: fallbackSourceUrl,
        emlUrl: fallbackEmlUrl,
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