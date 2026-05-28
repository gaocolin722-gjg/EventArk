import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import {
  isAntomPaymentSuccess,
  parseAntomOutTradeNo,
  parseAntomResultStatus,
  verifyAntomSignature,
} from '@/lib/pay/antom'

/**
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

async function handleAntomNotify(request) {
  try {
    const body = /** @type {Record<string, unknown>} */ (await request.json())

    const signature =
      request.headers.get('x-antom-signature') ??
      request.headers.get('x-signature') ??
      /** @type {string | undefined} */ (body.sign) ??
      ''

    if (signature) {
      const { verified, reason } = verifyAntomSignature(body, signature)
      if (!verified) {
        console.error('[Antom Webhook] Invalid signature:', reason)
        return NextResponse.json({ error: 'Invalid signature', reason }, { status: 401 })
      }
    }

    const resultStatus = parseAntomResultStatus(body)
    const merchantOrderNo = parseAntomOutTradeNo(body)

    if (!isAntomPaymentSuccess(resultStatus)) {
      return NextResponse.json(
        { received: true, message: 'Payment not successful, no update' },
        { status: 200 }
      )
    }

    if (!merchantOrderNo) {
      return NextResponse.json({ error: 'Missing merchant order no' }, { status: 400 })
    }

    const admin = getSupabaseAdmin()

    const { data: order, error: orderFetchError } = await admin
      .from('tenant_orders')
      .select('*')
      .eq('merchant_order_no', merchantOrderNo)
      .maybeSingle()

    if (orderFetchError || !order) {
      console.error('[Antom Webhook] Order not found:', merchantOrderNo, orderFetchError)
      return NextResponse.json({ received: true, message: 'order not found' }, { status: 200 })
    }

    if (order.status === 'success') {
      return NextResponse.json({ success: true, message: 'already processed' })
    }

    const { error: updateOrderError } = await admin
      .from('tenant_orders')
      .update({
        status: 'success',
        paid_at: new Date().toISOString(),
        antom_payment_id:
          /** @type {string | undefined} */ (body.paymentId) ??
          /** @type {string | undefined} */ (body.paymentRequestId) ??
          null,
      })
      .eq('id', order.id)

    if (updateOrderError) {
      console.error('[Antom Webhook] Failed to update tenant_orders:', updateOrderError)
      return NextResponse.json({ error: 'DB update failed' }, { status: 500 })
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
      console.error('[Antom Webhook] Failed to update user_subscriptions:', subError)
      return NextResponse.json({ error: 'Subscription update failed' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: 'Membership activated',
      out_trade_no: merchantOrderNo,
    })
  } catch (err) {
    console.error('[Antom Webhook] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request) {
  return handleAntomNotify(request)
}

export async function GET() {
  return NextResponse.json({ status: 'ok', gateway: 'ANTOM' })
}
