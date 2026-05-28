'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { getSupabase } from '@/lib/supabase'
import { formatSupabaseError, isPermissionError } from '@/lib/supabase-errors'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import {
  DEFAULT_LOCALE,
  GLASS_CARD,
  GLASS_INPUT,
  t,
} from '@/lib/translations'

/** @typedef {import('@/lib/translations').Locale} Locale */
/** @typedef {'input' | 'ambiguous' | 'success' | 'error'} PageStatus */
/** @typedef {'not_found' | 'system'} ErrorReason */

const LOCALE_STORAGE_KEY = 'eventark_locale'

/**
 * @param {string | null | undefined} phone
 * @param {string} lastFour
 */
function phoneMatchesLastFour(phone, lastFour) {
  if (!phone) return false
  const digits = phone.replace(/\D/g, '')
  return digits.slice(-4) === lastFour
}

/**
 * @param {unknown} error
 */
function isDuplicateCheckinError(error) {
  if (!error || typeof error !== 'object') return false
  const code = /** @type {{ code?: string }} */ (error).code
  return code === '23505'
}

export default function EventCheckinPage() {
  const params = useParams()
  const eventId = /** @type {string} */ (params.id)

  const [locale, setLocale] = useState(/** @type {Locale} */ (DEFAULT_LOCALE))
  const [pageStatus, setPageStatus] = useState(/** @type {PageStatus} */ ('input'))
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [fetchError, setFetchError] = useState('')

  const [project, setProject] = useState(null)
  const [config, setConfig] = useState(null)

  const [name, setName] = useState('')
  const [phoneLast4, setPhoneLast4] = useState('')

  const [candidates, setCandidates] = useState([])
  const [selectedGuest, setSelectedGuest] = useState(null)
  const [errorReason, setErrorReason] = useState(/** @type {ErrorReason} */ ('not_found'))

  const themeColor = project?.theme_color || '#16a34a'
  const seatLabel = config?.seat_label || '座位'
  const verifyMode = config?.verify_mode || 'name_only'
  const enablePhotoLive = Boolean(config?.enable_photo_live)

  const te = useCallback((key, vars) => t(locale, 'event', key, vars), [locale])
  const tc = useCallback((key, vars) => t(locale, 'common', key, vars), [locale])

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LOCALE_STORAGE_KEY)
      if (saved === 'zh_TW' || saved === 'zh_CN' || saved === 'en') {
        setLocale(saved)
      }
    } catch {
      /* ignore */
    }
  }, [])

  const handleLocaleChange = (next) => {
    setLocale(next)
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
  }

  const themeStyles = useMemo(
    () => ({
      '--theme-color': themeColor,
      color: themeColor,
    }),
    [themeColor]
  )

  const loadEventData = useCallback(async () => {
    if (!eventId) {
      setFetchError(te('invalidLink'))
      setLoading(false)
      return
    }

    setLoading(true)
    setFetchError('')

    try {
      const supabase = getSupabase()

      const [projectResult, configResult] = await Promise.all([
        supabase
          .from('projects')
          .select('id, title, logo_url, bg_url, theme_color')
          .eq('id', eventId)
          .maybeSingle(),
        supabase
          .from('project_configs')
          .select('verify_mode, seat_label, enable_photo_live')
          .eq('project_id', eventId)
          .maybeSingle(),
      ])

      if (projectResult.error) throw projectResult.error
      if (configResult.error) throw configResult.error

      if (!projectResult.data) {
        setFetchError(te('notFound'))
        setProject(null)
        setConfig(null)
        return
      }

      setProject(projectResult.data)
      setConfig(
        configResult.data ?? {
          verify_mode: 'name_only',
          seat_label: '座位',
          enable_photo_live: false,
        }
      )
    } catch (err) {
      console.error('Failed to load event data:', formatSupabaseError(err), err)
      setFetchError(te('loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [eventId, te])

  useEffect(() => {
    loadEventData()
  }, [loadEventData])

  const resetForm = () => {
    setPageStatus('input')
    setName('')
    setPhoneLast4('')
    setCandidates([])
    setSelectedGuest(null)
    setErrorReason('not_found')
  }

  /**
   * @param {Record<string, unknown>} guest
   */
  const performCheckin = async (guest) => {
    const supabase = getSupabase()

    const { error } = await supabase.from('checkin_logs').insert({
      project_id: eventId,
      guest_id: guest.id,
    })

    if (error && !isDuplicateCheckinError(error)) {
      console.error('Check-in log insert failed:', formatSupabaseError(error), error)
      throw error
    }

    setSelectedGuest(guest)
    setPageStatus('success')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    const trimmedName = name.trim()
    const trimmedPhoneLast4 = phoneLast4.trim()

    if (!trimmedName) return
    if (verifyMode === 'name_phone' && trimmedPhoneLast4.length !== 4) return

    setSubmitting(true)

    try {
      const supabase = getSupabase()

      const { data: guests, error } = await supabase
        .from('guests')
        .select('id, name, company, seat_info, phone')
        .eq('project_id', eventId)
        .eq('name', trimmedName)

      if (error) throw error

      let matched = guests ?? []

      if (verifyMode === 'name_phone') {
        matched = matched.filter((guest) =>
          phoneMatchesLastFour(guest.phone, trimmedPhoneLast4)
        )
      }

      if (matched.length === 0) {
        setErrorReason('not_found')
        setPageStatus('error')
        return
      }

      if (matched.length === 1) {
        await performCheckin(matched[0])
        return
      }

      setCandidates(matched)
      setPageStatus('ambiguous')
    } catch (err) {
      console.error('Guest lookup failed:', formatSupabaseError(err), err)
      setErrorReason('system')
      setPageStatus('error')
    } finally {
      setSubmitting(false)
    }
  }

  /**
   * @param {Record<string, unknown>} guest
   */
  const handleSelectCandidate = async (guest) => {
    setSubmitting(true)

    try {
      await performCheckin(guest)
      setCandidates([])
    } catch (err) {
      console.error('Check-in failed:', formatSupabaseError(err), err)
      setErrorReason('system')
      setPageStatus('error')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-100">
        <div className="flex flex-col items-center gap-3">
          <div
            className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-current"
            style={{ borderTopColor: themeColor }}
          />
          <p className="text-sm text-slate-500">{tc('loading')}</p>
        </div>
      </div>
    )
  }

  if (fetchError || !project) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-100 px-6">
        <div className={`w-full max-w-sm p-8 text-center ${GLASS_CARD}`}>
          <p className="text-6xl">😔</p>
          <h1 className="mt-4 text-lg font-semibold text-slate-800">
            {fetchError || te('notFound')}
          </h1>
          <button
            type="button"
            onClick={loadEventData}
            className="mt-6 w-full rounded-xl px-4 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: themeColor }}
          >
            {tc('reload')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-dvh">
      {/* Full-screen background */}
      <div
        className="fixed inset-0 -z-10 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: project.bg_url
            ? `linear-gradient(rgba(0,0,0,0.35), rgba(0,0,0,0.35)), url(${project.bg_url})`
            : undefined,
          backgroundColor: project.bg_url ? undefined : '#ecfdf5',
        }}
        aria-hidden
      />

      {/* Language switcher — top right */}
      <div className="fixed top-4 right-4 z-40 sm:top-6 sm:right-6">
        <LanguageSwitcher locale={locale} onChange={handleLocaleChange} />
      </div>

      <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <header className="mb-6 text-center sm:mb-8">
          {project.logo_url && (
            <img
              src={project.logo_url}
              alt={project.title}
              className="mx-auto mb-4 h-14 w-auto object-contain drop-shadow-md sm:h-16"
            />
          )}
          <h1
            className="text-2xl font-bold tracking-tight text-white drop-shadow-sm sm:text-3xl"
            style={themeStyles}
          >
            {project.title}
          </h1>
          <p className="mt-1 text-sm text-white/85 sm:text-base">{te('welcome')}</p>
        </header>

        <main className="flex flex-1 flex-col justify-center pb-8">
          <div className={`p-6 sm:p-8 ${GLASS_CARD}`}>
            {pageStatus === 'input' && (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label
                    htmlFor="guest-name"
                    className="mb-1.5 block text-sm font-medium text-slate-700"
                  >
                    {te('name')}
                  </label>
                  <input
                    id="guest-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={te('namePlaceholder')}
                    autoComplete="name"
                    required
                    className={`w-full rounded-xl px-4 py-3 text-base text-slate-900 focus:ring-[var(--theme-color)] ${GLASS_INPUT}`}
                    style={{ '--theme-color': themeColor }}
                  />
                </div>

                {verifyMode === 'name_phone' && (
                  <div>
                    <label
                      htmlFor="phone-last4"
                      className="mb-1.5 block text-sm font-medium text-slate-700"
                    >
                      {te('phoneLast4')}
                    </label>
                    <input
                      id="phone-last4"
                      type="tel"
                      inputMode="numeric"
                      maxLength={4}
                      value={phoneLast4}
                      onChange={(e) =>
                        setPhoneLast4(e.target.value.replace(/\D/g, '').slice(0, 4))
                      }
                      placeholder={te('phonePlaceholder')}
                      autoComplete="off"
                      required
                      className={`w-full rounded-xl px-4 py-3 text-base tracking-widest text-slate-900 focus:ring-[var(--theme-color)] ${GLASS_INPUT}`}
                      style={{ '--theme-color': themeColor }}
                    />
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-xl px-4 py-3.5 text-base font-semibold text-white shadow-md transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ backgroundColor: themeColor }}
                >
                  {submitting ? te('submitting') : te('submit')}
                </button>
              </form>
            )}

            {pageStatus === 'success' && selectedGuest && (
              <div className="flex flex-col items-center py-4 text-center">
                <div
                  className="animate-checkmark-pop mb-6 flex h-20 w-20 items-center justify-center rounded-full"
                  style={{ backgroundColor: `${themeColor}20` }}
                >
                  <svg
                    className="h-10 w-10"
                    style={{ color: themeColor }}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path className="animate-checkmark-draw" d="M5 13l4 4L19 7" />
                  </svg>
                </div>

                <p className="text-lg text-slate-600">
                  {te('hello')}
                  <span className="font-semibold text-slate-900">{selectedGuest.name}</span>
                </p>

                <div
                  className="mt-6 w-full rounded-2xl border border-white/40 px-5 py-6 backdrop-blur-sm"
                  style={{ backgroundColor: `${themeColor}12` }}
                >
                  <p className="text-sm text-slate-500">
                    {te('yourSeatIs', { seatLabel })}
                  </p>
                  <p
                    className="mt-2 text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl"
                    style={{ color: themeColor }}
                  >
                    {selectedGuest.seat_info || tc('dash')}
                  </p>
                </div>

                {enablePhotoLive && (
                  <Link
                    href={`/event/${eventId}/live`}
                    className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 via-fuchsia-500 to-orange-400 px-4 py-3.5 text-base font-semibold text-white shadow-lg transition hover:opacity-90"
                  >
                    {te('photoLive')}
                  </Link>
                )}
              </div>
            )}

            {pageStatus === 'error' && (
              <div className="flex flex-col items-center py-6 text-center">
                <p className="text-5xl">{errorReason === 'not_found' ? '🔍' : '⚠️'}</p>
                <h2 className="mt-4 text-lg font-semibold text-slate-800">
                  {errorReason === 'not_found' ? te('errorNotFound') : te('errorSystem')}
                </h2>
                <p className="mt-2 text-sm text-slate-500">
                  {errorReason === 'not_found' ? te('errorContact') : te('errorSystemHint')}
                </p>
                {process.env.NODE_ENV === 'development' && errorReason === 'system' && (
                  <p className="mt-3 rounded-lg border border-amber-200/60 bg-amber-50/80 px-3 py-2 text-xs text-amber-800 backdrop-blur-sm">
                    {te('devRlsHint')}
                  </p>
                )}
                <button
                  type="button"
                  onClick={resetForm}
                  className="mt-8 w-full rounded-xl px-4 py-3 text-sm font-medium text-white transition hover:opacity-90"
                  style={{ backgroundColor: themeColor }}
                >
                  {te('retryInput')}
                </button>
              </div>
            )}
          </div>
        </main>
      </div>

      {pageStatus === 'ambiguous' && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 backdrop-blur-sm sm:items-center">
          <div
            className={`animate-slide-up w-full max-w-xl p-6 ${GLASS_CARD}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ambiguous-title"
          >
            <h2 id="ambiguous-title" className="text-lg font-semibold text-slate-900">
              {te('ambiguousTitle')}
            </h2>
            <p className="mt-1 text-sm text-slate-500">{te('ambiguousHint')}</p>

            <ul className="mt-4 max-h-64 space-y-2 overflow-y-auto">
              {candidates.map((guest) => (
                <li key={guest.id}>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => handleSelectCandidate(guest)}
                    className="flex w-full items-center justify-between rounded-xl border border-white/50 bg-white/40 px-4 py-3 text-left backdrop-blur-sm transition hover:shadow-md disabled:opacity-60"
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = `${themeColor}18`
                      e.currentTarget.style.borderColor = themeColor
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = ''
                      e.currentTarget.style.borderColor = ''
                    }}
                  >
                    <span className="font-medium text-slate-900">{guest.name}</span>
                    <span className="text-sm text-slate-500">
                      {guest.company || tc('dash')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={resetForm}
              disabled={submitting}
              className="mt-4 w-full rounded-xl border border-white/50 bg-white/40 px-4 py-2.5 text-sm text-slate-600 backdrop-blur-sm transition hover:bg-white/60 disabled:opacity-60"
            >
              {te('retryInput')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
