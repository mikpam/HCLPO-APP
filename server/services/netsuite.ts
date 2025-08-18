// Updated to use TBA NLAuth headers instead of OAuth 1.0 signatures

export interface NetSuiteCustomer {
  id?: string;
  name: string;
  email: string;
  phone?: string;
  address?: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
}

export interface NetSuiteLineItem {
  item: string;
  quantity: number;
  rate?: number;
  amount?: number;
  description?: string;
}

export interface NetSuiteSalesOrder {
  customer: string | NetSuiteCustomer;
  lineItems: NetSuiteLineItem[];
  shipMethod?: string;
  shipDate?: string;
  memo?: string;
  externalId?: string;
}

export interface NetSuiteCreateResult {
  success: boolean;
  internalId?: string;
  externalId?: string;
  error?: string;
}

export class NetSuiteService {
  private accountId: string;
  private email: string;
  private password: string;
  private roleId: string;
  private applicationId: string;
  private restletUrl: string;

  constructor() {
    this.accountId = process.env.NETSUITE_ACCOUNT_ID || '';
    this.email = process.env.NETSUITE_EMAIL || '';
    this.password = process.env.NETSUITE_PASSWORD || '';
    this.roleId = process.env.NETSUITE_ROLE_ID || '';
    this.applicationId = process.env.NETSUITE_APPLICATION_ID || '';
    this.restletUrl = process.env.NETSUITE_RESTLET_URL || '';

    if (!this.accountId || !this.email || !this.password || !this.roleId || !this.applicationId || !this.restletUrl) {
      console.warn('⚠️ NetSuite TBA credentials not fully configured');
    }
  }

  private generateNLAuthHeader(otp?: string): string {
    // RFC 3986 percent encoding function
    const encodeParam = (str: string): string => {
      return encodeURIComponent(str);
    };

    const authParams = [
      `nlauth_account=${encodeParam(this.accountId)}`,
      `nlauth_email=${encodeParam(this.email)}`,
      `nlauth_signature=${encodeParam(this.password)}`,
      `nlauth_role=${encodeParam(this.roleId)}`,
      `nlauth_application_id=${encodeParam(this.applicationId)}`
    ];

    // Add OTP for 2FA if provided
    if (otp) {
      authParams.push(`nlauth_otp=${encodeParam(otp)}`);
    }

    const authHeader = 'NLAuth ' + authParams.join(',');
    
    console.log('🔐 TBA NLAuth Header Generated:');
    console.log('  Account:', this.accountId);
    console.log('  Email:', this.email);
    console.log('  Role ID:', this.roleId);
    console.log('  Application ID:', this.applicationId);
    console.log('  2FA OTP:', otp ? 'Provided' : 'Not provided');
    console.log('  Header:', authHeader);

    return authHeader;
  }

