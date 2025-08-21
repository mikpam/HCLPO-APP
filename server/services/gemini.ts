import { GoogleGenAI } from "@google/genai";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// DON'T DELETE THIS COMMENT
// Follow these instructions when using this blueprint:
// - Note that the newest Gemini model series is "gemini-2.5-flash" or gemini-2.5-pro"
//   - do not change this unless explicitly requested by the user

// This API key is from Gemini Developer API Key, not vertex AI API Key
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface EmailClassificationInput {
  sender: string;
  subject: string;
  body: string;
  attachments: Array<{
    filename: string;
    contentType: string;
    size: number;
  }>;
}

export interface ClassificationFlags {
  has_attachments: boolean;
  attachments_all_artwork_files: boolean;
  po_details_in_body_sufficient: boolean;
  is_sample_request_in_body: boolean;
  overall_po_nature_probability: "high" | "medium" | "low";
  confidence_score: number;
}

export interface ClassificationResult {
  analysis_flags: ClassificationFlags;
  recommended_route: "TEXT_PO" | "TEXT_SAMPLE" | "ATTACHMENT_PO" | "ATTACHMENT_SAMPLE" | "REVIEW";
  suggested_tags: string[];
}

export class GeminiService {
  private ai = ai;

  private isArtworkFile(filename: string, contentType: string): boolean {
    const artworkExtensions = ['.ai', '.eps', '.svg', '.png', '.jpg', '.jpeg', '.tif', '.gif', '.bmp', '.psd'];
    const artworkMimeTypes = ['application/postscript', 'image/', 'application/illustrator'];
    
    // Enhanced artwork filename patterns - key improvement!
    const artworkKeywords = [
      'art', 'artwork', 'logo', 'proof', 'design', 'mockup', 'layout', 
      'image', 'visual', 'graphic', 'creative', 'brand', 'branding',
      'signature', 'watermark', 'template'
    ];
    
    // Common artwork filename patterns
    const artworkPatterns = [
      /\b(art|artwork|logo|proof|design)\b/i,           // Words like ART, ARTWORK, LOGO, PROOF, DESIGN
      /^image\d*\./i,                                   // Generic image files like image001.png
      /_(art|artwork|logo|proof|design)(_|\.|$)/i,      // Underscore separated like PO_ART.pdf
      /\b(mockup|layout|creative|visual|graphic)\b/i    // Design-related terms
    ];
    
    const filenameLower = filename.toLowerCase();
    
    const hasArtworkExtension = artworkExtensions.some(ext => 
      filenameLower.endsWith(ext)
    );
    
    const hasArtworkMimeType = artworkMimeTypes.some(mime => 
      contentType.toLowerCase().includes(mime)
    );
    
    const hasArtworkKeyword = artworkKeywords.some(keyword => 
      filenameLower.includes(keyword)
    );
    
    const hasArtworkPattern = artworkPatterns.some(pattern => 
      pattern.test(filename)
    );
    
    return hasArtworkExtension || hasArtworkMimeType || hasArtworkKeyword || hasArtworkPattern;
  }

  private checkBodySufficiency(body: string): boolean {
    const hasQuantities = /\b\d+\s*(pcs?|pieces?|units?|qty|quantity)\b/i.test(body);
    const hasPricing = /\$\d+|\d+\.\d{2}|total|price|cost/i.test(body);
    const hasItems = /item|product|description|part|sku/i.test(body);
    
    return hasQuantities && hasPricing && hasItems;
  }

  // This method is kept for interface compatibility but not used for email classification
  async classifyEmail(input: EmailClassificationInput): Promise<ClassificationResult> {
    // Fallback classification - Gemini is not used for email gate logic per user request
    return {
      analysis_flags: {
        has_attachments: input.attachments.length > 0,
        attachments_all_artwork_files: false,
        po_details_in_body_sufficient: false,
        is_sample_request_in_body: false,
        overall_po_nature_probability: "low",
        confidence_score: 0.1
      },
      recommended_route: 'REVIEW',
      suggested_tags: ['Gemini Not Used For Classification']
    };
  }

