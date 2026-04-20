import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { runChallenge } from '../runtime/notifications/ownershipChallenge.js'

function withServer(handler, fn) {
  return new Promise(async resolve => {
    const srv = createServer(handler)
    srv.listen(0, async () => {
      const port = srv.address().port
      const result = await fn(`http://127.0.0.1:${port}/hook`)
      srv.close(() => resolve(result))
    })
  })
}

describe('ownershipChallenge', () => {
  it('passes when endpoint echoes the token', async () => {
    const out = await withServer((req, res) => {
      let body = ''
      req.on('data', d => body += d); req.on('end', () => {
        const { token } = JSON.parse(body)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ token }))
      })
    }, url => runChallenge({ url, timeoutMs: 1000 }))
    assert.equal(out.ok, true)
  })

  it('fails when endpoint echoes wrong token', async () => {
    const out = await withServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ token: 'WRONG' }))
    }, url => runChallenge({ url, timeoutMs: 1000 }))
    assert.equal(out.ok, false)
    assert.match(out.reason, /token/i)
  })

  it('fails on non-2xx', async () => {
    const out = await withServer((_req, res) => { res.writeHead(500); res.end() },
      url => runChallenge({ url, timeoutMs: 1000 }))
    assert.equal(out.ok, false)
  })

  it('fails on timeout', async () => {
    const out = await withServer((_req, _res) => {},
      url => runChallenge({ url, timeoutMs: 100 }))
    assert.equal(out.ok, false)
    assert.match(out.reason, /timeout|abort/i)
  })
})
