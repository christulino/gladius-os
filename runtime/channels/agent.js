/**
 * runtime/channels/agent.js
 * Wraps notifications in a prompt envelope and delivers via HTTP + HMAC.
 * Config shape:
 *   { url, secret, system_prompt, context_template, tool_use_mode?, model?, response_handling? }
 */

import crypto from 'node:crypto'

function signBody(bodyString, secret) {
  const h = crypto.createHmac('sha256', secret).update(bodyString).digest('hex')
  return `sha256=${h}`
}

function render(template, vars) {
  return (template || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path) => {
    return path.split('.').reduce((o, k) => (o == null ? '' : o[k]), vars) ?? ''
  })
}

export function buildAgentEnvelope(config, notificationPayload) {
  return {
    system_prompt: config.system_prompt,
    context:       { notification: notificationPayload },
    instruction:   render(config.context_template, notificationPayload),
  }
}

export async function deliverAgent({ config, deliveryId, notificationPayload, timeoutMs = 10000 }) {
  const body = buildAgentEnvelope(config, notificationPayload)
  const bodyString = JSON.stringify(body)
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(config.url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type':          'application/json',
        'X-Gladius-Signature':    signBody(bodyString, config.secret),
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

export default { buildAgentEnvelope, deliverAgent }