  private getMimeTypeFromFilename(filename: string): string {
    const extension = filename.toLowerCase().split('.').pop();
    
    const mimeTypes: { [key: string]: string } = {
      // PDF documents
      'pdf': 'application/pdf',
      
      // Images (common for scanned POs)
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'bmp': 'image/bmp',
      'tiff': 'image/tiff',
      'webp': 'image/webp',
      
      // Microsoft Office documents - Gemini supports these natively
      'doc': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xls': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      
      // Text and CSV
      'txt': 'text/plain',
      'csv': 'text/csv',
      'rtf': 'application/rtf'
    };
    
    return mimeTypes[extension || ''] || 'application/octet-stream';
  }

  /**
   * Screen multiple attachments using Gemini AI to identify which one is the purchase order
   */
  async screenAttachmentsForPurchaseOrder(attachments: Array<{
    filename: string;
    contentType: string;
    size: number;
    data?: Buffer;
    attachmentId?: string;
  }>): Promise<{
    purchaseOrderAttachment: any | null;
    confidence: number;
    reason: string;
    analysisResults: Array<{
      filename: string;
      isPurchaseOrder: boolean;
      confidence: number;
      reason: string;
    }>;
  }> {
    try {
      console.log(`🔍 GEMINI ATTACHMENT SCREENING: Analyzing ${attachments.length} attachments...`);
      
      const analysisResults: Array<{
        filename: string;
        isPurchaseOrder: boolean;
        confidence: number;
        reason: string;
      }> = [];

      // Analyze each attachment based on filename and content type
      for (const attachment of attachments) {
        console.log(`   └─ Analyzing: ${attachment.filename} (${attachment.contentType || 'unknown'})`);
        
        // Basic file analysis first
        const isLikelyPO = this.isLikelyPurchaseOrderFile(attachment.filename, attachment.contentType);
        const isArtwork = this.isArtworkFile(attachment.filename, attachment.contentType);
        
        let confidence = 0;
        let reason = "";
        
        if (isArtwork) {
          confidence = 0.1;
          reason = "File appears to be artwork/design file, not a purchase order";
        } else if (isLikelyPO) {
          confidence = 0.8;
          reason = "Filename and content type suggest this is a purchase order document";
        } else {
          confidence = 0.3;
          reason = "Unclear from filename/type - could be purchase order";
        }
        
        analysisResults.push({
          filename: attachment.filename,
          isPurchaseOrder: confidence > 0.5,
          confidence,
          reason
        });
        
        console.log(`      └─ PO Likelihood: ${Math.round(confidence * 100)}% - ${reason}`);
      }
      
      // Find the best candidate
      const bestCandidate = analysisResults
        .filter(result => result.isPurchaseOrder)
        .sort((a, b) => b.confidence - a.confidence)[0];
      
      if (bestCandidate) {
        const selectedAttachment = attachments.find(att => att.filename === bestCandidate.filename);
        console.log(`   ✅ Selected attachment: ${bestCandidate.filename} (${Math.round(bestCandidate.confidence * 100)}%)`);
        
        return {
          purchaseOrderAttachment: selectedAttachment,
          confidence: bestCandidate.confidence,
          reason: bestCandidate.reason,
          analysisResults
        };
      } else {
        console.log(`   ❌ No clear purchase order found among ${attachments.length} attachments`);
        
        return {
          purchaseOrderAttachment: null,
          confidence: 0,
          reason: "No attachment identified as a purchase order",
          analysisResults
        };
      }
      
    } catch (error) {
      console.log(`❌ Error screening attachments: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return {
        purchaseOrderAttachment: null,
        confidence: 0,
        reason: `Error during screening: ${error instanceof Error ? error.message : 'Unknown error'}`,
        analysisResults: []
      };
    }
  }

  private isLikelyPurchaseOrderFile(filename: string, contentType: string): boolean {
    const poKeywords = ['po', 'purchase', 'order', 'requisition', 'buy'];
    const businessFormats = ['pdf', 'doc', 'docx', 'xls', 'xlsx'];
    
    // Keywords that immediately disqualify a file from being a PO
    const excludeKeywords = [
      'shipping', 'label', 'receipt', 'invoice', 'bill', 'statement', 
      'packing', 'manifest', 'tracking', 'delivery', 'confirmation',
      'artwork', 'proof', 'design', 'layout', 'mockup', 'logo',
      'quote', 'estimate', 'proposal', 'rfq', 'bid'
    ];
    
    const filenameLower = filename.toLowerCase();
    
    // Immediate exclusion check
    const hasExcludeKeywords = excludeKeywords.some(keyword => 
      filenameLower.includes(keyword)
    );
    
    if (hasExcludeKeywords) {
      console.log(`   ❌ File excluded due to keyword: ${filename}`);
      return false;
    }
    
    const filenameHasPOKeywords = poKeywords.some(keyword => 
      filenameLower.includes(keyword)
    );
    
    const isBusinessFormat = businessFormats.some(format => 
      filenameLower.endsWith(`.${format}`) || 
      contentType.includes(format) ||
      contentType.includes('application')
    );
    
    // Only consider it a potential PO if it has explicit PO keywords OR is a business format with no exclusion keywords
    return filenameHasPOKeywords || (isBusinessFormat && !this.isArtworkFile(filename, contentType));
  }

  async filterDocumentType(documentBuffer: Buffer, filename: string): Promise<{ document_type: "purchase order" | "not a purchase order" }> {
    try {
      console.log(`🔍 GEMINI 2.5 FLASH FILTER: Analyzing ${filename} to determine if it's a purchase order`);

      // Convert document buffer to base64 and get MIME type
      const base64Data = documentBuffer.toString('base64');
      const mimeType = this.getMimeTypeFromFilename(filename);
      console.log(`   └─ Using MIME type: ${mimeType} (Gemini 2.5 Pro supports DOC/DOCX directly)`);

      const prompt = `Analyze the provided document to determine its primary function: Is it a purchase order (including sample orders/requests) or something else?

**LENIENT CLASSIFICATION - DEFAULT TO PURCHASE ORDER WHEN IN DOUBT**

**STRONG PURCHASE ORDER SIGNALS (If ANY present = likely PO):**
- Contains "PO" or "P.O." or "PO#" or "PO:" anywhere in the document
- Contains "Purchase Order" or "Order" or "Sample" in a business context
- Shows any items/products with quantities or prices
- Has shipping or delivery information
- References a vendor/supplier and buyer/customer
- Contains any order number or reference number

**REJECT as "not a purchase order" if document is:**
- Artwork/logo/design file (even with business text) - check for design elements, graphics, logos
- Image files that are primarily visual/graphical without structured order data
- PURE invoice asking for payment on already delivered items  
- PURE shipping label or tracking info for already shipped packages
- PURE marketing material or catalog with no specific order
- Files with "artwork", "logo", "design", "proof" in filename or prominent content

**SCORING (BE LENIENT - Need only 2 of these):**
1. Any reference number (PO#, order#, reference#, etc.)
2. Company names (buyer OR seller)
3. Any product/item mentions
4. Any quantities or amounts
5. Any dates (order date, ship date, need by date)
6. Any shipping/delivery information

**IMPORTANT - ERR ON THE SIDE OF INCLUSION:**
- If document mentions ordering, requesting, or needing items = PURCHASE ORDER
- If unclear or mixed content = PURCHASE ORDER
- If low quality scan but seems business-related = PURCHASE ORDER
- Only reject if 100% certain it's not an order

**Response Format:**

Output *only* the following JSON object, with no other text, comments, or explanations:

{
  "document_type": "purchase order" or "not a purchase order"
}`;

      const contents = [
        {
          inlineData: {
            data: base64Data,
            mimeType: mimeType,
          },
        },
        prompt,
      ];

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: contents,
      });

      const rawResponse = response.text || "";
      
      if (!rawResponse) {
        console.log(`   ⚠️  Empty response from Gemini, defaulting to 'not a purchase order'`);
        return { document_type: "not a purchase order" };
      }

      // Clean and parse JSON response
      let jsonStr = rawResponse.trim();
      
      // Remove markdown code blocks if present
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }

