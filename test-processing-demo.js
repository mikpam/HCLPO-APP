// Demo script to show email processing status in real-time
const axios = require('axios');

const BASE_URL = 'http://localhost:5000';

async function watchProcessingStatus() {
  console.log('🔍 Watching processing status for 30 seconds...\n');
  
  const startTime = Date.now();
  const duration = 30000; // 30 seconds
  
  while (Date.now() - startTime < duration) {
    try {
      const response = await axios.get(`${BASE_URL}/api/processing/current-status`);
      const status = response.data;
      
      const timestamp = new Date().toLocaleTimeString();
      
      if (status.isProcessing) {
        console.log(`[${timestamp}] 🟢 PROCESSING: ${status.currentStep}`);
        console.log(`   └─ ${status.currentEmail}`);
        if (status.currentPO) console.log(`   └─ PO: ${status.currentPO}`);
        console.log('');
      } else if (status.currentStep === 'completed') {
        console.log(`[${timestamp}] ✅ COMPLETED: ${status.currentEmail}`);
        console.log('');
      } else {
        console.log(`[${timestamp}] ⭕ IDLE: System waiting`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
    } catch (error) {
      console.error('Error fetching status:', error.message);
    }
  }
  
  console.log('✅ Demo complete!');
}

async function triggerProcessing() {
  try {
    console.log('🚀 Triggering email processing...\n');
    const response = await axios.post(`${BASE_URL}/api/processing/process-auto`, {});
    console.log('Response:', response.data.message);
    console.log('');
  } catch (error) {
    console.error('Error triggering processing:', error.response?.data || error.message);
  }
}

// Run the demo
(async () => {
  // Start watching in parallel with triggering processing
  const watchPromise = watchProcessingStatus();
  
  // Trigger processing after 2 seconds
  setTimeout(triggerProcessing, 2000);
  
  await watchPromise;
})();