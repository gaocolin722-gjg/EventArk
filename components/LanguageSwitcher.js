'use client'

import { LOCALE_OPTIONS } from '@/lib/translations'

/**
 * @param {{ locale: import('@/lib/translations').Locale; onChange: (locale: import('@/lib/translations').Locale) => void; className?: string }} props
 */
export default function LanguageSwitcher({ locale, onChange, className = '' }) {
  return (
    <select
      value={locale}
      onChange={(e) => onChange(/** @type {import('@/lib/translations').Locale} */ (e.target.value))}
      aria-label="Language"
      className={`rounded-lg border border-white/40 bg-white/60 px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm backdrop-blur-sm outline-none transition hover:bg-white/80 focus:ring-2 focus:ring-white/50 ${className}`}
    >
      {LOCALE_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}
