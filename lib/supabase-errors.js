/**
 * Supabase / PostgREST errors are plain objects, not Error instances —
 * console.error(err) often prints `{}`. Use this helper for readable logs.
 *
 * @param {unknown} error
 */
export function formatSupabaseError(error) {
  if (!error) return 'Unknown error'

  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  if (typeof error === 'object') {
    const e = /** @type {{ message?: string; code?: string; details?: string; hint?: string }} */ (
      error
    )
    const parts = [e.message, e.code && `code=${e.code}`, e.details, e.hint].filter(Boolean)
    if (parts.length > 0) return parts.join(' | ')

    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }

  return String(error)
}

/**
 * @param {unknown} error
 */
export function isPermissionError(error) {
  if (!error || typeof error !== 'object') return false
  const e = /** @type {{ code?: string; message?: string }} */ (error)
  return (
    e.code === '42501' ||
    e.code === 'PGRST301' ||
    (e.message?.toLowerCase().includes('permission') ?? false) ||
    (e.message?.toLowerCase().includes('row-level security') ?? false)
  )
}
