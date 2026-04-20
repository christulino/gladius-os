// tests/notifications-delivery.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { signBody, deliverWebhook } from '../runtime/channels/webhook.js'

describe('channels/webhook', () => {
  it('signBody produces stable sha256 HMAC hex', () => {
    const sig1 = signBody('{"a":1}', 'secret')
    const sig2 = signBody('{"a":1}', 'secret')
    assert.equal(sig1, sig2)
    assert.match(sig1, /^sha256=[0-9a-f]{64}$/)
    assert.notEqual(signBody('{"a":2}', 'secret'), sig1)
  })

  it('deliverWebhook POSTs signed body, returns {ok:true} on 2xx', async () => {
    let receivedSig, receivedBody
    const srv = createServer((req, res) => {
      let body = ''
      req.on('data', d => body += d)
      req.on('end', () => {
        receivedSig = req.headers['x-flowos-signature']
        receivedBody = body
        res.writeHead(200); res.end('ok')
      })
    })
    await new Promise(r => srv.listen(0, r))
    const port = srv.address().port
    const res = await deliverWebhook({
      url: `http://127.0.0.1:${port}/hook`,
      secret: 'shh',
      deliveryId: 42,
      body: { hello: 'world' },
      timeoutMs: 2000,
    })
    srv.close()
    assert.equal(res.ok, true)
    assert.equal(res.status, 200)
    assert.equal(receivedSig, signBody(receivedBody, 'shh'))
  })

  it('returns {ok:false, status} on 5xx', async () => {
    const srv = createServer((_req, res) => { res.writeHead(500); res.end('nope') })
    await new Promise(r => srv.listen(0, r))
    const port = srv.address().port
    const res = await deliverWebhook({
      url: `http://127.0.0.1:${port}/`, secret: 's', deliveryId: 1,
      body: {}, timeoutMs: 2000,
    })
    srv.close()
    assert.equal(res.ok, false)
    assert.equal(res.status, 500)
  })
})

import { renderRealtimeBody, renderDigestBody } from '../runtime/channels/email.js'

describe('channels/email — rendering', () => {
  it('realtime body contains the summary and work item link', () => {
    const { subject, text, html } = renderRealtimeBody(
      { summary: 'BUG.1 moved to Done' },
      { id: 1 },
      'http://flowos.local',
    )
    assert.match(subject, /BUG\.1/)
    assert.match(text,    /\/admin\/work-items\/1/)
    assert.match(html,    /href="http:\/\/flowos\.local\/admin\/work-items\/1"/)
  })

  it('digest body groups multiple items', () => {
    const { subject, text } = renderDigestBody(
      [{ summary: 'one', work_item_id: 1 }, { summary: 'two', work_item_id: 2 }],
      'http://flowos.local',
    )
    assert.match(subject, /2 updates/)
    assert.match(text, /one/)
    assert.match(text, /two/)
  })
})
