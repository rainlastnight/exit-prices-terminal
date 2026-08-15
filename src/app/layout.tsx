import type { Metadata } from 'next'
import { JetBrains_Mono } from 'next/font/google'
import './globals.css'

// One typeface for the entire app. Weight, size and case carry all the
// hierarchy — that constraint is the brand, and it keeps every numeric column
// aligned by construction.
const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Exit Prices',
  description: 'Wallet holdings and exit targets across Ethereum and Robinhood Chain',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={mono.variable}>
      <body>{children}</body>
    </html>
  )
}
