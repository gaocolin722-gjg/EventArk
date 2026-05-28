import crypto from 'crypto'

const ANTOM_GATEWAY =
  process.env.ANTOM_GATEWAY_URL || 'https://open-sea-global.alipay.com'
const ANTOM_PAY_PATH = '/ams/api/v1/payments/pay'

/**
 * @param {string} pem
 */
function normalizePem(pem) {
  if (pem.includes('BEGIN')) return pem
  const body = pem.replace(/\s/g, '')
  const lines = body.match(/.{1,64}/g) || []
  return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----`
}

/**
 * @param {string} pem
 */
function normalizePublicPem(pem) {
  if (pem.includes('BEGIN')) return pem
  const body = pem.replace(/\s/g, '')
  const lines = body.match(/.{1,64}/g) || []
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`
}

/**
 * @param {string} method
 * @param {string} path
 * @param {string} clientId
 * @param {string} requestTime
 * @param {string} body
 * @param {string} privateKeyRaw
 */
export function signAntomRequest(method, path, clientId, requestTime, body, privateKeyRaw) {
  const content = `${method} ${path}\n${clientId}.${requestTime}.${body}`
  const privateKey = normalizePem(privateKeyRaw)
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(content)
  signer.end()
  const signature = signer.sign(privateKey, 'base64')
  return `algorithm=RSA256,keyVersion=1,signature=${encodeURIComponent(signature)}`
}

/**
 * @param {string} method
 * @param {string} path
 * @param {string} clientId
 * @param {string} requestTime
 * @param {string} body
 * @param {string} signatureHeader
 * @param {string} publicKeyRaw
 */
export function verifyAntomWebhook(
  method,
  path,
  clientId,
  requestTime,
  body,
  signatureHeader,
  publicKeyRaw
) {
  const match = signatureHeader.match(/signature=([^,]+)/i)
  if (!match) return false

  const signature = decodeURIComponent(match[1])
  const content = `${method} ${path}\n${clientId}.${requestTime}.${body}`
  const publicKey = normalizePublicPem(publicKeyRaw)
  const verifier = crypto.createVerify('RSA-SHA256')
  verifier.update(content)
  verifier.end()
  return verifier.verify(publicKey, Buffer.from(signature, 'base64'))
}

/**
 * Create Antom cashier payment and return redirect URL.
 *
 * @param {{
 *   merchantOrderNo: string
 *   amountHkd: number
 *   orderDescription: string
 *   userId: string
 * }} params
 */
export async function createAntomPayment(params) {
  const clientId = process.env.ANTOM_CLIENT_ID
  const privateKey = process.env.ANTOM_MERCHANT_PRIVATE_KEY
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const notifyUrl = `${appUrl}/api/antom-notify`
  const redirectUrl = `${appUrl}/admin?payment=success`

  if (!clientId || !privateKey) {
    throw new Error('Antom payment is not configured (ANTOM_CLIENT_ID / ANTOM_MERCHANT_PRIVATE_KEY)')
  }

  const amountCents = String(Math.round(params.amountHkd * 100))
  const requestTime = new Date().toISOString()
  const paymentMethodType = process.env.ANTOM_PAYMENT_METHOD || 'ALIPAY_HK'

  const payload = {
    productCode: 'CASHIER_PAYMENT',
    paymentRequestId: params.merchantOrderNo,
    paymentAmount: { currency: 'HKD', value: amountCents },
    paymentMethod: { paymentMethodType },
    order: {
      referenceOrderId: params.merchantOrderNo,
      orderDescription: params.orderDescription,
      orderAmount: { currency: 'HKD', value: amountCents },
    },
    env: { terminalType: 'WEB' },
    paymentNotifyUrl: notifyUrl,
    paymentRedirectUrl: redirectUrl,
  }

  const body = JSON.stringify(payload)
  const signature = signAntomRequest('POST', ANTOM_PAY_PATH, clientId, requestTime, body, privateKey)

  const response = await fetch(`${ANTOM_GATEWAY}${ANTOM_PAY_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'client-id': clientId,
      'request-time': requestTime,
      signature,
    },
    body,
  })

  const result = await response.json()

  if (!response.ok) {
    throw new Error(result?.resultMessage || result?.message || 'Antom payment creation failed')
  }

  const redirect =
    result?.normalUrl ||
    result?.redirectActionForm?.redirectUrl ||
    result?.paymentActionForm?.redirectUrl

  if (!redirect) {
    throw new Error('Antom did not return a payment redirect URL')
  }

  return { redirectUrl: redirect, raw: result }
}

export { ANTOM_PAY_PATH }
