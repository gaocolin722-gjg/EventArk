'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { getSupabase } from '@/lib/supabase'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import {
  DEFAULT_LOCALE,
  EXCEL_HEADERS,
  EXCEL_SAMPLE_ROWS,
  GLASS_CARD,
  GLASS_INPUT,
  GLASS_NAV,
  t,
} from '@/lib/translations'

/** @typedef {import('@/lib/translations').Locale} Locale */

const CHUNK_SIZE = 200
const LOCALE_STORAGE_KEY = 'eventark_locale'

/**
 * @param {{ plan_type?: string; expires_at?: string | null } | null} sub
 */
function isProActive(sub) {
  if (!sub || sub.plan_type !== 'pro') return false
  if (!sub.expires_at) return true
  return new Date(sub.expires_at) > new Date()
}

/**
 * @param {unknown} value
 */
function cellValue(value) {
  if (value == null) return ''
  if (typeof value === 'object' && value !== null && 'text' in value) {
    return String(/** @type {{ text: unknown }} */ (value).text).trim()
  }
  if (typeof value === 'object' && value !== null && 'result' in value) {
    return String(/** @type {{ result: unknown }} */ (value).result).trim()
  }
  return String(value).trim()
}

/**
 * @param {string[]} headers
 * @param {string} verifyMode
 */
function validateHeaders(headers, verifyMode) {
  const normalized = headers.map((h) => cellValue(h))
  const required = ['姓名', '座位信息']

  if (verifyMode === 'name_phone') {
    required.push('手機後4位')
  }

  const missing = required.filter((field) => !normalized.includes(field))
  if (missing.length > 0) {
    return { valid: false }
  }

  const indexMap = {}
  for (const field of EXCEL_HEADERS) {
    const idx = normalized.indexOf(field)
    if (idx !== -1) indexMap[field] = idx
  }

  return { valid: true, indexMap }
}

/**
 * @param {import('exceljs').Row} row
 * @param {Record<string, number>} indexMap
 */
function parseGuestRow(row, indexMap) {
  const values = []
  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    values[colNumber - 1] = cellValue(cell.value)
  })

  const name = values[indexMap['姓名']] ?? ''
  const phone = indexMap['手機後4位'] != null ? values[indexMap['手機後4位']] ?? '' : ''
  const seatInfo = values[indexMap['座位信息']] ?? ''
  const company = indexMap['公司/部門'] != null ? values[indexMap['公司/部門']] ?? '' : ''

  if (!name && !phone && !seatInfo && !company) {
    return null
  }

  return { name, phone, seat_info: seatInfo, company }
}

/**
 * @param {Locale} locale
 */
async function downloadTemplate(locale) {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(t(locale, 'excel', 'sheetName'))

  sheet.addRow(EXCEL_HEADERS)
  EXCEL_SAMPLE_ROWS.forEach((row) => sheet.addRow(row))

  sheet.columns = [{ width: 14 }, { width: 14 }, { width: 22 }, { width: 18 }]
  sheet.getRow(1).font = { bold: true }
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFEFF6FF' },
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = t(locale, 'excel', 'fileName')
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * @param {File} file
 * @param {string} verifyMode
 * @param {Locale} locale
 */
async function parseExcelFile(file, verifyMode, locale) {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  const buffer = await file.arrayBuffer()
  await workbook.xlsx.load(buffer)

  const sheet = workbook.worksheets[0]
  if (!sheet || sheet.rowCount < 1) {
    throw new Error(t(locale, 'admin', 'templateError'))
  }

  const headerRow = sheet.getRow(1)
  const headers = []
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = cellValue(cell.value)
  })

  const validation = validateHeaders(headers, verifyMode)
  if (!validation.valid) {
    throw new Error(t(locale, 'admin', 'templateError'))
  }

  const guests = []
  for (let i = 2; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i)
    const guest = parseGuestRow(row, validation.indexMap)
    if (!guest) continue

    if (!guest.name || !guest.seat_info) {
      throw new Error(t(locale, 'admin', 'rowIncomplete', { row: i }))
    }

    if (verifyMode === 'name_phone') {
      if (!guest.phone || guest.phone.length !== 4) {
        throw new Error(t(locale, 'admin', 'rowPhoneIncomplete', { row: i }))
      }
    }

    guests.push(guest)
  }

  if (guests.length === 0) {
    throw new Error(t(locale, 'admin', 'noValidData'))
  }

  return guests
}

