import { NextResponse, type NextRequest } from 'next/server'

// Cheap gate: bounce visitors without a session cookie to the right login page.
// Full token + role checks happen in requireWebUser / requireAppUser and every API route.
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  const hasSession = req.cookies.has('hc_session')
  if (hasSession) return NextResponse.next()
  const login = pathname.startsWith('/m') ? '/m/login' : '/login'
  const url = req.nextUrl.clone()
  url.pathname = login
  url.search = pathname === '/' || pathname === '/m' ? '' : `?next=${encodeURIComponent(pathname)}`
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/((?!api|_next|login|m/login|feedback|logo.svg|manifest.webmanifest|favicon.ico|icons).*)'],
}
