/**
 * runtime/channels/email.js
 * SMTP via nodemailer. No-op + warning when unconfigured outside production.
 */

import nodemailer from 'nodemailer'

let transport = null
let mode = 'unset'

export function initEmail() {
  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
    mode = 'smtp'
  } else if (process.env.NODE_ENV === 'production') {
    throw new Error('SMTP_HOST/SMTP_USER required in production')
  } else {
    mode = 'noop'
    console.warn('[email] SMTP not configured — deliveries will no-op (dev mode)')
  }
}

export async function deliverEmail({ to, subject, text, html }) {
  if (mode === 'unset') initEmail()
  if (mode === 'noop') return { ok: true, status: 200, noop: true }
  try {
    const info = await transport.sendMail({
      from: process.env.SMTP_FROM || 'Gladius OS <no-reply@gladius.local>',
      to, subject, text, html,
    })
    return { ok: true, status: 200, messageId: info.messageId }
  } catch (e) {
    return { ok: false, status: 0, error: e.message }
  }
}

export function renderRealtimeBody(notification, workItem, baseUrl) {
  const link = `${baseUrl}/admin/work-items/${workItem.id}`
  const subject = `[Gladius OS] ${notification.summary}`
  const text = `${notification.summary}\n\n${link}\n`
  const html = `<p>${notification.summary}</p><p><a href="${link}">Open in Gladius OS</a></p>`
  return { subject, text, html }
}

export function renderDigestBody(notifications, baseUrl) {
  const subject = `${notifications.length} updates from Gladius OS — ${new Date().toDateString()}`
  const lines = notifications.map(n => `• ${n.summary}\n  ${baseUrl}/admin/work-items/${n.work_item_id}`)
  const text = lines.join('\n\n')
  const html = '<ul>' +
    notifications.map(n => `<li>${n.summary} — <a href="${baseUrl}/admin/work-items/${n.work_item_id}">open</a></li>`).join('') +
    '</ul>'
  return { subject, text, html }
}

export default { initEmail, deliverEmail, renderRealtimeBody, renderDigestBody }
