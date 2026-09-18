import type { Metadata, Viewport } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import RegisterSW from '@/components/RegisterSW'
import BottomNav from '@/components/BottomNav'
import { createClient } from '@/lib/supabase/server'
import { dubaiToday } from '@/lib/live-target'
import { Analytics } from '@vercel/analytics/next'

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
    apple: '/apple-touch-icon.png',
    icon: '/icon-192.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#000000',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

/** Today's service id, for the Home tab (dot + direct landing). One tiny
 *  query, in parallel with the page's own — the layout never waits on it
 *  after the first paint. Anything odd (no session, no table) → null. */
async function todayServiceId(): Promise<string | null> {
  try {
    const supabase = await createClient()
    const { data } = await supabase.from('services').select('id').eq('service_date', dubaiToday()).maybeSingle()
    return (data as { id: string } | null)?.id ?? null
  } catch {
    return null
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const today = await todayServiceId()
  return (
    <html lang="en" className={`${geist.variable} h-full`}>
      <body className="min-h-full font-sans antialiased">
        {/* Capture beforeinstallprompt synchronously before React hydrates */}
        <script dangerouslySetInnerHTML={{ __html: `window.__pwaPrompt=null;window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__pwaPrompt=e;});` }} />
        <RegisterSW />
        {children}
        <BottomNav homeHref={today ? `/services/${today}` : '/services'} hasServiceToday={!!today} />
        <Analytics />
      </body>
    </html>
  )
}
