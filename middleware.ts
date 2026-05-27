// Vercel Edge Middleware — chroni cały site hasłem.
// Działa dla projektów statycznych (nie tylko Next.js).
//
// Pomija: /login.html (formularz), /api/login (sprawdzanie hasła), favicon.
// Wszystko inne wymaga cookie `auth=true`, inaczej -> redirect na /login.html.
export const config = {
  matcher: ['/((?!api/login|login\\.html|favicon\\.ico).*)'],
};

export default function middleware(request: Request) {
  const cookie = request.headers.get('cookie') || '';
  const authed = cookie
    .split(';')
    .some((c) => c.trim() === 'auth=true');

  if (authed) {
    // Zalogowany — przepuść żądanie dalej.
    return;
  }

  // Brak ważnego cookie — przekieruj na ekran logowania.
  const loginUrl = new URL('/login.html', request.url);
  return Response.redirect(loginUrl, 307);
}
