export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  
  return res.status(200).json({
    hasToken: !!process.env.SQUARE_ACCESS_TOKEN,
    hasLocation: !!process.env.SQUARE_LOCATION_ID,
    hasEnv: !!process.env.SQUARE_ENVIRONMENT,
    tokenLength: process.env.SQUARE_ACCESS_TOKEN?.length || 0,
    tokenStart: process.env.SQUARE_ACCESS_TOKEN?.substring(0, 10) || 'MISSING',
    locationId: process.env.SQUARE_LOCATION_ID || 'MISSING',
    environment: process.env.SQUARE_ENVIRONMENT || 'MISSING',
    allEnvKeys: Object.keys(process.env).filter(k => k.startsWith('SQUARE'))
  })
}
