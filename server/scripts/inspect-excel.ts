#!/usr/bin/env tsx

async function inspectExcelFile() {
  try {
    // Dynamically import XLSX to work with ES modules
    const xlsxModule = await import('xlsx');
    const XLSX = xlsxModule.default || xlsxModule;
    
    // Read the Excel file
    console.log('📖 Reading Excel file...');
    const workbook = XLSX.readFile('../attached_assets/ItemSearchResults187.xls_1755673104410.xlsx');
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    console.log(`📊 Sheet name: ${sheetName}`);
    
    // Get the range of data
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    console.log(`📏 Data range: ${worksheet['!ref']}`);
    
    // Get headers (first row)
    const headers = [];
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
      const cell = worksheet[cellAddress];
      headers.push(cell ? cell.v : null);
    }
    
    console.log('\n📋 Column headers:');
    headers.forEach((header, index) => {
      console.log(`  ${index + 1}. "${header}"`);
    });
    
    // Show first few rows of data
    console.log('\n📊 First 3 rows of data:');
    const data = XLSX.utils.sheet_to_json(worksheet, { defval: 'MISSING' });
    data.slice(0, 3).forEach((row, index) => {
      console.log(`\nRow ${index + 1}:`);
      Object.entries(row).forEach(([key, value]) => {
        console.log(`  ${key}: ${value}`);
      });
    });
    
    console.log(`\n✅ Total rows: ${data.length}`);
    
  } catch (error) {
    console.error('❌ Error inspecting file:', error);
  }
}

inspectExcelFile();