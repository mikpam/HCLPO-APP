import { openaiService, type EmailClassificationInput, type ClassificationResult } from './openai.js';
import { geminiService } from './gemini.js';

export type AIEngine = 'openai' | 'gemini';
export type { EmailClassificationInput, ClassificationResult };

class AIServiceManager {
  private classificationEngine: AIEngine = 'openai'; // Default to OpenAI for classification
  private extractionEngine: AIEngine = 'openai'; // Default to OpenAI for text extraction  
  private attachmentEngine: AIEngine = 'gemini'; // Use Gemini 2.5 Pro for attachments
  private fallbackEngine: AIEngine = 'gemini';

  setEngine(engine: AIEngine) {
    this.classificationEngine = engine;
    this.extractionEngine = engine;
    this.fallbackEngine = engine === 'openai' ? 'gemini' : 'openai';
  }

  setAttachmentEngine(engine: AIEngine) {
    this.attachmentEngine = engine;
  }

  getCurrentEngine(): AIEngine {
    return this.classificationEngine;
  }

  getAttachmentEngine(): AIEngine {
    return this.attachmentEngine;
  }

  private getService(engine: AIEngine) {
    return engine === 'openai' ? openaiService : geminiService;
  }

  async processEmail(input: EmailClassificationInput): Promise<{
    preprocessing: { response: string; score: string; shouldProceed: boolean };
    classification?: ClassificationResult & { engine: AIEngine };
  }> {
    // Step 1: Pre-processing - Simple intent classification
    const preprocessing = await openaiService.preProcessEmail(input);
    
    // Step 2: Only proceed with detailed classification for Purchase Order, Sample Request, Rush Order
    if (!preprocessing.shouldProceed) {
      console.log(`Email classified as "${preprocessing.response}" - skipping detailed analysis`);
      return { preprocessing };
    }
    
    // Step 2: Detailed classification for qualified emails
    try {
      const classification = await openaiService.classifyEmail(input);
      return {
        preprocessing,
        classification: { ...classification, engine: 'openai' as AIEngine }
      };
    } catch (error) {
      console.error('OpenAI detailed classification failed:', error);
      
      // Fallback classification
      return {
        preprocessing,
        classification: {
          analysis_flags: {
            has_attachments: input.attachments.length > 0,
            attachments_all_artwork_files: false,
            po_details_in_body_sufficient: false,
            is_sample_request_in_body: false,
            overall_po_nature_probability: "low",
            confidence_score: 0.1
          },
          recommended_route: input.attachments.length > 0 ? 'ATTACHMENT_PO' : 'REVIEW',
          suggested_tags: ['OpenAI Service Unavailable'],
          engine: 'openai' as AIEngine
        }
      };
    }
  }

  // Add preProcessEmail method for backward compatibility
  async preProcessEmail(input: EmailClassificationInput): Promise<{ response: string; score: string; shouldProceed: boolean; classification?: string }> {
    return await openaiService.preProcessEmail(input);
  }

  // Kept for backward compatibility
  async classifyEmail(input: EmailClassificationInput): Promise<ClassificationResult & { engine: AIEngine }> {
    const result = await this.processEmail(input);
    return result.classification || {
      analysis_flags: {
        has_attachments: input.attachments.length > 0,
        attachments_all_artwork_files: false,
        po_details_in_body_sufficient: false,
        is_sample_request_in_body: false,
        overall_po_nature_probability: "low",
        confidence_score: 0.1
      },
      recommended_route: 'REVIEW',
      suggested_tags: [`Filtered out: ${result.preprocessing.response}`],
      engine: 'openai' as AIEngine
    };
  }

  async extractPOData(body: string, attachmentText?: string): Promise<any & { engine: AIEngine }> {
    // Use Gemini 2.5 Pro specifically for PDF attachment extraction
    const engine = attachmentText ? this.attachmentEngine : this.extractionEngine;
    
    try {
      const service = this.getService(engine);
      const result = await service.extractPOData(body, attachmentText);
      console.log(`Successfully extracted PO data using ${engine}${attachmentText ? ' (PDF attachment)' : ' (email body)'}`);
      return { ...result, engine };
    } catch (error) {
      console.error(`${engine} extraction failed, trying fallback:`, error);
      
      try {
        const fallbackService = this.getService(this.fallbackEngine);
        const result = await fallbackService.extractPOData(body, attachmentText);
        return { ...result, engine: this.fallbackEngine };
      } catch (fallbackError) {
        console.error(`Both AI engines failed for PO extraction:`, fallbackError);
        throw new Error(`All AI engines failed: ${fallbackError}`);
      }
    }
  }

