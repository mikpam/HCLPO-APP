/**
 * NetSuite RESTlet Script for HCL Purchase Order Processing
 * Deploy this script in NetSuite as a RESTlet
 * 
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */

define(['N/record', 'N/search', 'N/log'], function(record, search, log) {
    
    /**
     * POST endpoint handler
     * @param {Object} requestBody - The JSON payload from your application
     */
    function doPost(requestBody) {
        try {
            log.debug('RESTlet Request', JSON.stringify(requestBody));
            
            const action = requestBody.action;
            
            switch(action) {
                case 'findCustomer':
                    return findCustomer(requestBody);
                    
                case 'createCustomer':
                    return createCustomer(requestBody);
                    
                case 'createSalesOrder':
                    return createSalesOrder(requestBody);
                    
                case 'test':
                    return { success: true, message: 'RESTlet is working' };
                    
                default:
                    return {
                        result: {
                            code: 1,
                            message: 'Error: Action not supported. Available actions: findCustomer, createCustomer, createSalesOrder, test'
                        }
                    };
            }
        } catch (e) {
            log.error('RESTlet Error', e.toString());
            return {
                result: {
                    code: 2,
                    message: 'Error: ' + e.toString()
                }
            };
        }
    }
    
    /**
     * Find customer by email, name, or NetSuite ID
     */
    function findCustomer(requestBody) {
        try {
            const customerData = requestBody.customer || requestBody;
            
            // Search by email first
            if (customerData.email) {
                const customerSearch = search.create({
                    type: search.Type.CUSTOMER,
                    filters: [
                        ['email', 'is', customerData.email]
                    ],
                    columns: ['internalid', 'entityid', 'companyname', 'email']
                });
                
                const searchResults = customerSearch.run().getRange(0, 1);
                if (searchResults.length > 0) {
                    return {
                        success: true,
                        customerId: searchResults[0].getValue('internalid'),
                        customerName: searchResults[0].getValue('companyname'),
                        email: searchResults[0].getValue('email')
                    };
                }
            }
            
            // Search by company name
            if (customerData.company) {
                const customerSearch = search.create({
                    type: search.Type.CUSTOMER,
                    filters: [
                        ['companyname', 'contains', customerData.company]
                    ],
                    columns: ['internalid', 'entityid', 'companyname', 'email']
                });
                
                const searchResults = customerSearch.run().getRange(0, 1);
                if (searchResults.length > 0) {
                    return {
                        success: true,
                        customerId: searchResults[0].getValue('internalid'),
                        customerName: searchResults[0].getValue('companyname'),
                        email: searchResults[0].getValue('email')
                    };
                }
            }
            
            return {
                success: false,
                message: 'Customer not found'
            };
            
        } catch (e) {
            log.error('Find Customer Error', e.toString());
            throw e;
        }
    }
    
    /**
     * Create a new customer
     */
    function createCustomer(requestBody) {
        try {
            const customerData = requestBody.customer || requestBody;
            
            // Create customer record
            const customer = record.create({
                type: record.Type.CUSTOMER,
                isDynamic: true
            });
            
            // Set required fields
            if (customerData.company) {
                customer.setValue('companyname', customerData.company);
            }
            
            if (customerData.email) {
                customer.setValue('email', customerData.email);
            }
            
            if (customerData.phone) {
                customer.setValue('phone', customerData.phone);
            }
            
            // Set address if provided
            if (customerData.address) {
                customer.selectNewLine({ sublistId: 'addressbook' });
                
                const addressSubrecord = customer.getCurrentSublistSubrecord({
                    sublistId: 'addressbook',
                    fieldId: 'addressbookaddress'
                });
                
                if (customerData.address.address1) {
                    addressSubrecord.setValue('addr1', customerData.address.address1);
                }
                if (customerData.address.city) {
                    addressSubrecord.setValue('city', customerData.address.city);
                }
                if (customerData.address.state) {
                    addressSubrecord.setValue('state', customerData.address.state);
                }
                if (customerData.address.zipCode) {
                    addressSubrecord.setValue('zip', customerData.address.zipCode);
                }
                
                customer.commitLine({ sublistId: 'addressbook' });
            }
            
            // Save the customer
            const customerId = customer.save();
            
            return {
                success: true,
                customerId: customerId,
                message: 'Customer created successfully'
            };
            
        } catch (e) {
            log.error('Create Customer Error', e.toString());
            throw e;
        }
    }
    
    /**
     * Create a sales order
     */
    function createSalesOrder(requestBody) {
        try {
            log.debug('Creating Sales Order', JSON.stringify(requestBody));
            
            // Get or create customer
            let customerId = requestBody.customerId;
            
            if (!customerId && requestBody.customer) {
                // Try to find existing customer
                const findResult = findCustomer(requestBody);
                if (findResult.success) {
                    customerId = findResult.customerId;
                } else {
                    // Create new customer
                    const createResult = createCustomer(requestBody);
                    customerId = createResult.customerId;
                }
            }
            
            if (!customerId) {
                throw new Error('Customer ID is required');
            }
            
            // Create sales order
            const salesOrder = record.create({
                type: record.Type.SALES_ORDER,
                isDynamic: true
            });
            
            // Set customer
            salesOrder.setValue('entity', customerId);
            
            // Set external ID (PO Number)
            if (requestBody.externalId) {
                salesOrder.setValue('externalid', requestBody.externalId);
                salesOrder.setValue('otherrefnum', requestBody.externalId); // PO Number field
            }
            
            // Set memo
            if (requestBody.memo) {
                salesOrder.setValue('memo', requestBody.memo);
            }
            
            // Add line items
            if (requestBody.lineItems && requestBody.lineItems.length > 0) {
                for (let i = 0; i < requestBody.lineItems.length; i++) {
                    const lineItem = requestBody.lineItems[i];
                    
                    salesOrder.selectNewLine({ sublistId: 'item' });
                    
                    // You'll need to map SKU to NetSuite item internal ID
                    // This is a simplified example - you'll need actual item lookup
                    if (lineItem.itemId) {
                        salesOrder.setCurrentSublistValue({
                            sublistId: 'item',
                            fieldId: 'item',
                            value: lineItem.itemId
                        });
                    }
                    
                    // Set quantity
                    if (lineItem.quantity) {
                        salesOrder.setCurrentSublistValue({
                            sublistId: 'item',
                            fieldId: 'quantity',
                            value: lineItem.quantity
                        });
                    }
                    
                    // Set rate (unit price)
                    if (lineItem.rate) {
                        salesOrder.setCurrentSublistValue({
                            sublistId: 'item',
                            fieldId: 'rate',
                            value: lineItem.rate
                        });
                    }
                    
                    // Set description
                    if (lineItem.description) {
                        salesOrder.setCurrentSublistValue({
                            sublistId: 'item',
                            fieldId: 'description',
                            value: lineItem.description
                        });
                    }
                    
                    salesOrder.commitLine({ sublistId: 'item' });
                }
            }
            
            // Save the sales order
            const salesOrderId = salesOrder.save();
            
            log.audit('Sales Order Created', 'ID: ' + salesOrderId);
            
            return {
                success: true,
                internalId: salesOrderId,
                externalId: requestBody.externalId,
                message: 'Sales order created successfully'
            };
            
        } catch (e) {
            log.error('Create Sales Order Error', e.toString());
            return {
                success: false,
                error: e.toString()
            };
        }
    }
    
    return {
        post: doPost
    };
});