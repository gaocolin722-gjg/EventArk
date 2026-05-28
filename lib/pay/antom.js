import { createSign, createPrivateKey, createVerify } from 'crypto'

const LOG_PREFIX = '[Antom Pay]'

/**
 * 將 .env 中的私鑰字串還原為標準 PEM（對齊 OpenClaw）
 */
function normalizePem(pem) {
  let s = pem.trim()
  if (!s) return s
  s = s.replace(/^\uFEFF/, '').replace(/^["']|["']$/g, '').trim()
  s = s.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  s = s.replace(/[\u2013\u2014\u2015]/g, '-')
  const beginMatch = s.match(/-----BEGIN (?:RSA )?PRIVATE KEY-----/)
  const endMatch = s.match(/-----END (?:RSA )?PRIVATE KEY-----/)
  if (beginMatch && endMatch) {
    const start = s.indexOf(beginMatch[0]) + beginMatch[0].length
    const end = s.indexOf(endMatch[0])
    const middle = s.slice(start, end).replace(/\s/g, '')
    if (!middle || middle.length < 100) return s
    const header = beginMatch[0]
    const footer = endMatch[0]
    const lines = []
    for (let i = 0; i < middle.length; i += 64) {
      lines.push(middle.slice(i, i + 64))
    }
    return `${header}\n${lines.join('\n')}\n${footer}`
  }
  if (/^[A-Za-z0-9+/=]{200,}$/.test(s.replace(/\s/g, ''))) {
    const b64 = s.replace(/\s/g, '')
    const lines = []
    for (let i = 0; i < b64.length; i += 64) {
      lines.push(b64.slice(i, i + 64))
    }
    return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----`
  }
  return s
}

/**
 * Antom 請求簽名（對齊 OpenClaw src/lib/pay/antom.ts）
 */
export function signAntomRequest(httpMethod, path, clientId, requestTime, requestBody, privateKeyPem) {
  const contentToSign = `${httpMethod} ${path}\n${clientId}.${requestTime}.${requestBody}`
  const pem = normalizePem(privateKeyPem)
  let keyObject

  const tryPem = () => createPrivateKey({ key: pem, format: 'pem' })
  const tryDer = () => {
    const beginIdx = pem.search(/-----BEGIN (RSA )?PRIVATE KEY-----/)
    const endIdx = pem.search(/-----END (?:RSA )?PRIVATE KEY-----/)
    if (beginIdx === -1 || endIdx === -1 || endIdx <= beginIdx) {
      throw new Error('PEM 格式不完整')
    }
    const beginStr = pem.slice(beginIdx).match(/-----BEGIN (RSA )?PRIVATE KEY-----/)?.[0] ?? ''
    const endStr = pem.slice(endIdx).match(/-----END (?:RSA )?PRIVATE KEY-----/)?.[0] ?? ''
    const midStart = beginIdx + beginStr.length
    const midEnd = endIdx
    const b64 = pem.slice(midStart, midEnd).replace(/\s/g, '')
    const der = Buffer.from(b64, 'base64')
    const keyType = beginStr.includes('RSA ') ? 'pkcs1' : 'pkcs8'
    return createPrivateKey({ key: der, format: 'der', type: keyType })
  }

  try {
    keyObject = tryPem()
  } catch (e1) {
    const err1 = /** @type {NodeJS.ErrnoException} */ (e1)
    if (err1.code === 'ERR_OSSL_UNSUPPORTED' || err1.message?.includes('DECODER')) {
      keyObject = tryDer()
    } else {
      throw e1
    }
  }

  const sign = createSign('RSA-SHA256')
  sign.update(contentToSign, 'utf8')
  const signature = sign.sign(keyObject, 'base64')
  return encodeURIComponent(signature)
}

/**
 * 校驗 Antom Webhook 簽名（對齊 OpenClaw verifyAntomSignature）
 * @param {Record<string, unknown>} payload
 * @param {string} signature
 */
export function verifyAntomSignature(payload, signature) {
  if (!signature || signature.trim() === '') {
    console.warn(`${LOG_PREFIX} 簽名驗證失敗：未收到簽名`)
    return { verified: false, reason: '簽名為空' }
  }

  const publicKey = process.env.ANTOM_PUBLIC_KEY
  if (!publicKey || publicKey.trim() === '') {
    const envHint =
      process.env.NODE_ENV === 'production'
        ? '生產環境必須設置 ANTOM_PUBLIC_KEY'
        : '開發環境未配置 ANTOM_PUBLIC_KEY，已放行以便調試'
    console.warn(`${LOG_PREFIX} ${envHint}`)
    if (process.env.NODE_ENV === 'production') {
      return { verified: false, reason: 'ANTOM_PUBLIC_KEY 未配置' }
    }
    return { verified: true }
  }

  const keyFormattedForCheck = publicKey.replace(/\\n/g, '\n').trim()
  if (
    !keyFormattedForCheck.startsWith('-----BEGIN PUBLIC KEY-----') ||
    !keyFormattedForCheck.includes('-----END PUBLIC KEY-----')
  ) {
    const wrapped = `-----BEGIN PUBLIC KEY-----\n${publicKey.replace(/\s/g, '').replace(/\\n/g, '')}\n-----END PUBLIC KEY-----`
    try {
      const verifier = createVerify('RSA-SHA256')
      const { sign, ...rest } = payload
      const canonical =
        typeof sign !== 'undefined' ? JSON.stringify(rest) : JSON.stringify(payload)
      verifier.update(canonical)
      const ok = verifier.verify(wrapped, signature, 'base64')
      return ok ? { verified: true } : { verified: false, reason: 'RSA-SHA256 驗證失敗' }
    } catch {
      return { verified: false, reason: 'ANTOM_PUBLIC_KEY 格式不正確' }
    }
  }

  try {
    const { sign, ...rest } = payload
    const canonical =
      typeof sign !== 'undefined' ? JSON.stringify(rest) : JSON.stringify(payload)
    const verifier = createVerify('RSA-SHA256')
    verifier.update(canonical)
    const keyFormatted = publicKey.replace(/\\n/g, '\n')
    const ok = verifier.verify(keyFormatted, signature, 'base64')
    if (!ok) {
      return { verified: false, reason: 'RSA-SHA256 驗證失敗' }
    }
    return { verified: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { verified: false, reason: `驗證過程異常: ${message}` }
  }
}

/**
 * @param {Record<string, unknown>} body
 */
export function parseAntomResultStatus(body) {
  const result = /** @type {Record<string, unknown> | undefined} */ (body.result)
  return (
    /** @type {string} */ (body.resultStatus) ??
    /** @type {string} */ (result?.resultStatus) ??
    /** @type {string} */ (result?.resultCode) ??
    ''
  )
}

/**
 * @param {Record<string, unknown>} body
 */
export function parseAntomOutTradeNo(body) {
  const order = /** @type {Record<string, unknown> | undefined} */ (body.order)
  const raw =
    body.outTradeNo ??
    body.out_trade_no ??
    body.referenceOrderId ??
    body.paymentRequestId ??
    order?.referenceOrderId

  let value = typeof raw === 'string' ? raw.trim() : ''
  if (value.startsWith('REQ_')) {
    value = value.slice(4)
  }
  return value
}

/**
 * @param {string} resultStatus
 */
export function isAntomPaymentSuccess(resultStatus) {
  return (
    resultStatus === 'S' ||
    resultStatus === 'PAYMENT_SUCCESS' ||
    resultStatus === 'SUCCESS'
  )
}

/**
 * @param {unknown} data
 */
export function extractAntomPaymentUrl(data) {
  const extractUrl = (obj) => {
    if (!obj || typeof obj !== 'object') return undefined
    const rec = /** @type {Record<string, unknown>} */ (obj)
    const keys = [
      'paymentUrl',
      'payUrl',
      'url',
      'redirectUrl',
      'clientRedirectUrl',
      'paymentRedirectUrl',
      'normalUrl',
      'redirect_url',
      'payment_url',
    ]
    for (const k of keys) {
      const v = rec[k]
      if (typeof v === 'string' && v.startsWith('http')) return v
    }
    return undefined
  }

  const findUrlInObj = (obj) => {
    if (typeof obj === 'string' && obj.startsWith('http')) return obj
    if (obj && typeof obj === 'object') {
      const u = extractUrl(obj)
      if (u) return u
      for (const v of Object.values(/** @type {Record<string, unknown>} */ (obj))) {
        const found = findUrlInObj(v)
        if (found) return found
      }
    }
    return undefined
  }

  const root = /** @type {Record<string, unknown>} */ (data)
  return (
    extractUrl(root) ??
    extractUrl(root.body) ??
    extractUrl(root.data) ??
    extractUrl(root.result) ??
    findUrlInObj(root)
  )
}

export function getAntomApiBase() {
  const raw =
    process.env.ANTOM_API_BASE ??
    process.env.ANTOM_GATEWAY_URL ??
    'https://open-sea-global.alipay.com'
  return raw.replace(/^ANTOM_API_BASE=/, '').trim() || 'https://open-sea-global.alipay.com'
}

export function getAntomPayPath() {
  return process.env.ANTOM_API_PATH ?? '/ams/api/v1/payments/pay'
}

export function getAntomClientId() {
  return process.env.ANTOM_CLIENT_ID ?? process.env.ANTOM_APP_ID ?? ''
}

export function getAntomPrivateKey() {
  return process.env.ANTOM_PRIVATE_KEY ?? process.env.ANTOM_MERCHANT_PRIVATE_KEY ?? ''
}

export function getAntomNotifyUrl(appUrl) {
  const base = (appUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(
    /\/$/,
    ''
  )
  return `${base}/api/webhooks/antom`
}