      const filterResult = JSON.parse(jsonStr);
      
      console.log(`   └─ Document Classification: ${filterResult.document_type}`);
      
      return filterResult;
      
    } catch (error) {
      console.error(`   ❌ AI Document Filter failed for ${filename}:`, error);
      console.log(`   └─ Defaulting to 'not a purchase order' due to error`);
      return { document_type: "not a purchase order" };
    }
  }

  // 🛡️ REPROCESSING METHOD: Enhanced line item extraction with focused prompts
  async reprocessDocumentForLineItems(documentBuffer: Buffer, filename: string, retryCount: number): Promise<any> {
    try {
      console.log(`🔄 REPROCESSING ATTEMPT ${retryCount}: Enhanced line item extraction for ${filename}`);
      
      const base64Data = documentBuffer.toString('base64');
      const mimeType = this.getMimeTypeFromFilename(filename);
      
      // Enhanced prompt specifically focused on line item extraction
      const enhancedPrompt = `🚨 CRITICAL: This document was identified as a PURCHASE ORDER but NO LINE ITEMS were extracted in the previous attempt.

ENHANCED LINE ITEM EXTRACTION FOCUS:
Please carefully examine this document again and extract ALL line items with EXTREME attention to detail.

Look for:
- Product codes, SKUs, item numbers (might be alphanumeric combinations)
- Product descriptions (even if abbreviated or unclear)
- Quantities (numbers followed by "each", "ea", "pcs", etc.)
- Unit prices, total prices
- Color specifications
- Any item-related charges (setup, artwork, rush, additional colors)

Common line item patterns to look for:
- Tables with rows of items
- Lists with bullets or numbers
- Item codes followed by descriptions
- Quantity and price columns
- Setup charges, artwork fees, rush charges as separate line items

REQUIRED JSON SCHEMA - Return ONLY this structure:
{
  "purchaseOrder": {
    "purchaseOrderNumber": "",
    "orderDate": "",
    "inHandsDate": "", 
    "requiredShipDate": "",
    "customer": {
      "customerNumber": "",
      "company": "",
      "firstName": "",
      "lastName": "",
      "email": "",
      "address1": "",
      "address2": "",
      "city": "",
      "state": "",
      "country": "",
      "zipCode": "",
      "phone": ""
    },
    "ppaiNumber": "",
    "asiNumber": "",
    "salesPersonName": "",
    "salesPersonEmail": "",
    "contact": {
      "name": "",
      "jobTitle": "", 
      "email": "",
      "phone": ""
    },
    "vendor": {
      "name": "",
      "address1": "",
      "address2": "",
      "city": "",
      "state": "",
      "country": "",
      "zipCode": "",
      "phone": "",
      "email": ""
    },
    "shipTo": {
      "name": "",
      "company": "",
      "address1": "",
      "address2": "",
      "city": "",
      "state": "",
      "country": "",
      "zipCode": ""
    },
    "shippingMethod": "",
    "shippingCarrier": ""
  },
  "lineItems": [
    {
      "sku": "",
      "itemColor": "",
      "imprintColor": "",
      "description": "",
      "quantity": 0,
      "unitPrice": 0.00,
      "totalPrice": 0.00,
      "finalSKU": ""
    }
  ],
  "subtotals": {
    "merchandiseSubtotal": 0.00,
    "additionalChargesSubtotal": 0.00,
    "grandTotal": 0.00
  },
  "specialInstructions": "",
  "additionalNotes": ["Reprocessed for line item extraction - attempt ${retryCount}"]
}

CRITICAL: Focus intensely on finding and extracting ALL line items from this purchase order document.`;

      const response = await this.ai.models.generateContent({
        model: "gemini-2.5-pro",
        config: {
          systemInstruction: "You are an expert purchase order line item extraction specialist. Your primary goal is to find and extract ALL line items from purchase order documents. Focus intensely on identifying products, SKUs, quantities, and prices. Return only valid JSON without markdown formatting.",
          responseMimeType: "application/json"
        },
        contents: [
          {
            role: "user",
            parts: [
              { text: enhancedPrompt },
              {
                inlineData: {
                  data: base64Data,
                  mimeType: mimeType
                }
              }
            ]
          }
        ],
      });

      const rawJson = response.text;
      if (rawJson) {
        const result = JSON.parse(rawJson);
        const processedResult = this.replaceNullsWithEmptyStrings(result);
        
        // Log the reprocessing result
        const itemCount = processedResult.lineItems ? processedResult.lineItems.length : 0;
        console.log(`🔄 REPROCESSING RESULT: Found ${itemCount} line items on attempt ${retryCount}`);
        
        return processedResult;
      } else {
        throw new Error("Empty response from Gemini during reprocessing");
      }
      
    } catch (error) {
      console.error(`❌ REPROCESSING FAILED (attempt ${retryCount}):`, error);
      // Return original extraction result with error note
      return {
        lineItems: [],
        additionalNotes: [`Reprocessing failed on attempt ${retryCount}: ${error instanceof Error ? error.message : 'Unknown error'}`]
      };
    }
  }

  async extractPODataFromText(subject: string, body: string, fromAddress: string): Promise<any> {
    try {
      console.log(`Processing email text with Gemini for TEXT_PO extraction`);
      
      // Strip HTML from body text
      const cleanBody = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      
      const prompt = `Extract purchase order data from the following email content and return ONLY a valid JSON object following this exact schema.

EMAIL CONTENT:
Subject: ${subject}
Body: ${cleanBody}
From: ${fromAddress}

REQUIRED JSON SCHEMA - Return ONLY this structure:
{
  "purchaseOrder": {
    "purchaseOrderNumber": "",
    "orderDate": "",
    "inHandsDate": "",
    "requiredShipDate": "",
    "customer": {
      "company": "",
      "customerNumber": "",
      "firstName": "",
      "lastName": "",
      "email": "",
      "address1": "",
      "address2": "",
      "city": "",
      "state": "",
      "country": "",
      "zipCode": "",
      "phone": ""
    },
    "ppaiNumber": "",
    "asiNumber": "",
    "salesPersonName": "",
    "salesPersonEmail": "",
    "vendor": {
      "name": "High Caliber Line",
      "address1": "6250 Irwindale Ave",
      "address2": "",
      "city": "Irwindale",
      "state": "California",
      "country": "United States",
      "zipCode": "91702",
      "phone": "6269694660",
      "email": ""
    },
    "shipTo": {
      "name": "",
      "company": "",
      "address1": "",
      "address2": "",
      "city": "",
      "state": "",
      "country": "",
      "zipCode": ""
    },
    "shippingMethod": "",
    "shippingCarrier": ""
  },
  "lineItems": [
    {
      "sku": "",
      "itemColor": "",
      "imprintColor": "",
      "description": "",
      "quantity": 0,
      "unitPrice": 0.00,
      "totalPrice": 0.00,
      "finalSKU": ""
    }
  ],
  "subtotals": {
    "merchandiseSubtotal": 0.00,
    "additionalChargesSubtotal": 0.00,
    "grandTotal": 0.00
  },
  "specialInstructions": "",
  "additionalNotes": []
}

---

---

### Processing Rules

**1. Vendor**  
Always use the hard-coded High Caliber Line vendor block above.  

**2. Customer vs Ship-To**  
- Customer = issuing company from the text header/body (not Ship-To, not HCL).  
- Ship-To = final delivery destination only.  

**3. SKU Normalization**  
- Strip vendor prefixes at start: \`199-\`, \`4AP-\`, \`ALLP-\`, \`AP-\`.  
- Remove suffixes not in the approved color codes list.  
- Uppercase all SKUs; trim trailing dashes/spaces.  
- If SKU missing/malformed, infer from description.  
- Use the normalized SKU when forming \`finalSKU\`.  

**4. Non-Inventory / Charge Codes (hard-coded)**  
If description matches any of these (case-insensitive, allow variations like "setup charge", "SU", "set up"), set both \`sku\` and \`finalSKU\` to the exact code:  

48RUSH, LTM, CCC, DB, DDP, DP, DS, EC, ED, EL, HT, ICC, LE,  
P, PC, PE, PMS, PP, R, SETUP, SPEC, SR, VD, VI, X  

**5. Color Codes (explicit map)**  
If not a charge code, build \`finalSKU\` from base SKU + color code.  
If no match → \`OE-MISC-CHARGE\`.  

ColorCode Map:  
{ "00": "White", "00M": "Matte White", "00S": "Shiny White", "01": "Blue", "01M": "Matte Blue", "01S": "Shiny Blue", "01T": "Transparent Blue", "02": "Red", "02S": "Solid Red", "02T": "Transparent Red", "03": "Green", "03M": "Matte Green", "04": "Orange", "04M": "Matte Orange", "05": "Purple", "06": "Black", "06M": "Matte Black", "07": "Gray", "07M": "Matte Gray", "08": "Yellow", "09": "Silver", "-10": "Navy Blue", "10M": "Matte Navy Blue", "11": "Light Blue", "12": "Pink", "12M": "Matte Pink", "13": "Brown", "14": "Maroon", "15": "Forest Green", "16": "Burgundy", "17": "Lime Green", "18": "Teal", "19": "Magenta", "20": "Tan", "21": "Khaki", "22": "Violet", "23": "Turquoise", "24": "Gold", "25": "Rose Gold", "26": "Copper", "27": "Bronze", "28": "Charcoal", "29": "Slate", "30": "Ivory", "31": "Cream", "32": "Beige" }

**6. Dates**  
- Format all as \`MM/DD/YYYY\`.  
- If orderDate missing → today's date.  
- Keep extracted values even if sequence invalid; add issue in \`additionalNotes\`.  

**7. Prices**  
- totalPrice ≈ quantity × unitPrice.  
- merchandiseSubtotal = sum of lineItem totals.  
- grandTotal = merchandiseSubtotal + additionalChargesSubtotal.  
- Flag mismatches > $0.01 in \`additionalNotes\`.  

**8. Missing Values**  
- Use \`""\` for text, leave numbers blank.  
- If critical info missing (e.g., customer name, grand total), add note in \`additionalNotes\`.`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });

      const rawResponse = response.text || "";
      console.log(`Raw Gemini response length: ${rawResponse.length} characters`);

      if (!rawResponse) {
        throw new Error("Empty response from Gemini");
      }

      // Clean the response to extract JSON
      let jsonStr = rawResponse.trim();
      
      // Remove markdown code blocks if present
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }

      const extractedData = JSON.parse(jsonStr);
      
      // Add metadata
      extractedData.engine = 'gemini';
      extractedData.extractionType = 'text';
      extractedData.processedAt = new Date().toISOString();

      console.log(`Successfully extracted PO data from email text using gemini`);
      
      return extractedData;
    } catch (error) {
      console.error('Gemini email text extraction failed:', error);
      throw error;
    }
  }

  async extractPODataFromPDF(documentBuffer: Buffer, filename: string, retryCount: number = 0): Promise<any> {
    try {
      console.log(`Processing document with Gemini: ${filename} (${documentBuffer.length} bytes)`);

      // Convert document buffer to base64 and get MIME type
      const base64Data = documentBuffer.toString('base64');
      const mimeType = this.getMimeTypeFromFilename(filename);
      console.log(`   └─ Using MIME type: ${mimeType}`);

      const prompt = `Extract purchase order data from the attached document and return ONLY a valid JSON object following this exact schema.

REQUIRED JSON SCHEMA - Return ONLY this structure:
{
  "purchaseOrder": {
    "purchaseOrderNumber": "string",
    "orderDate": "date",
    "inHandsDate": "date", 
    "requiredShipDate": "date",
    "customer": {
      "customerNumber": "string",
      "company": "string",
      "firstName": "string",
      "lastName": "string",
      "email": "string",
      "address1": "string",
      "address2": "string",
      "city": "string",
      "state": "string",
      "country": "string",
      "zipCode": "string",
      "phone": "string"
    },
    "ppaiNumber": "string",
    "asiNumber": "string",
    "salesPersonName": "string",
    "salesPersonEmail": "string",
    "contact": {
      "name": "string",
      "jobTitle": "string", 
      "email": "string",
      "phone": "string"
    },
    "vendor": {
      "name": "string",
      "address1": "string",
      "address2": "string",
      "city": "string",
      "state": "string", 
      "country": "string",
      "zipCode": "string",
      "phone": "string",
      "email": "string"
    },
    "shipTo": {
      "name": "string",
      "company": "string",
      "address1": "string",
      "address2": "string",
      "city": "string",
      "state": "string",
      "country": "string",
      "zipCode": "string"
    },
    "shippingMethod": "string",
    "shippingCarrier": "string"
  },
  "lineItems": [
    {
      "sku": "string",
      "itemColor": "string",
      "imprintColor": "string",
      "description": "string",
      "quantity": "number",
      "unitPrice": "number", 
      "totalPrice": "number",
      "finalSKU": "string"
    }
  ],
  "subtotals": {
    "merchandiseSubtotal": "number",
    "additionalChargesSubtotal": "number",
    "grandTotal": "number"
  },
  "specialInstructions": "string",
  "additionalNotes": ["string"]
}

Color Code Mapping for finalSKU:
{"00": "White", "00M": "Matte White", "00S": "Shiny White", "01": "Blue", "01M": "Matte Blue", "01S": "Shiny Blue", "01T": "Transparent Blue", "02": "Red", "02S": "Solid Red", "02T": "Transparent Red", "03": "Green", "03M": "Matte Green", "04": "Orange", "04M": "Matte Orange", "05": "Purple", "06": "Black", "06M": "Matte Black", "07": "Gray", "07M": "Matte Gray", "08": "Yellow", "09": "Silver", "10": "Navy Blue", "10M": "Matte Navy Blue", "11": "Light Blue", "12": "Pink"}

Processing Rules:
1. OCR Error Handling: Correct "1"vs"l"vs"i", "0"vs"O", "8"vs"B", "5"vs"S", "2"vs"Z", "/"vs"1", "."vs",".
2. Critical Role Identification:
   a) ALWAYS identify Vendor first: "High Caliber Line" or aliases ("CALIBRE INTERNATIONAL LLC", "HCL", "High Caliber")
   b) Customer: Main company from header/logo (NEVER from Ship To section, NEVER "High Caliber Line")
   c) Ship-To: Final delivery destination from "Ship To"/"Deliver To" section
3. Contact: Email priority: header contact → billing contact → sales rep email → empty string
4. Address: Convert state abbreviations to full names, default country to "United States"
5. SKU Processing:
   a) Setup charges: description contains "setup charge"/"SETUP"/"setup"/"SU"/"set charge"/"Setup Fee" → sku="SET UP"
   b) Extra color: description contains "extra color" → sku="EC" 
   c) Extra location: description contains "extra location" → sku="EL"
   d) Standard items: combine base SKU with color code as "SKUCODE-COLORCODE", default "OE-MISC-CHARGE"
6. Dates: MM/DD/YYYY format, ensure logical sequence
7. Price Validation: Verify calculations, flag discrepancies >$0.01 in additionalNotes
8. Required Fields: Use "" for missing text, null for missing numbers
9. Replace all null values with "". DO NOT use dummy data.`;

      const response = await this.ai.models.generateContent({
        model: "gemini-2.5-pro",
        config: {
          systemInstruction: "You are a specialized purchase order extraction expert. Extract data following the exact schema and processing rules. Return only valid JSON without markdown formatting.",
          responseMimeType: "application/json"
        },
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              {
                inlineData: {
                  data: base64Data,
                  mimeType: mimeType
                }
              }
            ]
          }
        ],
      });

      const rawJson = response.text;
      if (rawJson) {
        const result = JSON.parse(rawJson);
        // Replace any null values with empty strings as per user requirements
        const processedResult = this.replaceNullsWithEmptyStrings(result);
        
        // 🛡️ GUARDRAIL: Check if line items are empty and reprocess (max 2 attempts)
        if ((!processedResult.lineItems || processedResult.lineItems.length === 0) && retryCount < 2) {
          console.log(`⚠️  GUARDRAIL TRIGGERED: No line items extracted from ${filename} - attempting reprocessing (attempt ${retryCount + 1}/2)...`);
          return await this.reprocessDocumentForLineItems(documentBuffer, filename, retryCount + 1);
        }
        
        // If still no line items after retries, log and return
        if (!processedResult.lineItems || processedResult.lineItems.length === 0) {
          console.log(`❌ FINAL RESULT: No line items found after ${retryCount + 1} attempts for ${filename}`);
          // Add note to indicate extraction failed
          if (!processedResult.additionalNotes) processedResult.additionalNotes = [];
          processedResult.additionalNotes.push(`Line item extraction failed after ${retryCount + 1} attempts`);
        }
        
        return processedResult;
      } else {
        throw new Error("Empty response from Gemini");
      }
    } catch (error) {
      console.error('Gemini PDF extraction error:', error);
      throw new Error(`PDF data extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async extractPOData(body: string, attachmentText?: string): Promise<any> {
    try {
      const sourceText = attachmentText || body;
      
      const prompt = `Analyze the file and create the most accurate data according to this schema, outputting only a valid JSON object:

${sourceText}

JSON Schema:
{
  "purchaseOrder": {
    "purchaseOrderNumber": "string",
    "orderDate": "date",
    "inHandsDate": "date", 
    "requiredShipDate": "date",
    "customer": {
      "customerNumber": "string",
      "company": "string",
      "firstName": "string",
      "lastName": "string",
      "email": "string",
      "address1": "string",
      "address2": "string",
      "city": "string",
      "state": "string",
      "country": "string",
      "zipCode": "string",
      "phone": "string"
    },
    "ppaiNumber": "string",
    "asiNumber": "string",
    "salesPersonName": "string",
    "salesPersonEmail": "string",
    "contact": {
      "name": "string",
      "jobTitle": "string", 
      "email": "string",
      "phone": "string"
    },
    "vendor": {
      "name": "string",
      "address1": "string",
      "address2": "string",
      "city": "string",
      "state": "string", 
      "country": "string",
      "zipCode": "string",
      "phone": "string",
      "email": "string"
    },
    "shipTo": {
      "name": "string",
      "company": "string",
      "address1": "string",
      "address2": "string",
      "city": "string",
      "state": "string",
      "country": "string",
      "zipCode": "string"
    },
    "shippingMethod": "string",
    "shippingCarrier": "string"
  },
  "lineItems": [
    {
      "sku": "string",
      "itemColor": "string",
      "imprintColor": "string",
      "description": "string",
      "quantity": "number",
      "unitPrice": "number", 
      "totalPrice": "number",
      "finalSKU": "string"
    }
  ],
  "subtotals": {
    "merchandiseSubtotal": "number",
    "additionalChargesSubtotal": "number",
    "grandTotal": "number"
  },
  "specialInstructions": "string",
  "additionalNotes": ["string"]
}

Color Code Mapping for finalSKU:
{"00": "White", "00M": "Matte White", "00S": "Shiny White", "01": "Blue", "01M": "Matte Blue", "01S": "Shiny Blue", "01T": "Transparent Blue", "02": "Red", "02S": "Solid Red", "02T": "Transparent Red", "03": "Green", "03M": "Matte Green", "04": "Orange", "04M": "Matte Orange", "05": "Purple", "06": "Black", "06M": "Matte Black", "07": "Gray", "07M": "Matte Gray", "08": "Yellow", "09": "Silver", "10": "Navy Blue", "10M": "Matte Navy Blue", "11": "Light Blue", "12": "Pink"}

Processing Rules:
1. OCR Error Handling: Correct "1"vs"l"vs"i", "0"vs"O", "8"vs"B", "5"vs"S", "2"vs"Z", "/"vs"1", "."vs",".
2. Critical Role Identification:
   a) ALWAYS identify Vendor first: "High Caliber Line" or aliases ("CALIBRE INTERNATIONAL LLC", "HCL", "High Caliber")
   b) Customer: Main company from header/logo (NEVER from Ship To section, NEVER "High Caliber Line")
   c) Ship-To: Final delivery destination from "Ship To"/"Deliver To" section
