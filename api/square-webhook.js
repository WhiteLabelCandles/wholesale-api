// Vercel Serverless Function - Square Invoice Creation
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept')
  res.setHeader('Access-Control-Max-Age', '86400')
  
  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }
  
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const { action, orderData, customerInfo } = req.body

  if (!action || !orderData || !customerInfo) {
    return res.status(400).json({ success: false, error: 'Missing required data' })
  }

  // Square Configuration - UPDATE WITH YOUR PRODUCTION CREDENTIALS
  const SQUARE_ACCESS_TOKEN = 'YOUR_PRODUCTION_ACCESS_TOKEN'
  const SQUARE_LOCATION_ID = 'YOUR_PRODUCTION_LOCATION_ID'
  const SQUARE_ENVIRONMENT = 'production'
  
  const baseUrl = SQUARE_ENVIRONMENT === 'sandbox' 
    ? 'https://connect.squareupsandbox.com' 
    : 'https://connect.squareup.com'

  try {
    // 1. Get or Create Customer
    let customerId = null
    
    const searchResponse = await fetch(`${baseUrl}/v2/customers/search`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'Square-Version': '2024-12-18'
      },
      body: JSON.stringify({
        query: {
          filter: {
            email_address: {
              exact: customerInfo.email
            }
          }
        }
      })
    })

    if (searchResponse.ok) {
      const searchResult = await searchResponse.json()
      if (searchResult.customers && searchResult.customers.length > 0) {
        customerId = searchResult.customers[0].id
      }
    }

    // Create customer if not found
    if (!customerId) {
      const createResponse = await fetch(`${baseUrl}/v2/customers`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
          'Square-Version': '2024-12-18'
        },
        body: JSON.stringify({
          given_name: customerInfo.contactName,
          company_name: customerInfo.companyName,
          email_address: customerInfo.email,
          phone_number: customerInfo.phone || null
        })
      })

      if (createResponse.ok) {
        const createResult = await createResponse.json()
        customerId = createResult.customer.id
      } else {
        const errorText = await createResponse.text()
        throw new Error('Failed to create customer: ' + errorText)
      }
    }

    // 2. Create Invoice
    const lineItems = orderData.items.map((item, index) => ({
      uid: `item-${index}-${Date.now()}`,
      name: `${item.product.charAt(0).toUpperCase() + item.product.slice(1)} - ${item.fragrance} (${item.size})`,
      quantity: String(item.quantity),
      item_type: 'ITEM',
      base_price_money: {
        amount: Math.round(item.unitPrice * 100),
        currency: 'GBP'
      }
    }))

    // Calculate due date (14 days from now)
    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + 14)
    const dueDateString = dueDate.toISOString().split('T')[0]

    // Determine invoice title based on action type
    const invoiceTitle = action === 'quote' 
      ? `Wholesale Quote - ${orderData.id}` 
      : `Wholesale Order - ${orderData.id}`

    const invoiceDescription = `Thank you for your wholesale ${action === 'quote' ? 'quote request' : 'order'}.

Company: ${customerInfo.companyName}
Contact: ${customerInfo.contactName}
Reference: ${orderData.id}

Please review the items below and proceed with payment when ready.`

    // Create invoice payload
    const invoicePayload = {
      idempotency_key: `inv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      invoice: {
        location_id: SQUARE_LOCATION_ID,
        customer_id: customerId,
        order: {
          location_id: SQUARE_LOCATION_ID,
          customer_id: customerId,
          line_items: lineItems
        },
        primary_recipient: {
          customer_id: customerId
        },
        payment_requests: [
          {
            request_type: 'BALANCE',
            due_date: dueDateString,
            automatic_payment_source: 'NONE'
          }
        ],
        delivery_method: 'EMAIL',
        invoice_number: orderData.id,
        title: invoiceTitle,
        description: invoiceDescription,
        scheduled_at: new Date().toISOString(),
        accepted_payment_methods: {
          card: true,
          square_gift_card: false,
          bank_account: false,
          buy_now_pay_later: false,
          cash_app_pay: false
        },
        custom_fields: [
          {
            label: 'Order Type',
            value: action === 'quote' ? 'Quote' : 'Order'
          }
        ]
      }
    }

    // Create the invoice
    const invoiceResponse = await fetch(`${baseUrl}/v2/invoices`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'Square-Version': '2024-12-18'
      },
      body: JSON.stringify(invoicePayload)
    })

    if (!invoiceResponse.ok) {
      const errorData = await invoiceResponse.json()
      throw new Error(`Square Invoice API error: ${JSON.stringify(errorData)}`)
    }

    const invoiceResult = await invoiceResponse.json()
    const invoiceId = invoiceResult.invoice.id
    const invoiceVersion = invoiceResult.invoice.version

    // 3. Publish the invoice (this triggers Square to send the email)
    const publishResponse = await fetch(`${baseUrl}/v2/invoices/${invoiceId}/publish`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'Square-Version': '2024-12-18'
      },
      body: JSON.stringify({
        version: invoiceVersion,
        idempotency_key: `pub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      })
    })

    if (!publishResponse.ok) {
      const errorData = await publishResponse.json()
      console.error('Failed to publish invoice:', errorData)
      // Don't throw - invoice was created, just not published
    } else {
      console.log('Invoice published successfully')
    }

    console.log('===== INVOICE CREATED =====')
    console.log('Invoice ID:', invoiceId)
    console.log('Customer:', customerInfo.companyName)
    console.log('Email:', customerInfo.email)
    console.log('Total: £' + orderData.total.toFixed(2))
    console.log('Square will email customer')
    console.log('==========================')

    return res.status(200).json({
      success: true,
      invoiceId: invoiceId,
      customerId: customerId,
      message: action === 'quote' 
        ? 'Quote invoice created! Square will email the customer shortly.' 
        : 'Order invoice created! Square will email the customer with payment link.'
    })

  } catch (error) {
    console.error('Error:', error)
    return res.status(500).json({
      success: false,
      error: error.message
    })
  }
}
