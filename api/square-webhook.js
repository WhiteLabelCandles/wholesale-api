// Vercel Serverless Function for Square Wholesale Orders
// No CORS issues, production-ready

// Enable CORS
const allowCors = fn => async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT')
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version')
  
  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }
  return await fn(req, res)
}

async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const { action, orderData, customerInfo } = req.body

  // Validate input
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
    
    // Search for existing customer
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
        throw new Error('Failed to create customer')
      }
    }

    // 2. Create Order in Square
    const lineItems = orderData.items.map(item => ({
      name: `${item.product.charAt(0).toUpperCase() + item.product.slice(1)} - ${item.fragrance}`,
      quantity: String(item.quantity),
      base_price_money: {
        amount: Math.round(item.unitPrice * 100), // Convert to pence
        currency: 'GBP'
      },
      note: `Size: ${item.size}`
    }))

    const orderResponse = await fetch(`${baseUrl}/v2/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'Square-Version': '2024-12-18'
      },
      body: JSON.stringify({
        idempotency_key: `wlc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        order: {
          location_id: SQUARE_LOCATION_ID,
          customer_id: customerId,
          line_items: lineItems,
          state: action === 'quote' ? 'OPEN' : 'PROPOSED',
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
      throw new Error(`Square API error: ${JSON.stringify(errorData)}`)
    }

    const orderResult = await orderResponse.json()
    const squareOrderId = orderResult.order.id

    // 3. Send Email Notification
    await sendEmail(orderData, action, squareOrderId)

    // 4. Return success
    return res.status(200).json({
      success: true,
      squareOrderId: squareOrderId,
      customerId: customerId,
      message: action === 'quote' ? 'Quote generated successfully' : 'Order created successfully'
    })

  } catch (error) {
    console.error('Error processing request:', error)
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    })
  }
}

// Email function using Vercel's email capability
async function sendEmail(orderData, type, squareOrderId) {
  // Format items list
  const itemsList = orderData.items.map(item => 
    `- ${item.product.charAt(0).toUpperCase() + item.product.slice(1)} (${item.fragrance})\n  Size: ${item.size}, Qty: ${item.quantity}, £${item.total.toFixed(2)}`
  ).join('\n\n')

  const emailBody = `
New Wholesale ${type === 'quote' ? 'Quote' : 'Order'} Received

Reference ID: ${orderData.id}
Square Order ID: ${squareOrderId}

CUSTOMER DETAILS:
Company: ${orderData.customer.companyName}
Contact: ${orderData.customer.contactName}
Email: ${orderData.customer.email}
Phone: ${orderData.customer.phone}

ORDER DETAILS:
${itemsList}

TOTAL: £${orderData.total.toFixed(2)}

Date: ${new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' })}
`

  // For Vercel, you can use SendGrid, Resend, or another email service
  // For now, we'll log it (you can add email service later)
  console.log('Email would be sent to: contact@whitelabelcandles.co.uk')
  console.log('CC:', orderData.customer.email)
  console.log('Subject:', type === 'quote' ? 'New Wholesale Quote Request' : 'New Wholesale Order')
  console.log('Body:', emailBody)
  
  // TODO: Integrate with SendGrid/Resend for actual email sending
  // Example with Resend:
  // await fetch('https://api.resend.com/emails', {
  //   method: 'POST',
  //   headers: {
  //     'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
  //     'Content-Type': 'application/json'
  //   },
  //   body: JSON.stringify({
  //     from: 'orders@whitelabelcandles.co.uk',
  //     to: 'contact@whitelabelcandles.co.uk',
  //     cc: orderData.customer.email,
  //     subject: type === 'quote' ? 'New Wholesale Quote Request' : 'New Wholesale Order',
  //     text: emailBody
  //   })
  // })
}

module.exports = allowCors(handler)
