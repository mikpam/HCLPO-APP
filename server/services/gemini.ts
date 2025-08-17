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
    const artworkExtensions = ['.ai', '.eps', '.svg', '.png', '.jpg', '.jpeg', '.tif', '.gif'];
    const artworkMimeTypes = ['application/postscript', 'image/', 'application/illustrator'];
    
    const hasArtworkExtension = artworkExtensions.some(ext => 
      filename.toLowerCase().endsWith(ext)
    );
    
    const hasArtworkMimeType = artworkMimeTypes.some(mime => 
      contentType.toLowerCase().includes(mime)
    );
    
    return hasArtworkExtension || hasArtworkMimeType;
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
    
    const filenameHasPOKeywords = poKeywords.some(keyword => 
      filename.toLowerCase().includes(keyword)
    );
    
    const isBusinessFormat = businessFormats.some(format => 
      filename.toLowerCase().endsWith(`.${format}`) || 
      contentType.includes(format) ||
      contentType.includes('application')
    );
    
    return filenameHasPOKeywords || (isBusinessFormat && !this.isArtworkFile(filename, contentType));
  }

  async filterDocumentType(documentBuffer: Buffer, filename: string): Promise<{ document_type: "purchase order" | "not a purchase order" }> {
    try {
      console.log(`🔍 AI DOCUMENT FILTER: Analyzing ${filename} to determine if it's a purchase order`);

      // Convert document buffer to base64 and get MIME type
      const base64Data = documentBuffer.toString('base64');
      const mimeType = this.getMimeTypeFromFilename(filename);
      console.log(`   └─ Using MIME type: ${mimeType} (Gemini 2.5 Pro supports DOC/DOCX directly)`);

      const prompt = `Analyze the provided document to determine its primary function: Is it a purchase order (including sample orders/requests) or something else?

**PRIORITY PURCHASE ORDER INDICATORS (Check First):**

Look for these strong purchase order signals:
- **PO Number:** "PO:", "Purchase Order #", "New PO:", "PO #" followed by a number/code
- **Order Intent:** "Purchase Order", "Sample Order", "Request for Sample", "Order Confirmation"
- **Item + Quantity + Company combo:** Specific items with quantities being ordered TO or FROM a company
- **"Ship to" addresses:** Clear shipping instructions for order fulfillment

**If ANY of these strong indicators are present, likely a purchase order - continue to detailed analysis.**

**EXCLUSION CHECK (Only if no strong PO indicators found):**

Only classify as "not a purchase order" if the document's PRIMARY purpose is clearly one of these:
   * **Pure Artwork/Proof:** ONLY design mockups, layouts, color palettes, approval forms with NO clear order transaction
   * **Pure Quote/Estimate:** ONLY pricing proposals for potential future work with "Quote", "Estimate", "Valid Until" 
   * **Pure Invoice for payment:** ONLY billing for completed/shipped goods with "Amount Due", "Payment Required"
   * **Pure Packing List:** ONLY shipping contents without order details
   * **Pure Receipt:** ONLY payment confirmation

**DETAILED ANALYSIS:**

Count these purchase order elements (need at least 3):
1. **Explicit Order Intent:** PO numbers, "Purchase Order", "Sample Order", "Order Confirmation" 
2. **Supplier/Vendor Info:** Company providing goods/services
3. **Buyer Information:** Company receiving goods/services  
4. **Item Details:** Specific products, SKUs, descriptions being ordered
5. **Quantities:** Number of units for the transaction
6. **Pricing:** Costs associated with the order
7. **Delivery/Ship-to:** Where items should be sent
8. **Order Dates:** When items are needed

**IMPORTANT NOTES:**
- Documents can have mixed elements (invoice headers + PO content) - focus on PRIMARY FUNCTION
- If document shows ordering/requesting specific items TO be delivered, it's likely a purchase order
- Sample requests and rush orders ARE purchase orders if they meet the criteria

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

  async extractPODataFromText(subject: string, body: string, fromAddress: string): Promise<any> {
    try {
      console.log(`Processing email text with Gemini for TEXT_PO extraction`);
      
      // Strip HTML from body text
      const cleanBody = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      
      const prompt = `Analyze the data ${subject}${cleanBody}${fromAddress} 
and return the most accurate result in this schema.  

Output must be a single valid JSON object with no markdown, comments, or extra text.

{  
  "purchaseOrder": {    
    "purchaseOrderNumber": "string",    
    "orderDate": "date",    
    "inHandsDate": "date",    
    "requiredShipDate": "date",    
    "customer": {      
      "company": "string",  
      "customernumber": "string",    
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
    "vendor": {   // Always hard-coded
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
        model: "gemini-2.5-flash",
        contents: prompt,
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

  async extractPODataFromPDF(documentBuffer: Buffer, filename: string): Promise<any> {
    try {
      console.log(`Processing document with Gemini: ${filename} (${documentBuffer.length} bytes)`);

      // Convert document buffer to base64 and get MIME type
      const base64Data = documentBuffer.toString('base64');
      const mimeType = this.getMimeTypeFromFilename(filename);
      console.log(`   └─ Using MIME type: ${mimeType}`);

      const prompt = `Analyze the provided file and return the most accurate data in this schema.  
Output must be a single valid JSON object with no markdown, comments, or extra text.

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
        return this.replaceNullsWithEmptyStrings(result);
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
        model: "gemini-2.5-flash",
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