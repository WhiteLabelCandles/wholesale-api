// Vercel Serverless Function - Fixed CORS
export default async function handler(req, res) {
  // Set CORS headers for ALL requests
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept')
  res.setHeader('Access-Control-Max-Age', '86400')
  
  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }
  
  // Only allow POST for actual requests
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const { action, orderData, customerInfo } = req.body

  if (!action || !orderData || !customerInfo) {
    return res.status(400).json({ success: false, error: 'Missing required data' })
  }

  // Square Configuration
  const SQUARE_ACCESS_TOKEN = 'EAAAl88RT89hR2JoGQVUqZA5QjpjDWt62tmQFv6Kp1qS0gwzvQegXpkwnW74oJLW'
  const SQUARE_LOCATION_ID = '2AY43CKCRRKZA'
  const SQUARE_ENVIRONMENT = 'sandbox'
  
  const baseUrl = SQUARE_ENVIRONMENT === 'sandbox' 
    ? 'https://connect.squareupsandbox.com' 
    : 'https://connect.squareup.com'

  try {
    // 1. Get or Create Customer
    let customerId = null
    
    // Search for customer
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

    // 2. Create Order
    const lineItems = orderData.items.map(item => ({
      name: item.product.charAt(0).toUpperCase() + item.product.slice(1) + ' - ' + item.fragrance,
      quantity: String(item.quantity),
      base_price_money: {
        amount: Math.round(item.unitPrice * 100),
        currency: 'GBP'
      },
      note: 'Size: ' + item.size
    }))

    const orderResponse = await fetch(`${baseUrl}/v2/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'Square-Version': '2024-12-18'
      },
      body: JSON.stringify({
        idempotency_key: 'wlc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        order: {
          location_id: SQUARE_LOCATION_ID,
          customer_id: customerId,
          line_items: lineItems,
          state: 'OPEN',
          metadata: {
            order_type: action,
            reference_id: orderData.id,
            company_name: orderData.customer.companyName
          }
        }
      })
    })

    if (!orderResponse.ok) {
      const errorData = await orderResponse.json()
      throw new Error('Square API error: ' + JSON.stringify(errorData))
    }

    const orderResult = await orderResponse.json()
    const squareOrderId = orderResult.order.id

    // Log email info
    console.log('===== ORDER CREATED =====')
    console.log('To: contact@whitelabelcandles.co.uk')
    console.log('CC:', customerInfo.email)
    console.log('Quote ID:', orderData.id)
    console.log('Square ID:', squareOrderId)
    console.log('Customer:', customerInfo.companyName)
    console.log('Total: £' + orderData.total.toFixed(2))
    console.log('========================')

    return res.status(200).json({
      success: true,
      squareOrderId: squareOrderId,
      customerId: customerId,
      message: action === 'quote' ? 'Quote generated successfully' : 'Order created successfully'
    })

  } catch (error) {
    console.error('Error:', error)
    return res.status(500).json({
      success: false,
      error: error.message
    })
  }
}
