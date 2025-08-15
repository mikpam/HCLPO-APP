import { GoogleGenAI } from "@google/genai";

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