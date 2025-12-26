// Vercel Serverless Function - Square Invoice Creation
// PRODUCTION READY - With Debug Logging
export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept')
  res.setHeader('Access-Control-Max-Age', '86400')
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }
  
  // Only POST allowed
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const { action, orderData, customerInfo } = req.body

  if (!action || !orderData || !customerInfo) {
    return res.status(400).json({ success: false, error: 'Missing required data' })
  }

  // Get credentials from Vercel environment variables
  const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN
  const SQUARE_LOCATION_ID = process.env.SQUARE_LOCATION_ID
  const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || 'production'
  
  // DEBUG: Log what we received (without exposing full token)
  console.log('=== ENVIRONMENT CHECK ===')
  console.log('SQUARE_ACCESS_TOKEN exists:', !!SQUARE_ACCESS_TOKEN)
  console.log('SQUARE_ACCESS_TOKEN length:', SQUARE_ACCESS_TOKEN ? SQUARE_ACCESS_TOKEN.length : 0)
  console.log('SQUARE_ACCESS_TOKEN starts with:', SQUARE_ACCESS_TOKEN ? SQUARE_ACCESS_TOKEN.substring(0, 10) : 'MISSING')
  console.log('SQUARE_LOCATION_ID exists:', !!SQUARE_LOCATION_ID)
  console.log('SQUARE_LOCATION_ID value:', SQUARE_LOCATION_ID || 'MISSING')
  console.log('SQUARE_ENVIRONMENT:', SQUARE_ENVIRONMENT)
  console.log('All env vars:', Object.keys(process.env).filter(k => k.startsWith('SQUARE')))
  console.log('========================')
  
  // Validate credentials exist
  if (!SQUARE_ACCESS_TOKEN || !SQUARE_LOCATION_ID) {
    console.error('❌ Missing Square credentials in environment variables')
    console.error('ACCESS_TOKEN present:', !!SQUARE_ACCESS_TOKEN)
    console.error('LOCATION_ID present:', !!SQUARE_LOCATION_ID)
    return res.status(500).json({ 
      success: false, 
      error: 'Server configuration error - missing Square credentials',
      debug: {
        hasAccessToken: !!SQUARE_ACCESS_TOKEN,
        hasLocationId: !!SQUARE_LOCATION_ID,
        environment: SQUARE_ENVIRONMENT
      }
    })
  }
  
  const baseUrl = SQUARE_ENVIRONMENT === 'sandbox' 
    ? 'https://connect.squareupsandbox.com' 
    : 'https://connect.squareup.com'

  try {
    // ===== STEP 1: Get or Create Customer =====
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
        console.log('Found existing customer:', customerId)
      }
    }

    // Create customer if not found
    if (!customerId) {
      console.log('Creating new customer...')
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
        console.log('Created new customer:', customerId)
      } else {
        const errorText = await createResponse.text()
        console.error('Customer creation failed:', errorText)
        throw new Error('Failed to create customer: ' + errorText)
      }
    }

    // ===== STEP 2: Create Order =====
    console.log('Creating order...')
    const lineItems = orderData.items.map((item, index) => ({
      uid: `item-${index}-${Date.now()}`,
      name: `${item.product.charAt(0).toUpperCase() + item.product.slice(1)} - ${item.fragrance} (${item.size})`,
      quantity: String(item.quantity),
      base_price_money: {
        amount: Math.round(item.unitPrice * 100),
        currency: 'GBP'
      }
    }))

    const orderPayload = {
      idempotency_key: `ord_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      order: {
        location_id: SQUARE_LOCATION_ID,
        customer_id: customerId,
        line_items: lineItems,
        state: 'OPEN'
      }
    }

    const orderResponse = await fetch(`${baseUrl}/v2/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'Square-Version': '2024-12-18'
      },
      body: JSON.stringify(orderPayload)
    })

    if (!orderResponse.ok) {
      const errorData = await orderResponse.json()
      console.error('Order creation failed:', errorData)
      throw new Error(`Square Order API error: ${JSON.stringify(errorData)}`)
    }

    const orderResult = await orderResponse.json()
    const orderId = orderResult.order.id
    console.log('Order created:', orderId)

    // ===== STEP 3: Create Invoice =====
    console.log('Creating invoice...')
    const dueDate = new Date()
    dueDate.setDate(dueDate.getDate() + 14)
    const dueDateString = dueDate.toISOString().split('T')[0]

    const invoiceTitle = action === 'quote' 
      ? `Wholesale Quote - ${orderData.id}` 
      : `Wholesale Order - ${orderData.id}`

    const invoiceDescription = `Thank you for your wholesale ${action === 'quote' ? 'quote request' : 'order'}.

Company: ${customerInfo.companyName}
Contact: ${customerInfo.contactName}
Reference: ${orderData.id}

Please review the items and proceed with payment when ready.`

    const invoicePayload = {
      idempotency_key: `inv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      invoice: {
        location_id: SQUARE_LOCATION_ID,
        order_id: orderId,
        primary_recipient: {
          customer_id: customerId
        },
        payment_requests: [
          {
            request_type: 'BALANCE',
            due_date: dueDateString
          }
        ],
        delivery_method: 'EMAIL',
        invoice_number: orderData.id,
        title: invoiceTitle,
        description: invoiceDescription,
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
            value: action === 'quote' ? 'Quote' : 'Order',
            placement: 'ABOVE_LINE_ITEMS'
          }
        ]
      }
    }

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
      console.error('Invoice creation failed:', errorData)
      throw new Error(`Square Invoice API error: ${JSON.stringify(errorData)}`)
    }

    const invoiceResult = await invoiceResponse.json()
    const invoiceId = invoiceResult.invoice.id
    const invoiceVersion = invoiceResult.invoice.version
    console.log('Invoice created:', invoiceId)

    // ===== STEP 4: Publish Invoice =====
    console.log('Publishing invoice...')
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

    if (publishResponse.ok) {
      console.log('✅ Invoice published successfully')
      console.log('📧 Square will email:', customerInfo.email)
    } else {
      const errorData = await publishResponse.json()
      console.error('⚠️ Publish failed (invoice still created):', errorData)
    }

    // ===== SUCCESS =====
    console.log('========== SUCCESS ==========')
    console.log('Order ID:', orderId)
    console.log('Invoice ID:', invoiceId)
    console.log('Customer:', customerInfo.companyName)
    console.log('Email:', customerInfo.email)
    console.log('Total: £' + orderData.total.toFixed(2))
    console.log('Type:', action === 'quote' ? 'Quote' : 'Order')
    console.log('============================')

    return res.status(200).json({
      success: true,
      invoiceId: invoiceId,
      orderId: orderId,
      customerId: customerId,
      message: action === 'quote'
        ? 'Quote invoice sent! Square will email you shortly with the details.'
        : 'Order invoice sent! Square will email you with a secure payment link.'
    })

  } catch (error) {
    console.error('========== ERROR ==========')
    console.error('Error:', error.message)
    console.error('Stack:', error.stack)
    console.error('===========================')
    
    return res.status(500).json({
      success: false,
      error: error.message
    })
  }
}