  async extractPODataFromPDF(pdfBuffer: Buffer, filename: string): Promise<any & { engine: AIEngine }> {
    // Use Gemini 2.5 Pro specifically for PDF attachment extraction
    const engine = this.attachmentEngine;
    
    try {
      const service = this.getService(engine);
      if (engine === 'gemini' && 'extractPODataFromPDF' in service) {
        const result = await service.extractPODataFromPDF(pdfBuffer, filename);
        console.log(`Successfully extracted PO data from PDF using ${engine}: ${filename}`);
        return { ...result, engine };
      } else {
        throw new Error(`${engine} engine does not support direct PDF processing`);
      }
    } catch (error) {
      console.error(`${engine} PDF extraction failed:`, error);
      
      // For PDF extraction, only Gemini supports direct processing
      // If it fails, we can't fallback effectively since we need the PDF parsing capability
      throw new Error(`PDF extraction failed with ${engine}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async extractPODataFromText(subject: string, body: string, fromAddress: string): Promise<any & { engine: AIEngine }> {
    // Use Gemini specifically for TEXT_PO extraction from email content
    const engine = 'gemini';
    
    try {
      const service = this.getService(engine);
      if (engine === 'gemini' && 'extractPODataFromText' in service) {
        const result = await service.extractPODataFromText(subject, body, fromAddress);
        console.log(`Successfully extracted PO data from email text using ${engine}`);
        return { ...result, engine };
      } else {
        throw new Error(`${engine} engine does not support text extraction`);
      }
    } catch (error) {
      console.error(`${engine} text extraction failed:`, error);
      throw new Error(`Text extraction failed with ${engine}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // PDF analysis is handled via extractPOData with attachmentText
  async analyzePDFContent(pdfText: string): Promise<any & { engine: AIEngine }> {
    return this.extractPOData("", pdfText);
  }

  // Document type filtering - determines if a document is a purchase order
  async filterDocumentType(documentBuffer: Buffer, filename: string): Promise<{ document_type: string; confidence: number; reason: string }> {
    // Use OpenAI for document classification/filtering
    const engine = 'openai';
    
    try {
      const service = this.getService(engine);
      
      // Use OpenAI's analyzeAttachmentContent method for document filtering
      if ('analyzeAttachmentContent' in service) {
        const analysis = await service.analyzeAttachmentContent(filename, 'application/pdf');
        
        // Map the response to the expected format
        const document_type = analysis.isPurchaseOrder ? 'purchase order' : 
                            analysis.isArtwork ? 'artwork' : 'other';
        
        return {
          document_type,
          confidence: analysis.confidence,
          reason: analysis.reason
        };
      } else {
        throw new Error(`${engine} engine does not support attachment analysis`);
      }
    } catch (error) {
      console.error(`${engine} document filtering failed:`, error);
      
      // Fallback: basic filename analysis
      const filename_lower = filename.toLowerCase();
      const isPO = filename_lower.includes('purchaseorder') || 
                  filename_lower.includes('purchase_order') || 
                  filename_lower.includes('purchase order') ||
                  filename_lower.includes('po ') ||
                  /\bpo\b/.test(filename_lower);
      
      return {
        document_type: isPO ? 'purchase order' : 'other',
        confidence: 0.7,
        reason: `Filename-based classification: ${filename}`
      };
    }
  }

  async testConnections(): Promise<{
    openai: { success: boolean; error?: string };
    gemini: { success: boolean; error?: string };
    current: AIEngine;
  }> {
    const [openaiResult, geminiResult] = await Promise.all([
      openaiService.testConnection(),
      geminiService.testConnection()
    ]);

    return {
      openai: openaiResult,
      gemini: geminiResult,
      current: this.getCurrentEngine()
    };
  }

  // Multi-attachment screening - delegate to Gemini service
  async screenAttachmentsForPurchaseOrder(attachments: any[]): Promise<any> {
    try {
      const service = this.getService('gemini');
      if ('screenAttachmentsForPurchaseOrder' in service) {
        return await service.screenAttachmentsForPurchaseOrder(attachments);
      } else {
        throw new Error('Gemini service does not support attachment screening');
      }
    } catch (error) {
      console.error('Attachment screening failed:', error);
      throw new Error(`Attachment screening failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  getAvailableEngines(): { engine: AIEngine; available: boolean }[] {
    return [
      { 
        engine: 'openai', 
        available: !!process.env.OPENAI_API_KEY 
      },
      { 
        engine: 'gemini', 
        available: !!process.env.GEMINI_API_KEY 
      }
    ];
  }

  getEngineConfiguration() {
    return {
      classification: this.classificationEngine,
      extraction: this.extractionEngine,
      attachment: this.attachmentEngine,
      fallback: this.fallbackEngine,
      available: this.getAvailableEngines()
    };
  }
}

export const aiService = new AIServiceManager();
export { AIServiceManager };