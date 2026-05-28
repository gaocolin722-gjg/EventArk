import './globals.css'

export const metadata = {
  title: 'EventArk 會務方舟',
  description: '通用會務簽到系統',
}

export default function RootLayout({ children }) {
  return (
    <html lang="zh-Hant">
      <body className="antialiased">{children}</body>
    </html>
  )
}
