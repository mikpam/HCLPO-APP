import crypto from 'crypto';

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
  private consumerKey: string;
  private consumerSecret: string;
  private tokenId: string;
  private tokenSecret: string;
  private restletUrl: string;

  constructor() {
    this.accountId = process.env.NETSUITE_ACCOUNT_ID || '';
    this.consumerKey = process.env.NETSUITE_CONSUMER_KEY || '';
    this.consumerSecret = process.env.NETSUITE_CONSUMER_SECRET || '';
    this.tokenId = process.env.NETSUITE_TOKEN_ID || '';
    this.tokenSecret = process.env.NETSUITE_TOKEN_SECRET || '';
    this.restletUrl = process.env.NETSUITE_RESTLET_URL || '';
  }

  private generateOAuthHeader(method: string, url: string): string {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

    const oauthParameters = {
      oauth_consumer_key: this.consumerKey,
      oauth_nonce: nonce,
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: timestamp,
      oauth_token: this.tokenId,
      oauth_version: '1.0'
    };

    // Parse URL to extract query parameters (required for OAuth 1.0 signature)
    const urlObj = new URL(url);
    const baseUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
    
    // Combine OAuth parameters with URL query parameters
    const allParameters: Record<string, string> = { ...oauthParameters };
    
    // Add URL query parameters to signature parameters
    urlObj.searchParams.forEach((value, key) => {
      allParameters[key] = value;
    });

    // Create parameter string for signature (all parameters sorted)
    const sortedParams = Object.entries(allParameters)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .sort()
      .join('&');
    
    const baseString = `${method.toUpperCase()}&${encodeURIComponent(baseUrl)}&${encodeURIComponent(sortedParams)}`;
    
    console.log('🔐 OAuth Debug - Detailed Breakdown:');
    console.log('  Method:', method.toUpperCase());
    console.log('  Base URL:', baseUrl);
    console.log('  All Parameters:', allParameters);
    console.log('  Sorted Params String:', sortedParams);
    console.log('  Base String:', baseString);

    // Generate proper HMAC-SHA1 signature for OAuth 1.0
    const signingKey = `${encodeURIComponent(this.consumerSecret)}&${encodeURIComponent(this.tokenSecret)}`;
    const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
    
    console.log('  Consumer Secret (first 8 chars):', this.consumerSecret.substring(0, 8) + '...');
    console.log('  Token Secret (first 8 chars):', this.tokenSecret.substring(0, 8) + '...');
    console.log('  Signing Key Length:', signingKey.length);
    console.log('  Raw Signature:', signature);
    console.log('  Encoded Signature:', encodeURIComponent(signature));

    // Create authorization header (NetSuite format) - only include OAuth parameters
    const authParams = {
      ...oauthParameters,
      oauth_signature: signature
    };

    const authHeader = 'OAuth ' + Object.entries(authParams)
      .map(([key, value]) => `${key}="${encodeURIComponent(value)}"`)
      .join(', ');
    
    console.log('  Auth Header:', authHeader);

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

  async createSalesOrder(orderData: NetSuiteSalesOrder): Promise<NetSuiteCreateResult> {
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
        externalId: orderData.externalId
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

  async testConnection(): Promise<{ success: boolean; error?: string; details?: any }> {
    try {
      console.log('🔧 Testing NetSuite connection...');
      
      // Check if credentials are present
      if (!this.accountId || !this.consumerKey || !this.consumerSecret || !this.tokenId || !this.tokenSecret || !this.restletUrl) {
        return { 
          success: false, 
          error: 'Missing required NetSuite credentials' 
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

          const result = await this.makeRestletCall(test.method, testData);
          
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
            'OAuth credentials may be incorrect',
            'RESTlet deployment may be inactive',
            'Account/domain restrictions may be blocking access'
          ]
        }
      };
    }
  }

  private async makeRestletCall(method: string, data: any): Promise<any> {
    try {
      const authHeader = this.generateOAuthHeader(method, this.restletUrl);
      
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
        throw new Error(`NetSuite API error: ${response.status} ${response.statusText} - ${responseText}`);
      }

      try {
        return JSON.parse(responseText);
      } catch (parseError) {
        // If response is not JSON, return the text
        return { text: responseText };
      }
    } catch (error) {
      console.error('NetSuite RESTlet call failed:', error);
      throw error;
    }
  }
}

export const netsuiteService = new NetSuiteService();
