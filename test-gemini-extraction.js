import { GeminiService } from './server/services/gemini.js';
import fs from 'fs';

async function testGeminiExtraction() {
  try {
    console.log('🧠 Testing Gemini extraction with Gorilla Marketing PDF...');
    
    const geminiService = new GeminiService();
    const pdfBuffer = fs.readFileSync('./attached_assets/PurchaseOrder_111222-1_1755413853800.pdf');
    
    console.log(`📄 PDF size: ${pdfBuffer.length} bytes`);
    
    const result = await geminiService.extractPODataFromPDF(pdfBuffer, 'PurchaseOrder_111222-1.pdf');
    
    console.log('\n📋 EXTRACTION RESULT:');
    console.log('=====================================');
    console.log(JSON.stringify(result, null, 2));
    
    console.log('\n🔍 KEY FIELDS CHECK:');
    console.log('PO Number:', result?.purchaseOrder?.purchaseOrderNumber);
    console.log('Customer:', result?.purchaseOrder?.customer?.company);
    console.log('Line Items Count:', result?.lineItems?.length);
    console.log('Line Items:', result?.lineItems?.map(item => ({
      sku: item.sku,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice
    })));
    
  } catch (error) {
    console.error('❌ Gemini extraction failed:', error);
  }
}

testGeminiExtraction();