function Toast({ message, type, onClose, closeLabel }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000)
    return () => clearTimeout(timer)
  }, [onClose])

  const styles =
    type === 'success'
      ? 'border-green-200/60 bg-green-50/90 text-green-800'
      : 'border-red-200/60 bg-red-50/90 text-red-800'

  return (
    <div
      className={`fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-3 rounded-xl border px-4 py-3 shadow-xl shadow-black/5 backdrop-blur-md ${styles}`}
      role="status"
    >
      <span className="text-lg">{type === 'success' ? '✅' : '⚠️'}</span>
      <p className="text-sm font-medium">{message}</p>
      <button
        type="button"
        onClick={onClose}
        className="ml-auto text-current opacity-60 hover:opacity-100"
        aria-label={closeLabel}
      >
        ✕
      </button>
    </div>
  )
}

function DashboardPanel({
  locale,
  projectTitle,
  totalGuests,
  checkedInCount,
  checkinRate,
  importing,
  onRefresh,
}) {
  const ta = (key, vars) => t(locale, 'admin', key, vars)

  return (
    <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 to-green-700 p-6 shadow-xl shadow-emerald-600/20">
      <p className="text-xs font-semibold tracking-wide text-emerald-100 uppercase">
        {ta('brand')}
      </p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-white lg:text-3xl">
        {projectTitle}
      </h1>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-white/20 bg-white/10 px-5 py-4 backdrop-blur-sm">
          <p className="text-xs font-medium tracking-wide text-emerald-100 uppercase">
            {ta('totalGuests')}
          </p>
          <p className="mt-2 text-3xl font-bold text-white">{totalGuests}</p>
          <p className="mt-1 text-xs text-emerald-100">{ta('totalGuestsHint')}</p>
        </div>

        <div className="rounded-xl border border-white/20 bg-white/10 px-5 py-4 backdrop-blur-sm">
          <p className="text-xs font-medium tracking-wide text-emerald-100 uppercase">
            {ta('checkedIn')}
          </p>
          <p className="mt-2 text-3xl font-bold text-white">{checkedInCount}</p>
          <p className="mt-1 text-xs text-emerald-100">{ta('checkedInHint')}</p>
        </div>

        <div className="rounded-xl border border-white/20 bg-white/10 px-5 py-4 backdrop-blur-sm">
          <p className="text-xs font-medium tracking-wide text-emerald-100 uppercase">
            {ta('checkinRate')}
          </p>
          <p className="mt-2 text-3xl font-bold text-white">{checkinRate}%</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/20">
            <div
              className="h-full rounded-full bg-white transition-all duration-500"
              style={{ width: `${checkinRate}%` }}
            />
          </div>
        </div>

        <div className="flex flex-col justify-center rounded-xl border border-white/20 bg-white/10 px-5 py-4 backdrop-blur-sm">
          <p className="text-xs font-medium tracking-wide text-emerald-100 uppercase">
            {ta('notArrived')}
          </p>
          <p className="mt-2 text-3xl font-bold text-white">
            {Math.max(totalGuests - checkedInCount, 0)}
          </p>
          <button
            type="button"
            onClick={onRefresh}
            disabled={importing}
            className="mt-2 text-left text-xs text-emerald-100 underline-offset-2 hover:text-white hover:underline disabled:opacity-60"
          >
            {ta('refreshStats')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AdminProjectPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = /** @type {string} */ (params.projectId)

  const fileInputRef = useRef(null)
  const [locale, setLocale] = useState(/** @type {Locale} */ (DEFAULT_LOCALE))
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState('')
  const [isPro, setIsPro] = useState(false)

  const [projectTitle, setProjectTitle] = useState('')
  const [config, setConfig] = useState({
    verify_mode: 'name_only',
    seat_label: '座位',
    enable_photo_live: false,
  })
  const [configSaving, setConfigSaving] = useState(false)

  const [totalGuests, setTotalGuests] = useState(0)
  const [checkedInCount, setCheckedInCount] = useState(0)

  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 })
  const [dragOver, setDragOver] = useState(false)
  const [toast, setToast] = useState(null)

  const ta = useCallback((key, vars) => t(locale, 'admin', key, vars), [locale])
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

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type })
  }, [])

  const loadStats = useCallback(async () => {
    const supabase = getSupabase()

    const [guestsResult, checkinResult] = await Promise.all([
      supabase
        .from('guests')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', projectId),
      supabase
        .from('checkin_logs')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', projectId),
    ])

    if (guestsResult.error) throw guestsResult.error
    if (checkinResult.error) throw checkinResult.error

    setTotalGuests(guestsResult.count ?? 0)
    setCheckedInCount(checkinResult.count ?? 0)
  }, [projectId])

  const loadPageData = useCallback(async () => {
    if (!projectId) {
      setFetchError(ta('invalidId'))
      setLoading(false)
      return
    }

    setLoading(true)
    setFetchError('')

    try {
      const supabase = getSupabase()

      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser()

      if (authError || !user) {
        router.replace('/login')
        return
      }

      const [projectResult, configResult, subResult] = await Promise.all([
        supabase
          .from('projects')
          .select('id, title, user_id')
          .eq('id', projectId)
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase
          .from('project_configs')
          .select('verify_mode, seat_label, enable_photo_live')
          .eq('project_id', projectId)
          .maybeSingle(),
        supabase
          .from('user_subscriptions')
          .select('plan_type, expires_at')
          .eq('user_id', user.id)
          .maybeSingle(),
      ])

      if (projectResult.error) throw projectResult.error
      if (configResult.error) throw configResult.error

      if (!projectResult.data) {
        setFetchError(ta('unauthorized'))
        return
      }

      setIsPro(isProActive(subResult.data))

      setProjectTitle(projectResult.data.title)
      setConfig({
        verify_mode: configResult.data?.verify_mode ?? 'name_only',
        seat_label: configResult.data?.seat_label ?? '座位',
        enable_photo_live: Boolean(configResult.data?.enable_photo_live),
      })

      await loadStats()
    } catch (err) {
      console.error('Failed to load admin page:', err)
      setFetchError(ta('loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [projectId, loadStats, ta, router])

  useEffect(() => {
    loadPageData()
  }, [loadPageData])

  const saveConfig = async (nextConfig) => {
    if (nextConfig.enable_photo_live && !isPro) {
      showToast(ta('photoLiveProOnly'), 'error')
      return
    }

    setConfigSaving(true)

    try {
      const supabase = getSupabase()

      const { error } = await supabase.from('project_configs').upsert(
        {
          project_id: projectId,
          verify_mode: nextConfig.verify_mode,
          seat_label: nextConfig.seat_label.trim(),
          enable_photo_live: nextConfig.enable_photo_live,
        },
        { onConflict: 'project_id' }
      )

      if (error) throw error
      showToast(ta('configSaved'))
    } catch (err) {
      console.error('Failed to save config:', err)
      showToast(ta('configSaveFailed'), 'error')
    } finally {
      setConfigSaving(false)
    }
  }

  const handleConfigChange = (field, value) => {
    if (field === 'enable_photo_live' && value && !isPro) {
      showToast(ta('photoLiveProOnly'), 'error')
      return
    }
    const nextConfig = { ...config, [field]: value }
    setConfig(nextConfig)
    saveConfig(nextConfig)
  }

  const handleDownloadTemplate = async () => {
    try {
      await downloadTemplate(locale)
    } catch (err) {
      console.error('Template download failed:', err)
      showToast(ta('templateDownloadFailed'), 'error')
    }
  }

  const importGuests = async (file) => {
    if (!file.name.endsWith('.xlsx')) {
      showToast(ta('xlsxRequired'), 'error')
      return
    }

    setImporting(true)
    setImportProgress({ current: 0, total: 0 })

    try {
      const guests = await parseExcelFile(file, config.verify_mode, locale)
      const supabase = getSupabase()
      const total = guests.length

      setImportProgress({ current: 0, total })

      for (let i = 0; i < guests.length; i += CHUNK_SIZE) {
        const chunk = guests.slice(i, i + CHUNK_SIZE).map((guest) => ({
          project_id: projectId,
          name: guest.name.trim(),
          phone: guest.phone.trim(),
          seat_info: guest.seat_info.trim(),
          company: guest.company.trim(),
        }))

        const { error } = await supabase.from('guests').insert(chunk)
        if (error) throw error

        const current = Math.min(i + CHUNK_SIZE, total)
        setImportProgress({ current, total })
      }

      await loadStats()
      showToast(ta('importSuccess', { total }))
    } catch (err) {
      console.error('Import failed:', err)
      const message = err instanceof Error ? err.message : ta('importFailed')
      showToast(message, 'error')
    } finally {
      setImporting(false)
      setImportProgress({ current: 0, total: 0 })
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0]
    if (file) importGuests(file)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) importGuests(file)
  }

  const handleRefreshStats = async () => {
    try {
      await loadStats()
      showToast(ta('statsRefreshed'))
    } catch (err) {
      console.error('Failed to refresh stats:', err)
      showToast(ta('statsRefreshFailed'), 'error')
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-slate-100 to-emerald-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-emerald-600" />
          <p className="text-sm text-slate-500">{tc('loading')}</p>
        </div>
      </div>
    )
  }

  if (fetchError) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-slate-100 to-emerald-50 px-6">
        <div className={`w-full max-w-md p-8 text-center ${GLASS_CARD}`}>
          <p className="text-5xl">😔</p>
          <h1 className="mt-4 text-lg font-semibold text-slate-900">{fetchError}</h1>
          <button
            type="button"
            onClick={loadPageData}
            className="mt-6 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-700"
          >
            {tc('reload')}
          </button>
        </div>
      </div>
    )
  }

  const progressPercent =
    importProgress.total > 0
      ? Math.round((importProgress.current / importProgress.total) * 100)
      : 0

  const checkinRate =
    totalGuests > 0 ? Math.round((checkedInCount / totalGuests) * 100) : 0

  return (
    <div className="min-h-dvh bg-gradient-to-br from-slate-100 via-white to-emerald-50">
      {/* Top nav — glass */}
      <header className={`sticky top-0 z-30 ${GLASS_NAV}`}>
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="min-w-0 flex-1 md:hidden">
            <Link href="/admin" className="text-xs text-emerald-600 hover:underline">
              {ta('backToLobby')}
            </Link>
            <p className="truncate text-xs font-semibold text-emerald-700 uppercase">
              {ta('brand')}
            </p>
            <h1 className="truncate text-lg font-bold text-slate-900">{projectTitle}</h1>
          </div>
          <div className="hidden md:block">
            <Link href="/admin" className="text-sm text-emerald-600 hover:underline">
              {ta('backToLobby')}
            </Link>
            <p className="text-sm font-semibold text-emerald-700">{ta('brand')}</p>
          </div>
          <LanguageSwitcher locale={locale} onChange={handleLocaleChange} />
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {/* Mobile dashboard — shown above steps on small screens */}
        <div className="mb-6 md:hidden">
          <DashboardPanel
            locale={locale}
            projectTitle={projectTitle}
            totalGuests={totalGuests}
            checkedInCount={checkedInCount}
            checkinRate={checkinRate}
            importing={importing}
            onRefresh={handleRefreshStats}
          />
        </div>

        <div className="grid gap-6 md:grid-cols-5 md:gap-8">
          {/* Left column — steps */}
          <main className="space-y-6 md:col-span-3">
            {/* Step 1 */}
            <section className={`p-6 ${GLASS_CARD}`}>
              <div className="mb-5 flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">
                  1
                </span>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-slate-900">{ta('step1Title')}</h2>
                  <p className="text-sm text-slate-500">{ta('step1Hint')}</p>
                </div>
                {configSaving && (
                  <span className="ml-auto shrink-0 text-xs text-slate-400">{ta('saving')}</span>
                )}
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="verify-mode"
                    className="mb-1.5 block text-sm font-medium text-slate-700"
                  >
                    {ta('verifyMode')}
                  </label>
                  <select
                    id="verify-mode"
                    value={config.verify_mode}
                    disabled={configSaving || importing}
                    onChange={(e) => handleConfigChange('verify_mode', e.target.value)}
                    className={`w-full rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:ring-emerald-500/30 ${GLASS_INPUT}`}
                  >
                    <option value="name_only">{ta('verifyNameOnly')}</option>
                    <option value="name_phone">{ta('verifyNamePhone')}</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="seat-label"
                    className="mb-1.5 block text-sm font-medium text-slate-700"
                  >
                    {ta('seatLabel')}
                  </label>
                  <input
                    id="seat-label"
                    type="text"
                    value={config.seat_label}
                    disabled={configSaving || importing}
                    onChange={(e) => setConfig({ ...config, seat_label: e.target.value })}
                    onBlur={() => saveConfig(config)}
                    placeholder={ta('seatLabelPlaceholder')}
                    className={`w-full rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:ring-emerald-500/30 ${GLASS_INPUT}`}
                  />
                </div>

                <div className="sm:col-span-2">
                  <div className="flex items-center justify-between rounded-xl border border-white/40 bg-white/40 px-4 py-3 backdrop-blur-sm">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{ta('photoLive')}</p>
                      <p className="text-xs text-slate-500">{ta('photoLiveHint')}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={config.enable_photo_live}
                      disabled={configSaving || importing}
                      onClick={() =>
                        handleConfigChange('enable_photo_live', !config.enable_photo_live)
                      }
                      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                        config.enable_photo_live ? 'bg-emerald-600' : 'bg-slate-300'
                      } disabled:opacity-60`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
                          config.enable_photo_live ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {/* Step 2 */}
            <section className={`p-6 ${GLASS_CARD}`}>
              <div className="mb-5 flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">
                  2
                </span>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{ta('step2Title')}</h2>
                  <p className="text-sm text-slate-500">{ta('step2Hint')}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleDownloadTemplate}
                disabled={importing}
                className="inline-flex items-center gap-2 rounded-xl border border-white/50 bg-white/50 px-5 py-2.5 text-sm font-medium text-slate-700 shadow-sm backdrop-blur-sm transition hover:bg-white/70 disabled:opacity-60"
              >
                <span>📥</span>
                {ta('downloadTemplate')}
              </button>

              <div className="mt-4 overflow-x-auto rounded-xl border border-white/40">
                <table className="w-full min-w-[480px] text-left text-sm">
                  <thead className="bg-white/50 text-xs tracking-wide text-slate-500 uppercase backdrop-blur-sm">
                    <tr>
                      {EXCEL_HEADERS.map((header) => (
                        <th key={header} className="px-4 py-2.5 font-medium">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/30">
                    {EXCEL_SAMPLE_ROWS.map((row, i) => (
                      <tr key={i} className="bg-white/30 text-slate-700">
                        {row.map((cell, j) => (
                          <td key={j} className="px-4 py-2.5">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Step 3 */}
            <section className={`p-6 ${GLASS_CARD}`}>
              <div className="mb-5 flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">
                  3
                </span>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{ta('step3Title')}</h2>
                  <p className="text-sm text-slate-500">
                    {ta('step3Hint', { chunk: CHUNK_SIZE })}
                    {config.verify_mode === 'name_phone' && ta('step3PhoneRequired')}
                  </p>
                </div>
              </div>

              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={`relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 transition ${
                  dragOver
                    ? 'border-emerald-500 bg-emerald-50/60'
                    : 'border-white/50 bg-white/30 hover:border-emerald-300/60'
                } ${importing ? 'pointer-events-none opacity-70' : ''}`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={handleFileSelect}
                  className="hidden"
                  disabled={importing}
                />

                {importing ? (
                  <div className="w-full max-w-md text-center">
                    <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-emerald-600" />
                    <p className="text-sm font-medium text-slate-700">
                      {ta('importing', {
                        current: importProgress.current,
                        total: importProgress.total,
                      })}
                    </p>
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/50">
                      <div
                        className="h-full rounded-full bg-emerald-600 transition-all duration-300"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-slate-500">{progressPercent}%</p>
                  </div>
                ) : (
                  <>
                    <p className="text-4xl">📂</p>
                    <p className="mt-3 text-sm font-medium text-slate-700">{ta('dropHint')}</p>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="mt-4 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-700"
                    >
                      {ta('selectFile')}
                    </button>
                    <p className="mt-3 text-xs text-slate-400">{ta('xlsxOnly')}</p>
                  </>
                )}
              </div>
            </section>
          </main>

          {/* Right column — dashboard (tablet & desktop) */}
          <aside className="hidden md:col-span-2 md:block">
            <div className="sticky top-24">
              <DashboardPanel
                locale={locale}
                projectTitle={projectTitle}
                totalGuests={totalGuests}
                checkedInCount={checkedInCount}
                checkinRate={checkinRate}
                importing={importing}
                onRefresh={handleRefreshStats}
              />
            </div>
          </aside>
        </div>
      </div>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
          closeLabel={tc('close')}
        />
      )}
    </div>
  )
}
