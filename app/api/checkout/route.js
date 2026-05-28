import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { createAntomPayment } from '@/lib/antom'

const PRO_PLAN_PRICE_HKD = 299

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

    const merchantOrderNo = `EA-${user.id.slice(0, 8)}-${Date.now()}`
    const amountCents = PRO_PLAN_PRICE_HKD * 100

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
      console.error('tenant_orders insert failed:', orderError)
      return NextResponse.json({ error: 'Failed to create order' }, { status: 500 })
    }

    const { redirectUrl } = await createAntomPayment({
      merchantOrderNo,
      amountHkd: PRO_PLAN_PRICE_HKD,
      orderDescription: 'EventArk Pro — 30 days subscription',
      userId: user.id,
    })

    return NextResponse.json({ redirectUrl, merchantOrderNo })
  } catch (err) {
    console.error('Checkout error:', err)
    const message = err instanceof Error ? err.message : 'Checkout failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
