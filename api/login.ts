// Vercel Serverless Function — sprawdza hasło i ustawia cookie.
// Hasło pochodzi ze zmiennej środowiskowej SITE_PASSWORD (ustaw w Vercel).
//
// Body: application/x-www-form-urlencoded (z formularza) — { password }.
export default function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end('Method Not Allowed');
    return;
  }

  const expected = process.env.SITE_PASSWORD;
  const password = (req.body && req.body.password) || '';

  if (expected && password === expected) {
    // 30 dni; HttpOnly = JS nie odczyta cookie; Secure = tylko po HTTPS.
    res.setHeader(
      'Set-Cookie',
      `auth=true; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`,
    );
    res.statusCode = 303; // 303 -> przeglądarka zrobi GET na Location
    res.setHeader('Location', '/');
    res.end();
    return;
  }

  // Złe hasło — wróć na formularz z flagą błędu.
  res.statusCode = 303;
  res.setHeader('Location', '/login.html?error=1');
  res.end();
}
