/**
 * runtime/channels/agent.js
 * Wraps notifications in a prompt envelope and delivers via the same
 * HTTP + HMAC path as webhook. Config shape:
 *   { url, secret, system_prompt, context_template, tool_use_mode?, model?, response_handling? }
 */

import { deliverWebhook } from './webhook.js'

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

export async function deliverAgent({ config, deliveryId, notificationPayload, timeoutMs }) {
  const body = buildAgentEnvelope(config, notificationPayload)
  return deliverWebhook({
    url: config.url,
    secret: config.secret,
    deliveryId,
    body,
    timeoutMs,
  })
}

export default { buildAgentEnvelope, deliverAgent }
