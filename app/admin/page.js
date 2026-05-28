'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { getSupabase } from '@/lib/supabase'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import { DEFAULT_LOCALE, GLASS_CARD, GLASS_INPUT, GLASS_NAV, t } from '@/lib/translations'

/** @typedef {import('@/lib/translations').Locale} Locale */

const LOCALE_STORAGE_KEY = 'eventark_locale'
const FREE_EVENT_LIMIT = 1

/**
 * @param {{ plan_type?: string; expires_at?: string | null } | null} sub
 */
function isProActive(sub) {
  if (!sub || sub.plan_type !== 'pro') return false
  if (!sub.expires_at) return true
  return new Date(sub.expires_at) > new Date()
}

function AdminLobbyContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [locale, setLocale] = useState(/** @type {Locale} */ (DEFAULT_LOCALE))
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [subscription, setSubscription] = useState(null)
  const [projects, setProjects] = useState([])
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [upgrading, setUpgrading] = useState(false)
  const [toast, setToast] = useState(null)

  const tl = useCallback((key, vars) => t(locale, 'lobby', key, vars), [locale])
  const tc = useCallback((key, vars) => t(locale, 'common', key, vars), [locale])

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LOCALE_STORAGE_KEY)
      if (saved === 'zh_TW' || saved === 'zh_CN' || saved === 'en') setLocale(saved)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (searchParams.get('payment') === 'success') {
      setToast({ type: 'success', message: tl('paymentSuccess') })
    }
  }, [searchParams, tl])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const supabase = getSupabase()
      const {
        data: { user: authUser },
        error: authError,
      } = await supabase.auth.getUser()

      if (authError || !authUser) {
        router.replace('/login')
        return
      }

      setUser(authUser)

      const [subResult, projectsResult] = await Promise.all([
        supabase
          .from('user_subscriptions')
          .select('plan_type, expires_at')
          .eq('user_id', authUser.id)
          .maybeSingle(),
        supabase
          .from('projects')
          .select('id, title, created_at, theme_color')
          .eq('user_id', authUser.id)
          .order('created_at', { ascending: false }),
      ])

      if (subResult.error) throw subResult.error
      if (projectsResult.error) throw projectsResult.error

      if (!subResult.data) {
        await supabase.from('user_subscriptions').upsert({
          user_id: authUser.id,
          plan_type: 'free',
        })
        setSubscription({ plan_type: 'free', expires_at: null })
      } else {
        setSubscription(subResult.data)
      }

      setProjects(projectsResult.data ?? [])
    } catch (err) {
      console.error('Lobby load failed:', err)
      setToast({ type: 'error', message: tl('loadFailed') })
    } finally {
      setLoading(false)
    }
  }, [router, tl])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleLocaleChange = (next) => {
    setLocale(next)
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
  }

  const handleUpgrade = async () => {
    setUpgrading(true)
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_to_unlock: 'pro' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || tl('upgradeFailed'))
      const paymentUrl = data.paymentUrl || data.redirectUrl
      if (paymentUrl) {
        window.location.href = paymentUrl
      }
    } catch (err) {
      setToast({
        type: 'error',
        message: err instanceof Error ? err.message : tl('upgradeFailed'),
      })
    } finally {
      setUpgrading(false)
    }
  }

  const handleCreateEvent = async (e) => {
    e.preventDefault()
    const title = newTitle.trim()
    if (!title || !user) return

    const pro = isProActive(subscription)
    if (!pro && projects.length >= FREE_EVENT_LIMIT) {
      setToast({ type: 'error', message: tl('freeLimit') })
      return
    }

    setCreating(true)
    try {
      const supabase = getSupabase()

      const { data: project, error: projectError } = await supabase
        .from('projects')
        .insert({
          user_id: user.id,
          title,
          theme_color: '#16a34a',
        })
        .select('id')
        .single()

      if (projectError) throw projectError

      const { error: configError } = await supabase.from('project_configs').insert({
        project_id: project.id,
        verify_mode: 'name_only',
        seat_label: '座位',
        enable_photo_live: false,
      })

      if (configError) throw configError

      setShowCreateModal(false)
      setNewTitle('')
      router.push(`/admin/${project.id}`)
    } catch (err) {
      console.error('Create event failed:', err)
      setToast({ type: 'error', message: tl('createFailed') })
    } finally {
      setCreating(false)
    }
  }

  const handleSignOut = async () => {
    const supabase = getSupabase()
    await supabase.auth.signOut()
    router.replace('/login')
  }

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-slate-100 to-emerald-50">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-emerald-600" />
      </div>
    )
  }

  const pro = isProActive(subscription)
  const planLabel = pro ? tl('planPro') : tl('planFree')

  return (
    <div className="min-h-dvh bg-gradient-to-br from-slate-100 via-white to-emerald-50">
      <header className={`sticky top-0 z-30 ${GLASS_NAV}`}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div>
            <p className="text-xs font-semibold text-emerald-700 uppercase">{tl('brand')}</p>
            <p className="text-sm text-slate-500">{user?.email}</p>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher locale={locale} onChange={handleLocaleChange} />
            <button
              type="button"
              onClick={handleSignOut}
              className="rounded-lg border border-white/40 bg-white/50 px-3 py-1.5 text-xs text-slate-600 backdrop-blur-sm hover:bg-white/70"
            >
              {tl('signOut')}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {!pro && (
          <div
            className={`mb-8 overflow-hidden p-6 ${GLASS_CARD} border-emerald-200/50 bg-gradient-to-r from-emerald-50/80 to-white/70`}
          >
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs font-semibold text-emerald-700 uppercase">{planLabel}</p>
                <h2 className="mt-1 text-lg font-bold text-slate-900">{tl('upgradeTitle')}</h2>
                <p className="mt-2 max-w-xl text-sm text-slate-600">{tl('upgradeDesc')}</p>
              </div>
              <button
                type="button"
                onClick={handleUpgrade}
                disabled={upgrading}
                className="shrink-0 rounded-xl bg-gradient-to-r from-emerald-600 to-green-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20 transition hover:opacity-90 disabled:opacity-60"
              >
                {upgrading ? '…' : tl('upgradeBtn')}
              </button>
            </div>
          </div>
        )}

        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{tl('myEvents')}</h1>
            <p className="text-sm text-slate-500">
              {tl('eventCount', { count: projects.length })} · {planLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-emerald-700"
          >
            {tl('createEvent')}
          </button>
        </div>

        {projects.length === 0 ? (
          <div className={`p-12 text-center ${GLASS_CARD}`}>
            <p className="text-4xl">🎪</p>
            <p className="mt-4 text-slate-600">{tl('noEvents')}</p>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="mt-6 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white"
            >
              {tl('createFirst')}
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/admin/${project.id}`}
                className={`group block p-5 transition hover:scale-[1.02] ${GLASS_CARD}`}
              >
                <div
                  className="mb-3 h-1.5 rounded-full"
                  style={{ backgroundColor: project.theme_color || '#16a34a' }}
                />
                <h3 className="font-semibold text-slate-900 group-hover:text-emerald-700">
                  {project.title}
                </h3>
                <p className="mt-1 text-xs text-slate-400">{tl('manage')}</p>
              </Link>
            ))}
          </div>
        )}
      </main>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className={`w-full max-w-md p-6 ${GLASS_CARD}`}>
            <h2 className="text-lg font-bold text-slate-900">{tl('createEvent')}</h2>
            <p className="mt-1 text-sm text-slate-500">{tl('createHint')}</p>
            <form onSubmit={handleCreateEvent} className="mt-4 space-y-4">
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder={tl('eventNamePh')}
                required
                className={`w-full rounded-xl px-4 py-3 text-sm focus:ring-emerald-500/30 ${GLASS_INPUT}`}
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 rounded-xl border border-white/50 bg-white/40 py-2.5 text-sm text-slate-600"
                >
                  {tl('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-medium text-white disabled:opacity-60"
                >
                  {creating ? '…' : tl('confirmCreate')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 max-w-sm rounded-xl border px-4 py-3 text-sm shadow-xl backdrop-blur-md ${
            toast.type === 'success'
              ? 'border-green-200/60 bg-green-50/90 text-green-800'
              : 'border-red-200/60 bg-red-50/90 text-red-800'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  )
}

export default function AdminLobbyPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-emerald-600" />
        </div>
      }
    >
      <AdminLobbyContent />
    </Suspense>
  )
}
