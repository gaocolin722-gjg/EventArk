-- EventArk Multi-tenant Schema
-- Run in Supabase SQL Editor

-- Projects: add tenant owner
ALTER TABLE projects ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);

-- Subscriptions
CREATE TABLE IF NOT EXISTS user_subscriptions (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_type TEXT NOT NULL DEFAULT 'free' CHECK (plan_type IN ('free', 'pro')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Payment orders
CREATE TABLE IF NOT EXISTS tenant_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  merchant_order_no TEXT NOT NULL UNIQUE,
  plan_to_unlock TEXT NOT NULL DEFAULT 'pro' CHECK (plan_to_unlock IN ('pro')),
  amount_cents INTEGER NOT NULL DEFAULT 29900,
  currency TEXT NOT NULL DEFAULT 'HKD',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'cancelled')),
  antom_payment_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tenant_orders_user_id ON tenant_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_orders_status ON tenant_orders(status);

-- Auto-create free subscription on signup
CREATE OR REPLACE FUNCTION public.handle_new_user_subscription()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_subscriptions (user_id, plan_type)
  VALUES (NEW.id, 'free')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_subscription ON auth.users;
CREATE TRIGGER on_auth_user_created_subscription
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_subscription();