3. Contact: Email priority: header contact → billing contact → sales rep email → empty string
4. Address: Convert state abbreviations to full names, default country to "United States"
5. SKU Processing:
   a) Setup charges: description contains "setup charge"/"SETUP"/"setup"/"SU"/"set charge"/"Setup Fee" → sku="SET UP"
   b) Extra color: description contains "extra color" → sku="EC" 
   c) Extra location: description contains "extra location" → sku="EL"
   d) Standard items: combine base SKU with color code as "SKUCODE-COLORCODE", default "OE-MISC-CHARGE"
6. Dates: MM/DD/YYYY format, ensure logical sequence
7. Price Validation: Verify calculations, flag discrepancies >$0.01 in additionalNotes
8. Required Fields: Use "" for missing text, null for missing numbers
9. Replace all null values with "". DO NOT use dummy data.`;

      const response = await this.ai.models.generateContent({
        model: "gemini-2.5-pro",
        config: {
          systemInstruction: "You are a specialized purchase order extraction expert. Extract data following the exact schema and processing rules. Return only valid JSON without markdown formatting.",
          responseMimeType: "application/json"
        },
        contents: prompt,
      });

      const rawJson = response.text;
      if (rawJson) {
        const result = JSON.parse(rawJson);
        // Replace any null values with empty strings as per user requirements
        return this.replaceNullsWithEmptyStrings(result);
      } else {
        throw new Error("Empty response from Gemini");
      }
    } catch (error) {
      console.error('Gemini PO extraction error:', error);
      throw new Error(`PO data extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private replaceNullsWithEmptyStrings(obj: any): any {
    if (obj === null) {
      return "";
    }
    if (Array.isArray(obj)) {
      return obj.map(item => this.replaceNullsWithEmptyStrings(item));
    }
    if (typeof obj === 'object' && obj !== null) {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.replaceNullsWithEmptyStrings(value);
      }
      return result;
    }
    return obj;
  }



  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await this.ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: "Respond with 'OK' to test the connection.",
      });

      if (response.text === 'OK') {
        return { success: true };
      }
      return { success: false, error: 'Unexpected response' };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Connection test failed' 
      };
    }
  }
}

export const geminiService = new GeminiService();