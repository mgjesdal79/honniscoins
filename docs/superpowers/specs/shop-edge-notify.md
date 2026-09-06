# Shop epost-varsling – edge-funksjon `notify` (deployes separat)

Legg til i `clever-function` (Deno). Env: `RESEND_API_KEY`, valgfritt `NOTIFY_FROM`.

```ts
if (body.action === 'notify') {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key || !body.to) return new Response(JSON.stringify({ ok: false }), { headers });
  const html = `Ny kjøpsforespørsel: <b>${body.title}</b> (${body.price} coins).` +
    (body.link ? ` <a href="${body.link}">${body.link}</a>` : '');
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: Deno.env.get('NOTIFY_FROM') || 'Honniscoins <onboarding@resend.dev>',
      to: body.to, subject: `Honniscoins: ${body.title}`, html,
    }),
  });
  return new Response(JSON.stringify({ ok: true }), { headers });
}
```
