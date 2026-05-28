/**
 * Antom 下單請求體（對齊 OpenClaw src/lib/payments/antom.ts）
 */

export function toAntomMinorUnit(amount) {
  return String(Math.round(amount * 100))
}

/**
 * @param {string} outTradeNo
 * @param {number} amount
 * @param {string} currency
 */
export function toAntomCheckoutBaseData(outTradeNo, amount, currency) {
  return {
    out_trade_no: outTradeNo,
    total_amount: toAntomMinorUnit(amount),
    currency,
  }
}

/**
 * @param {{
 *   outTradeNo: string
 *   amount: number
 *   currency: string
 *   redirectUrl: string
 *   notifyUrl: string
 *   orderDescription: string
 *   userId?: string
 * }} input
 */
export function buildAntomPaymentRequest(input) {
  const base = toAntomCheckoutBaseData(input.outTradeNo, input.amount, input.currency)
  const amount = {
    currency: base.currency,
    value: base.total_amount,
  }

  const paymentMethodType =
    process.env.ANTOM_PAYMENT_METHOD ?? 'ALIPAY_CN'

  return {
    productCode: 'CASHIER_PAYMENT',
    paymentRequestId: `REQ_${input.outTradeNo}`,
    paymentAmount: amount,
    paymentMethod: { paymentMethodType },
    paymentRedirectUrl: input.redirectUrl,
    paymentNotifyUrl: input.notifyUrl,
    order: {
      referenceOrderId: input.outTradeNo,
      orderAmount: amount,
      orderDescription: input.orderDescription,
    },
    metadata: {
      user_id: input.userId ?? null,
      plan_to_unlock: 'pro',
    },
    env: { terminalType: 'WEB' },
  }
}
