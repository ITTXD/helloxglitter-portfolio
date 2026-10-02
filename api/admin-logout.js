/**
 * api/admin-logout.js
 *
 * Handles GET /admin and GET /admin/ on Vercel.
 * Clears the admin session cookie and redirects to the customer storefront.
 * This ensures that anyone who visits /admin/ is always sent back to the
 * customer page — even if they previously logged in as admin.
 */
module.exports = (req, res) => {
  res.writeHead(302, {
    'Location': '/',
    'Set-Cookie': 'admin_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
    'Cache-Control': 'no-store',
  });
  res.end();
};
