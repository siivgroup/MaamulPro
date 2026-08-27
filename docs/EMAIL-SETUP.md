# Branded transactional email

All platform mail uses the shared renderer and the existing Resend account. Security mail always identifies MaamulPro; reports/digests use the company's saved name and approved public branding upload. Missing or unsuitable logos fall back to MaamulPro. No recipient photos, private blob URLs, tracking pixels, or credentials are embedded.

## Apply this update

1. Deploy the frontend asset `/assets/images/email-logo.png`. It is the original PNG extracted from the existing MaamulPro artwork, not the starter logo.
2. In `backend`, run `node scripts/apply-central-migrations.mjs` to inspect, then `node scripts/apply-central-migrations.mjs --apply` to apply the additive migrations. This does not reset databases. The email migration adds account binding and expires pending legacy password-reset/email-change codes; affected users request a new code. Apply before starting the updated backend, with old instances drained so they cannot issue unbound codes.
3. Generate the central Prisma client/build the backend and deploy backend/frontend together. Keep the existing `RESEND_API_KEY`, `RESEND_FROM`, and `TENANT_BASE_DOMAIN`. Optional `EMAIL_PUBLIC_ORIGIN` must be an HTTPS root or admin origin of that base domain; it defaults to `https://admin.<TENANT_BASE_DOMAIN>`. Optional `EMAIL_SUPPORT_ADDRESS` is a real monitored support/reply-to mailbox; omit it rather than inventing an address.
4. In Resend's sending-domain configuration, keep **open tracking and click tracking disabled**. This is a provider setting, not an HTML switch. See [Resend tracking](https://resend.com/docs/dashboard/domains/tracking).
5. Send only to approved test inboxes before release. Verify HTML, plain text, logo blocking, CSV attachments, code expiry and recovery in Gmail and Outlook. A local preview does not prove rendering in those clients.

The sender remains `RESEND_FROM`; company branding never impersonates a company's sending domain. Company logos must be under that company's `branding` path in the configured Vercel Blob store and publicly readable. Unsupported/private/external logos fall back; the mail renderer never downloads arbitrary URLs.

## Sender authentication and inbox logo

- Verify the exact sending domain in Resend using the SPF and DKIM records Resend provides. Do not add a second SPF record or overwrite unrelated sending-service records.
- Review every legitimate sender before enforcing DMARC. BIMI needs a suitable enforced DMARC policy (`quarantine` or `reject`, at 100%). Audit alignment first; stricter DNS changes can disrupt unrelated mail.
- Gmail requires a qualifying VMC/CMC certificate. Certificate eligibility, fees, identity checks and purchase approval are separate operator work. Outlook currently does not support BIMI; inbox avatars cannot be guaranteed across providers.
- The current website SVG embeds a raster image and is **not** a BIMI SVG Tiny P/S logo. Obtain compliant vector artwork and the certificate before publishing the final HTTPS asset and `default._bimi` TXT record. Do not publish example certificate URLs.
- Validate the resulting records with the certificate issuer/provider and inspect actual message authentication headers. This change does not buy certificates, publish DNS, or claim activation.

Sources: [Resend BIMI requirements](https://resend.com/docs/dashboard/domains/bimi), [Google BIMI setup](https://support.google.com/a/answer/10911320).

## Behavior and troubleshooting

- Six-digit codes expire after 15 minutes for password recovery, 10 minutes for verification. Resends have a 60-second cooldown. Five incorrect attempts exhaust a challenge. Codes are single-use and credential challenges are bound to account/session version.
- Password recovery always returns the same acceptance response, including when the address is unknown or mail fails. Operators inspect sanitized `email_*` events instead of revealing account existence to callers.
- `email_provider_accepted` records the Resend message ID and a request reference. It means provider acceptance, **not confirmed inbox delivery**. Inspect the corresponding event in Resend for bounces or delivery issues. Logs omit message bodies and secrets.
- Credential changes revoke old sessions immediately. If the tenant database is unavailable, the existing identity-sync worker retries the saved change and login remains paused.
- Security notices are attempted after commit, including administrative resets and changes. Mail failure never rolls back the credential update. There is no notification queue: an outage or process interruption can prevent a notice; it must not be described as guaranteed delivery.
- Browser preferences cannot disable security notices. Report recipients/scheduling remain controlled by report schedules.

## Local checks

Run `node --test test/*.test.mjs` in `backend`, plus the disposable database suite with `node scripts/run-database-e2e.mjs`. Never point disposable tests at production. Build both applications. Run `node test/email-preview.mjs` for local templates and the real email-change form backed by a fake API; it sends no mail and loads no production credentials.