  async findOrCreateCustomer(customerData: NetSuiteCustomer): Promise<string> {
    try {
      // First try to find existing customer by email
      const searchResult = await this.makeRestletCall('GET', {
        action: 'searchCustomer',
        email: customerData.email
      });

      if (searchResult.success && searchResult.customerId) {
        return searchResult.customerId;
      }

      // Create new customer
      const createResult = await this.makeRestletCall('POST', {
        action: 'createCustomer',
        customerData
      });

      if (!createResult.success) {
        throw new Error(createResult.error || 'Failed to create customer');
      }

      return createResult.customerId;
    } catch (error) {
      console.error('Error finding/creating customer:', error);
      throw new Error(`Customer operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async createSalesOrder(orderData: NetSuiteSalesOrder, attachmentUrls?: string[]): Promise<NetSuiteCreateResult> {
    try {
      let customerId: string;

      if (typeof orderData.customer === 'string') {
        customerId = orderData.customer;
      } else {
        customerId = await this.findOrCreateCustomer(orderData.customer);
      }

      // Map shipping method with FedEx Ground as default
      const shipMethod = this.mapShippingMethod(orderData.shipMethod);

      // Process line items with SKU mapping
      const processedLineItems = await this.processLineItems(orderData.lineItems);

      const salesOrderData = {
        action: 'createSalesOrder',
        customerId,
        lineItems: processedLineItems,
        shipMethod,
        shipDate: orderData.shipDate,
        memo: orderData.memo,
        externalId: orderData.externalId,
        attachmentUrls: attachmentUrls || []  // Include object storage URLs
      };

      const result = await this.makeRestletCall('POST', salesOrderData);

      return {
        success: result.success,
        internalId: result.internalId,
        externalId: result.externalId,
        error: result.error
      };
    } catch (error) {
      console.error('Error creating sales order:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private mapShippingMethod(method?: string): string {
    if (!method) return 'FedEx Ground';

    const methodMap: Record<string, string> = {
      'fedex ground': 'FedEx Ground',
      'fedex': 'FedEx Ground',
      'ups ground': 'UPS Ground',
      'ups': 'UPS Ground',
      'usps': 'USPS',
      'dhl': 'DHL'
    };

    const normalized = method.toLowerCase();
    return methodMap[normalized] || 'FedEx Ground';
  }

  private async processLineItems(items: NetSuiteLineItem[]): Promise<NetSuiteLineItem[]> {
    const processedItems: NetSuiteLineItem[] = [];

    for (const item of items) {
      let processedItem = { ...item };

      // Try to map FinalSKU first
      if (item.item) {
        const mappedItem = await this.findItemBySKU(item.item);
        if (mappedItem) {
          processedItem.item = mappedItem;
        } else {
          // Apply fallback logic
          processedItem = this.applyFallbackMapping(processedItem);
        }
      }

      processedItems.push(processedItem);
    }

    return processedItems;
  }

  private async findItemBySKU(sku: string): Promise<string | null> {
    try {
      const result = await this.makeRestletCall('GET', {
        action: 'findItemBySKU',
        sku
      });

      return result.success ? result.itemId : null;
    } catch (error) {
      console.error('Error finding item by SKU:', error);
      return null;
    }
  }

  private applyFallbackMapping(item: NetSuiteLineItem): NetSuiteLineItem {
    // Apply business rules for fallback mapping
    if (item.quantity && item.quantity > 1) {
      // Use OE_MISC_ITEM for multiple quantities
      return {
        ...item,
        item: 'OE_MISC_ITEM'
      };
    } else {
      // Use SET UP item for single quantities or charges
      return {
        ...item,
        item: 'SET UP'
      };
    }
  }

  async attachPDFToSalesOrder(salesOrderId: string, pdfData: Buffer, filename: string): Promise<boolean> {
    try {
      const result = await this.makeRestletCall('POST', {
        action: 'attachFile',
        recordType: 'salesorder',
        recordId: salesOrderId,
        fileData: pdfData.toString('base64'),
        filename
      });

      return result.success;
    } catch (error) {
      console.error('Error attaching PDF:', error);
      return false;
    }
  }

  async testConnection(otp?: string): Promise<{ success: boolean; error?: string; details?: any }> {
    try {
      console.log('🔧 Testing NetSuite connection...');
      
      // Check if credentials are present
      if (!this.accountId || !this.email || !this.password || !this.roleId || !this.applicationId || !this.restletUrl) {
        return { 
          success: false, 
          error: 'Missing required NetSuite TBA credentials' 
        };
      }

      // Try different HTTP methods to see which RESTlet functions are configured
      const testMethods = [
        { method: 'GET', description: 'GET method (getfunction)' },
        { method: 'POST', description: 'POST method (postfunction)' }
      ];

      let lastError = '';
      
      for (const test of testMethods) {
        try {
          console.log(`🔍 Testing ${test.description}...`);
          
          // Simple test request that RESTlets commonly handle
          const testData = test.method === 'GET' ? null : {
            operation: 'test',
            timestamp: new Date().toISOString()
          };

          const result = await this.makeRestletCall(test.method, testData, otp);
          
          console.log(`✅ NetSuite connection successful with ${test.method}!`);
          return {
            success: true,
            details: {
              accountId: this.accountId,
              restletUrl: this.restletUrl,
              method: test.method,
              response: result
            }
          };
        } catch (error) {
          console.log(`❌ ${test.method} failed:`, error instanceof Error ? error.message : error);
          lastError = error instanceof Error ? error.message : 'Unknown error';
          continue;
        }
      }
      
      // If all methods failed, return the last error
      throw new Error(lastError);
    } catch (error) {
      console.error('❌ NetSuite connection test failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        details: {
          accountId: this.accountId,
          restletUrl: this.restletUrl,
          possibleIssues: [
            'RESTlet script may not have getfunction/postfunction configured',
            'TBA NLAuth credentials may be incorrect',
            'RESTlet deployment may be inactive',
            'Account/domain restrictions may be blocking access',
            'User role may not have sufficient permissions',
            'Application ID may not be properly configured'
          ]
        }
      };
    }
  }

  private async makeRestletCall(method: string, data: any, otp?: string): Promise<any> {
    try {
      const authHeader = this.generateNLAuthHeader(otp);
      
      const fetchOptions: RequestInit = {
        method: method,
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      };

      // Only add body for methods that support it
      if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
        fetchOptions.body = JSON.stringify(data);
      }

      const response = await fetch(this.restletUrl, fetchOptions);

      const responseText = await response.text();
      console.log(`📊 NetSuite Response [${response.status}]:`, responseText);

      if (!response.ok) {
        // Check if it's a 2FA error
        if (response.status === 401 && responseText.includes('TWO_FA_REQD')) {
          throw new Error('TWO_FA_REQUIRED');
        }
        throw new Error(`NetSuite TBA API error: ${response.status} ${response.statusText} - ${responseText}`);
      }

      try {
        return JSON.parse(responseText);
      } catch (parseError) {
        // If response is not JSON, return the text
        return { text: responseText };
      }
    } catch (error) {
      console.error('NetSuite TBA RESTlet call failed:', error);
      throw error;
    }
  }

  async testCompleteIntegration(payload: any, otp?: string): Promise<{ success: boolean; message: string; details?: any; error?: string }> {
    try {
      console.log('🔧 Testing complete NetSuite integration...');
      console.log('📊 Testing with payload:', {
        poNumber: payload.metadata?.poNumber,
        customerNumber: payload.extractedData?.purchaseOrder?.customer?.customerNumber,
        lineItems: payload.extractedData?.lineItems?.length || 0,
        filesIncluded: !!(payload.files?.originalEmail || payload.files?.attachments?.length)
      });

      // Test both GET and POST methods with complete payload
      const tests = [
        { method: 'GET', name: 'getfunction' },
        { method: 'POST', name: 'postfunction' }
      ];

      for (const test of tests) {
        console.log(`🔍 Testing ${test.method} method (${test.name})...`);
        
        try {
          const result = await this.makeRestletCall(test.method, payload, otp);
          
          console.log(`✅ Complete integration test successful with ${test.method}!`);
          return {
            success: true,
            message: `Complete NetSuite integration test successful with ${test.method}`,
            details: {
              method: test.method,
              payload: payload.metadata,
              response: result,
              timestamp: new Date().toISOString()
            }
          };
        } catch (error) {
          console.error(`❌ ${test.method} failed:`, error instanceof Error ? error.message : error);
          if (error instanceof Error && error.message === 'TWO_FA_REQUIRED') {
            return {
              success: false,
              error: 'TWO_FA_REQUIRED',
              message: 'Two-Factor Authentication required. Please provide OTP.'
            };
          }
        }
      }

      return {
        success: false,
        error: 'ALL_METHODS_FAILED',
        message: 'All test methods failed'
      };
      
    } catch (error) {
      console.error('Complete integration test error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Complete integration test failed'
      };
    }
  }

  async testObjectStorageIntegration(attachmentUrls: string[]): Promise<{ success: boolean; error?: string; details?: any }> {
    try {
      console.log('🔧 Testing NetSuite with object storage URLs...');
      console.log('📎 Attachment URLs:', attachmentUrls);
      
      const testData = {
        operation: 'testWithAttachments',
        timestamp: new Date().toISOString(),
        attachmentUrls: attachmentUrls,
        message: 'Test request with object storage URLs'
      };

      const result = await this.makeRestletCall('POST', testData);
      
      console.log('✅ NetSuite object storage integration test successful!');
      return {
        success: true,
        details: {
          accountId: this.accountId,
          restletUrl: this.restletUrl,
          attachmentUrls: attachmentUrls,
          response: result
        }
      };
    } catch (error) {
      console.error('❌ NetSuite object storage integration test failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        details: {
          accountId: this.accountId,
          restletUrl: this.restletUrl,
          attachmentUrls: attachmentUrls
        }
      };
    }
  }

  async testCompleteOrderIntegration(orderData: any, attachmentUrls: string[]): Promise<{ success: boolean; error?: string; details?: any }> {
    try {
      console.log('🔧 Testing NetSuite with complete order data and object storage URLs...');
      console.log('📋 Order Data:', JSON.stringify(orderData, null, 2));
      console.log('📎 Attachment URLs:', attachmentUrls);
      
      const testData = {
        operation: 'createOrderWithAttachments',
        timestamp: new Date().toISOString(),
        orderData: orderData,
        attachmentUrls: attachmentUrls,
        message: 'Complete order test with extracted data and file URLs'
      };

      const result = await this.makeRestletCall('POST', testData);
      
      console.log('✅ NetSuite complete order integration test successful!');
      return {
        success: true,
        details: {
          accountId: this.accountId,
          restletUrl: this.restletUrl,
          orderData: orderData,
          attachmentUrls: attachmentUrls,
          response: result
        }
      };
    } catch (error) {
      console.error('❌ NetSuite complete order integration test failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        details: {
          accountId: this.accountId,
          restletUrl: this.restletUrl,
          orderData: orderData,
          attachmentUrls: attachmentUrls
        }
      };
    }
  }
}

export const netsuiteService = new NetSuiteService();
