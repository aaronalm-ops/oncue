import type { Metadata, Viewport } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import RegisterSW from '@/components/RegisterSW'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' })

export const metadata: Metadata = {
  title: 'OnCue',
  description: 'Worship team setlist',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'OnCue',
  },
  icons: {
    apple: '/api/icon-192',
    icon: '/api/icon-192',
  },
}

export const viewport: Viewport = {
  themeColor: '#000000',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} h-full`}>
      <body className="min-h-full font-sans antialiased">
        {/* Capture beforeinstallprompt synchronously before React hydrates */}
        <script dangerouslySetInnerHTML={{ __html: `window.__pwaPrompt=null;window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__pwaPrompt=e;});` }} />
        <RegisterSW />
        {children}
      </body>
    </html>
  )
}
