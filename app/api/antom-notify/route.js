import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { verifyAntomWebhook } from '@/lib/antom'

/**
 * Extend Pro subscription by 30 days from now or current expiry (whichever is later).
 * @param {string | null | undefined} currentExpiresAt
 */
function computeNewExpiry(currentExpiresAt) {
  const now = new Date()
  const base =
    currentExpiresAt && new Date(currentExpiresAt) > now
      ? new Date(currentExpiresAt)
      : now
  base.setDate(base.getDate() + 30)
  return base.toISOString()
}

export async function POST(request) {
  const rawBody = await request.text()

  try {
    const clientId = request.headers.get('client-id') || ''
    const requestTime = request.headers.get('request-time') || ''
    const signature = request.headers.get('signature') || ''
    const publicKey = process.env.ANTOM_PUBLIC_KEY

    if (!publicKey) {
      console.error('ANTOM_PUBLIC_KEY not configured')
      return NextResponse.json(
        { result: { resultCode: 'FAIL', resultMessage: 'Server misconfigured' } },
        { status: 500 }
      )
    }

    const path = '/api/antom-notify'
    const isValid = verifyAntomWebhook(
      'POST',
      path,
      clientId,
      requestTime,
      rawBody,
      signature,
      publicKey
    )

    if (!isValid) {
      console.error('Antom webhook signature verification failed')
      return NextResponse.json(
        { result: { resultCode: 'FAIL', resultMessage: 'Invalid signature' } },
        { status: 401 }
      )
    }

    const payload = JSON.parse(rawBody)
    const notifyType = payload.notifyType || payload.result?.notifyType
    const paymentStatus =
      payload.paymentStatus ||
      payload.result?.paymentStatus ||
      payload.result?.resultStatus

    const merchantOrderNo =
      payload.paymentRequestId ||
      payload.paymentRequestId ||
      payload.order?.referenceOrderId

    if (!merchantOrderNo) {
      return NextResponse.json({
        result: { resultCode: 'SUCCESS', resultMessage: 'ignored' },
      })
    }

    const isSuccess =
      notifyType === 'PAYMENT_RESULT' &&
      (paymentStatus === 'SUCCESS' || paymentStatus === 'S')

    if (!isSuccess) {
      return NextResponse.json({
        result: { resultCode: 'SUCCESS', resultMessage: 'acknowledged' },
      })
    }

    const admin = getSupabaseAdmin()

    const { data: order, error: orderFetchError } = await admin
      .from('tenant_orders')
      .select('*')
      .eq('merchant_order_no', merchantOrderNo)
      .maybeSingle()

    if (orderFetchError || !order) {
      console.error('Order not found:', merchantOrderNo, orderFetchError)
      return NextResponse.json({
        result: { resultCode: 'SUCCESS', resultMessage: 'order not found' },
      })
    }

    if (order.status === 'success') {
      return NextResponse.json({
        result: { resultCode: 'SUCCESS', resultMessage: 'already processed' },
      })
    }

    const { error: updateOrderError } = await admin
      .from('tenant_orders')
      .update({
        status: 'success',
        paid_at: new Date().toISOString(),
        antom_payment_id: payload.paymentId || payload.paymentRequestId || null,
      })
      .eq('id', order.id)

    if (updateOrderError) {
      console.error('Failed to update tenant_orders:', updateOrderError)
      return NextResponse.json(
        { result: { resultCode: 'FAIL', resultMessage: 'DB update failed' } },
        { status: 500 }
      )
    }

    const { data: existingSub } = await admin
      .from('user_subscriptions')
      .select('expires_at')
      .eq('user_id', order.user_id)
      .maybeSingle()

    const newExpiry = computeNewExpiry(existingSub?.expires_at)

    const { error: subError } = await admin.from('user_subscriptions').upsert(
      {
        user_id: order.user_id,
        plan_type: order.plan_to_unlock,
        expires_at: newExpiry,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )

    if (subError) {
      console.error('Failed to update user_subscriptions:', subError)
      return NextResponse.json(
        { result: { resultCode: 'FAIL', resultMessage: 'Subscription update failed' } },
        { status: 500 }
      )
    }

    return NextResponse.json({
      result: { resultCode: 'SUCCESS', resultMessage: 'success' },
    })
  } catch (err) {
    console.error('Antom notify error:', err)
    return NextResponse.json(
      { result: { resultCode: 'FAIL', resultMessage: 'Internal error' } },
      { status: 500 }
    )
  }
}

// Antom may send GET for health checks
export async function GET() {
  return NextResponse.json({ status: 'ok' })
}
