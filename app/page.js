import Link from 'next/link'

export default function HomePage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-br from-emerald-50 to-slate-100 px-6 text-center">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">EventArk 會務方舟</h1>
      <p className="mt-3 max-w-md text-slate-500">
        多租戶會務簽到 SaaS 系統。主辦方登錄後台管理活動，賓客掃碼簽到。
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-4">
        <Link
          href="/login"
          className="rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white shadow-md hover:bg-emerald-700"
        >
          主辦方登錄
        </Link>
        <Link
          href="/admin"
          className="rounded-xl border border-white/50 bg-white/60 px-6 py-3 text-sm font-medium text-slate-700 backdrop-blur-sm hover:bg-white/80"
        >
          管理大廳
        </Link>
      </div>
    </div>
  )
}
