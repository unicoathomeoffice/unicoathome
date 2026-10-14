import { NextResponse, type NextRequest } from 'next/server'

// Cheap gate: bounce visitors without a session cookie to the right login page.
// Full token + role checks happen in requireWebUser / requireAppUser and every API route.
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (pathname === '/') return NextResponse.next() // public booking page
  if (pathname.startsWith('/my')) {
    // patient portal: its own cookie and login page
    if (req.cookies.has('hc_patient')) return NextResponse.next()
    const url = req.nextUrl.clone()
    url.pathname = '/my/login'
    url.search = pathname === '/my' ? '' : `?next=${encodeURIComponent(pathname)}`
    return NextResponse.redirect(url)
  }
  const hasSession = req.cookies.has('hc_session')
  if (hasSession) return NextResponse.next()
  const login = pathname.startsWith('/m') ? '/m/login' : '/login'
  const url = req.nextUrl.clone()
  url.pathname = login
  url.search = pathname === '/m' ? '' : `?next=${encodeURIComponent(pathname)}`
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/((?!api|_next|login|m/login|m/forgot|feedback|privacy|terms|join|my/login|my/register|my/complete|logo.svg|manifest.webmanifest|favicon.ico|icons).*)'],
}
