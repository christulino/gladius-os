/**
 * runtime/channels/webhook.js
 * HTTP POST with HMAC-SHA256 signature. Timeout via AbortController.
 */

import crypto from 'node:crypto'

export function signBody(bodyString, secret) {
  const h = crypto.createHmac('sha256', secret).update(bodyString).digest('hex')
  return `sha256=${h}`
}

export async function deliverWebhook({ url, secret, deliveryId, body, timeoutMs = 10000 }) {
  const bodyString = JSON.stringify(body)
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type':          'application/json',
        'X-Gladius-Signature':    signBody(bodyString, secret),
        'X-Gladius-Delivery-Id':  String(deliveryId),
      },
      body: bodyString,
    })
    return { ok: res.ok, status: res.status }
  } catch (e) {
    return { ok: false, status: 0, error: e.message || 'request-failed' }
  } finally {
    clearTimeout(t)
  }
}

export default { signBody, deliverWebhook }
