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
      
      // Microsoft Office documents
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xls': 'application/vnd.ms-excel',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      
      // Text and CSV
      'txt': 'text/plain',
      'csv': 'text/csv',
      'rtf': 'application/rtf'
    };
    
    return mimeTypes[extension || ''] || 'application/octet-stream';
  }

  async filterDocumentType(documentBuffer: Buffer, filename: string): Promise<{ document_type: "purchase order" | "not a purchase order" }> {
    try {
      console.log(`🔍 AI DOCUMENT FILTER: Analyzing ${filename} to determine if it's a purchase order`);

      // Convert document buffer to base64 and get MIME type
      const base64Data = documentBuffer.toString('base64');
      const mimeType = this.getMimeTypeFromFilename(filename);
      console.log(`   └─ Detected MIME type: ${mimeType}`);

      const prompt = `Analyze the provided document to determine its primary function: Is it a purchase order (including sample orders/requests) or something else?

**Primary Function Test:**

1. **Exclusion Check (Perform First):** Does the document's primary purpose appear to be one of the following?
   * **Artwork/Proof/Design:** Contains visual mockups, layouts, design specifications, color palettes, approval boxes, or keywords like "Proof," "Artwork," "Layout," "Design," "Mockup," "Revision," "Approve," "Approval Required," "Sample Proof." Even if quantities/prices are present for context, if the main goal is design review/approval, it's NOT a purchase order.
   * **Quotation/Proposal:** Presents prices/terms for *potential* future work, often using terms like "Quote," "Proposal," "Estimate," "Offer," "Valid Until."
   * **Invoice/Bill:** Requests payment for goods/services *already provided* or shipped, using terms like "Invoice," "Bill," "Due Date," "Amount Due."
   * **Packing List/Slip:** Details items included in a shipment, often lacking prices, using terms like "Packing List," "Delivery Note."
   * **Receipt/Statement:** Confirms payment received or summarizes account activity.
   * **Shipping Notice/ASN:** Provides information about a shipment in transit.
   * **Internal Memos/Emails/Attachments:** Discussions *about* an order, attachments to emails *containing* proofs, etc., are not the order itself.

   *If the document clearly fits any category above, classify it immediately as "not a purchase order" and stop.*

2. **Purchase Order Confirmation (Only if Exclusion Check Passed):** If the document is NOT primarily one of the excluded types, check if it contains **at least THREE (3)** distinct elements from the list below, clearly indicating a transactional intent to order or request goods/services:
   * **Explicit Order Intent:** Clear title like "Purchase Order," "PO," "Sample Order," "Order Confirmation," "Request for Sample," or equivalent explicit text stating an order is being placed/requested. (A PO Number alone counts if contextually clear it's for an order).
   * **Supplier/Vendor Information:** Identifiable Seller (company name, address, contact).
   * **Buyer Information:** Identifiable Buyer (company name, address, contact).
   * **Itemized Product Details:** Specific descriptions, SKUs, model numbers identifying *what* is being ordered. (Generic descriptions on a proof don't count).
   * **Quantities/Units:** Specific number of units requested *for the order transaction*. (Quantities shown on a design example don't count).
   * **Pricing Information:** Unit price, total price, or subtotal clearly associated with the *order transaction*. (Reference prices on a proof don't count).
   * **Order/Required Delivery Date:** An explicit date when items are requested or must be delivered (cannot be a general project timeline or event date).
   * **Payment Terms:** Specific terms like Net 30, Due on Receipt, Credit Card, etc., related to *this order*.

**Decision Rules:**

* The Exclusion Check takes priority. If it matches an excluded type (especially Art/Proof), it's "not a purchase order."
* If the Exclusion Check does not apply, **at least THREE (3)** distinct PO elements *must* be present and clearly related to an order transaction.
* Sample Orders and Requests for Samples *are* considered "purchase orders" if they meet the criteria.
* If uncertain, or if fewer than three PO elements are found after passing the exclusion check, default to "not a purchase order." Be strict.

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

      const prompt = `Analyze the data ${subject}${body}${fromAddress} and extract data according to this schema. Output the result as a valid JSON object without any markdown formatting or additional text:

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

---

**Normalization Rules for \`sku\`:**

1. Remove vendor prefixes like \`199-\`, \`4AP-\`, \`ALLP-\`, \`AP-\` from the beginning of the SKU.
2. If the SKU has a suffix (e.g., \`-O\`, \`-99\`, \`-X\`) and it is **not** in the approved color codes list, strip the suffix.
3. If a SKU is blank or malformed, try to infer it from the \`description\`.
4. Always return SKUs in uppercase, without trailing dashes or invalid tokens.

**Use the normalized \`sku\` value when forming the \`finalSKU\`.**`;

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

      const prompt = `Analyze the PDF file and create the most accurate data according to this schema, outputting only a valid JSON object:

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