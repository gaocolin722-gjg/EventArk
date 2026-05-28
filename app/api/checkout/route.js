import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { buildAntomPaymentRequest } from '@/lib/payments/antom'
import {
  extractAntomPaymentUrl,
  getAntomApiBase,
  getAntomClientId,
  getAntomNotifyUrl,
  getAntomPayPath,
  getAntomPrivateKey,
  signAntomRequest,
} from '@/lib/pay/antom'

const PRO_PLAN_PRICE_HKD = 299

function generateOutTradeNo(userId) {
  const ts = Date.now().toString(36)
  const r = Math.random().toString(36).slice(2, 8)
  return `EA_${userId.slice(0, 8)}_${ts}_${r}`
}

export async function POST(request) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const planToUnlock = body.plan_to_unlock === 'pro' ? 'pro' : 'pro'

    const clientId = getAntomClientId()
    const privateKey = getAntomPrivateKey()
    const apiBase = getAntomApiBase()
    const payPath = getAntomPayPath()

    if (!clientId || !privateKey) {
      return NextResponse.json(
        { error: 'Payment not configured (ANTOM_CLIENT_ID / ANTOM_PRIVATE_KEY)' },
        { status: 503 }
      )
    }

    const merchantOrderNo = generateOutTradeNo(user.id)
    const amountCents = PRO_PLAN_PRICE_HKD * 100
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

    const admin = getSupabaseAdmin()
    const { error: orderError } = await admin.from('tenant_orders').insert({
      user_id: user.id,
      merchant_order_no: merchantOrderNo,
      plan_to_unlock: planToUnlock,
      amount_cents: amountCents,
      currency: 'HKD',
      status: 'pending',
    })

    if (orderError) {
      console.error('[Checkout] tenant_orders insert failed:', orderError)
      return NextResponse.json({ error: 'Failed to create order' }, { status: 500 })
    }

    const redirectUrl = `${appUrl.replace(/\/$/, '')}/admin?payment=success`
    const notifyUrl = getAntomNotifyUrl(appUrl)

    const requestTime = Date.now().toString()
    const bodyObj = buildAntomPaymentRequest({
      outTradeNo: merchantOrderNo,
      amount: PRO_PLAN_PRICE_HKD,
      currency: 'HKD',
      redirectUrl,
      notifyUrl,
      orderDescription: 'EventArk Pro — 30 days subscription',
      userId: user.id,
    })
    const bodyStr = JSON.stringify(bodyObj)

    const signature = signAntomRequest(
      'POST',
      payPath,
      clientId,
      requestTime,
      bodyStr,
      privateKey
    )

    let res
    try {
      res = await fetch(`${apiBase}${payPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Client-Id': clientId,
          'Request-Time': requestTime,
          Signature: `algorithm=RSA256, keyVersion=1, signature=${signature}`,
        },
        body: bodyStr,
      })
    } catch (fetchErr) {
      console.error('[Checkout] Antom connection failed:', fetchErr)
      return NextResponse.json(
        { error: '無法連線至 Antom 支付網關', detail: '請檢查網路或 ANTOM_API_BASE 配置' },
        { status: 502 }
      )
    }

    const text = await res.text()
    if (!res.ok) {
      console.error('[Checkout] Antom API error:', res.status, text)
      return NextResponse.json({ error: 'Failed to create payment session' }, { status: 502 })
    }

    let data
    try {
      data = JSON.parse(text)
    } catch {
      console.error('[Checkout] Invalid JSON from Antom:', text)
      return NextResponse.json({ error: 'Invalid payment response' }, { status: 502 })
    }

    const paymentUrl = extractAntomPaymentUrl(data)
    if (!paymentUrl) {
      console.error('[Checkout] No payment URL in Antom response:', JSON.stringify(data).slice(0, 1500))
      return NextResponse.json({ error: 'Invalid payment response' }, { status: 502 })
    }

    return NextResponse.json({
      paymentUrl,
      redirectUrl: paymentUrl,
      outTradeNo: merchantOrderNo,
      merchantOrderNo,
    })
  } catch (err) {
    console.error('[Checkout] Error:', err)
    const message = err instanceof Error ? err.message : 'Checkout failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
