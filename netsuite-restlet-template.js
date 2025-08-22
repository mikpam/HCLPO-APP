/**
 * NetSuite RESTlet Script for HCL Purchase Order Processing
 * Deploy this script in NetSuite as a RESTlet
 * 
 * SIMPLIFIED VERSION - No customer creation needed
 * All customer information is already correct in NetSuite
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
                case 'createSalesOrder':
                    return createSalesOrder(requestBody);
                    
                case 'test':
                    return { success: true, message: 'RESTlet is working' };
                    
                default:
                    return {
                        result: {
                            code: 1,
                            message: 'Error: Action not supported. Available actions: createSalesOrder, test'
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
     * Create a sales order (simplified - no customer creation)
     * All customer information is already correct in NetSuite
     */
    function createSalesOrder(requestBody) {
        try {
            log.debug('Creating Sales Order', JSON.stringify(requestBody));
            
            // Get customer ID from request
            let customerId = requestBody.customerId;
            
            // If customer object is provided, extract ID or name
            if (!customerId && requestBody.customer) {
                customerId = requestBody.customer.id || 
                           requestBody.customer.name ||
                           requestBody.customer.email;
            }
            
            if (!customerId) {
                throw new Error('Customer ID or name is required');
            }
            
            log.audit('Using Customer', customerId);
            
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