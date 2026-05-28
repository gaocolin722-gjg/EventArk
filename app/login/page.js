'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSupabase } from '@/lib/supabase'
import { GLASS_CARD, GLASS_INPUT } from '@/lib/translations'

const copy = {
  zh_TW: {
    title: 'EventArk 會務方舟',
    subtitle: '主辦方 SaaS 管理平台',
    login: '登錄',
    register: '註冊',
    email: '工作郵箱',
    emailPh: 'you@company.com',
    password: '密碼',
    passwordPh: '至少 6 位字符',
    submitLogin: '登錄管理後台',
    submitRegister: '創建主辦方賬戶',
    switchToRegister: '還沒有賬戶？立即註冊',
    switchToLogin: '已有賬戶？返回登錄',
    checkEmail: '註冊成功！請查收郵箱確認信後登錄。',
    errorGeneric: '操作失敗，請稍後重試',
  },
  zh_CN: {
    title: 'EventArk 会务方舟',
    subtitle: '主办方 SaaS 管理平台',
    login: '登录',
    register: '注册',
    email: '工作邮箱',
    emailPh: 'you@company.com',
    password: '密码',
    passwordPh: '至少 6 位字符',
    submitLogin: '登录管理后台',
    submitRegister: '创建主办方账户',
    switchToRegister: '还没有账户？立即注册',
    switchToLogin: '已有账户？返回登录',
    checkEmail: '注册成功！请查收邮箱确认信后登录。',
    errorGeneric: '操作失败，请稍后重试',
  },
  en: {
    title: 'EventArk',
    subtitle: 'Organizer SaaS Console',
    login: 'Sign in',
    register: 'Sign up',
    email: 'Work email',
    emailPh: 'you@company.com',
    password: 'Password',
    passwordPh: 'At least 6 characters',
    submitLogin: 'Sign in to console',
    submitRegister: 'Create organizer account',
    switchToRegister: 'No account? Register now',
    switchToLogin: 'Have an account? Sign in',
    checkEmail: 'Registration successful! Please check your email to confirm.',
    errorGeneric: 'Something went wrong. Please try again.',
  },
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-emerald-600" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [locale, setLocale] = useState('zh_TW')

  const t = copy[locale] || copy.zh_TW

  useEffect(() => {
    const supabase = getSupabase()
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        const redirect = searchParams.get('redirect') || '/admin'
        router.replace(redirect)
      }
    })
  }, [router, searchParams])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')

    const trimmedEmail = email.trim()
    const trimmedPassword = password.trim()

    if (!trimmedEmail || trimmedPassword.length < 6) {
      setError(t.errorGeneric)
      setLoading(false)
      return
    }

    try {
      const supabase = getSupabase()

      if (mode === 'register') {
        const { error: signUpError } = await supabase.auth.signUp({
          email: trimmedEmail,
          password: trimmedPassword,
          options: {
            emailRedirectTo: `${window.location.origin}/admin`,
          },
        })
        if (signUpError) throw signUpError
        setMessage(t.checkEmail)
        setMode('login')
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password: trimmedPassword,
        })
        if (signInError) throw signInError
        const redirect = searchParams.get('redirect') || '/admin'
        router.push(redirect)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errorGeneric)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-gradient-to-br from-emerald-100 via-white to-slate-100 px-4 py-12">
      <div className="absolute top-4 right-4">
        <select
          value={locale}
          onChange={(e) => setLocale(e.target.value)}
          className="rounded-lg border border-white/40 bg-white/60 px-2 py-1 text-xs backdrop-blur-sm"
        >
          <option value="zh_TW">繁體</option>
          <option value="zh_CN">简体</option>
          <option value="en">EN</option>
        </select>
      </div>

      <div className={`w-full max-w-md p-8 ${GLASS_CARD}`}>
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-slate-900">{t.title}</h1>
          <p className="mt-1 text-sm text-slate-500">{t.subtitle}</p>
        </div>

        <div className="mb-6 flex rounded-xl border border-white/40 bg-white/40 p-1 backdrop-blur-sm">
          {['login', 'register'].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m)
                setError('')
                setMessage('')
              }}
              className={`flex-1 rounded-lg py-2 text-sm font-medium transition ${
                mode === m
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {m === 'login' ? t.login : t.register}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
              {t.email}
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t.emailPh}
              required
              autoComplete="email"
              className={`w-full rounded-xl px-4 py-3 text-sm text-slate-900 focus:ring-emerald-500/30 ${GLASS_INPUT}`}
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">
              {t.password}
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t.passwordPh}
              required
              minLength={6}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              className={`w-full rounded-xl px-4 py-3 text-sm text-slate-900 focus:ring-emerald-500/30 ${GLASS_INPUT}`}
            />
          </div>

          {error && (
            <p className="rounded-lg border border-red-200/60 bg-red-50/80 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
          {message && (
            <p className="rounded-lg border border-emerald-200/60 bg-emerald-50/80 px-3 py-2 text-sm text-emerald-800">
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-emerald-700 disabled:opacity-60"
          >
            {loading ? '…' : mode === 'login' ? t.submitLogin : t.submitRegister}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login')
            setError('')
            setMessage('')
          }}
          className="mt-4 w-full text-center text-sm text-emerald-700 hover:underline"
        >
          {mode === 'login' ? t.switchToRegister : t.switchToLogin}
        </button>
      </div>
    </div>
  )
}
