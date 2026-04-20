import { useEffect, useState } from 'react'
import { notificationsApi } from '@/lib/api'

const CHANNELS = ['in_app', 'email', 'webhook', 'agent']
const RELATIONSHIPS = ['owns', 'working_on', 'reviewing', 'watching', 'requester', 'mentioned']

export default function SettingsNotifications() {
  const [prefs, setPrefs] = useState(null)

  async function load() {
    try {
      setPrefs(await notificationsApi.getPrefs())
    } catch {}
  }

  useEffect(() => { load() }, [])

  if (!prefs) return <div className="p-4 text-xs text-muted-foreground">Loading…</div>

  const channels = CHANNELS.map(
    c => prefs.channels.find(x => x.channel === c) || { channel: c, is_enabled: false, digest: 'realtime', config: {} }
  )

  async function saveChannel(channel, patch) {
    const base = channels.find(c => c.channel === channel) || {}
    const merged = { ...base, ...patch }
    await notificationsApi.putPrefs({ channels: [merged] })
    load()
  }

  async function toggleMatrix(rel, type, enabled) {
    const existing = prefs.overrides.filter(
      o => !(o.relationship_type === rel && o.event_type === type)
    )
    const defaultEnabled = prefs.defaults.find(
      d => d.relationship_type === rel && d.event_type === type
    )?.enabled
    const next = enabled === defaultEnabled
      ? existing
      : [...existing, { relationship_type: rel, event_type: type, enabled }]
    await notificationsApi.putPrefs({ overrides: next })
    load()
  }

  const eventTypes = [...new Set(prefs.defaults.map(d => d.event_type))].sort()

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <h1 className="text-sm font-medium">Notification Settings</h1>

      {/* Channels */}
      <section>
        <h2 className="text-xs uppercase tracking-wide font-medium text-muted-foreground mb-2">Channels</h2>
        <div className="grid grid-cols-2 gap-3">
          {channels.map(ch => (
            <div key={ch.channel} className="p-3 rounded border border-border bg-card">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium uppercase tracking-wide">
                  {ch.channel.replace('_', ' ')}
                </div>
                <input
                  type="checkbox"
                  checked={!!ch.is_enabled}
                  onChange={e => saveChannel(ch.channel, { is_enabled: e.target.checked })}
                  className="cursor-pointer"
                />
              </div>

              {ch.channel === 'email' && (
                <input
                  className="mt-2 w-full text-xs border border-border rounded px-1.5 py-0.5 bg-background"
                  placeholder="email@example.com"
                  defaultValue={ch.config?.email_to || ''}
                  onBlur={e => saveChannel(ch.channel, { config: { ...ch.config, email_to: e.target.value } })}
                />
              )}

              {(ch.channel === 'webhook' || ch.channel === 'agent') && (
                <>
                  <input
                    className="mt-2 w-full text-xs border border-border rounded px-1.5 py-0.5 bg-background"
                    placeholder="https://..."
                    defaultValue={ch.config?.url || ''}
                    onBlur={e => saveChannel(ch.channel, { config: { ...ch.config, url: e.target.value } })}
                  />
                  <input
                    className="mt-1 w-full text-xs border border-border rounded px-1.5 py-0.5 bg-background"
                    placeholder="signing secret"
                    type="password"
                    defaultValue={ch.config?.secret || ''}
                    onBlur={e => saveChannel(ch.channel, { config: { ...ch.config, secret: e.target.value } })}
                  />
                  {!ch.is_enabled && ch.config?.url && (
                    <div className="text-xs mt-1 text-destructive">Awaiting ownership verification.</div>
                  )}
                </>
              )}

              {ch.channel === 'agent' && (
                <>
                  <textarea
                    className="mt-1 w-full text-xs border border-border rounded px-1.5 py-0.5 bg-background resize-y"
                    placeholder="System prompt"
                    defaultValue={ch.config?.system_prompt || ''}
                    onBlur={e => saveChannel(ch.channel, { config: { ...ch.config, system_prompt: e.target.value } })}
                  />
                  <textarea
                    className="mt-1 w-full text-xs border border-border rounded px-1.5 py-0.5 bg-background resize-y"
                    placeholder="Context template ({{ work_item.display_key }} etc.)"
                    defaultValue={ch.config?.context_template || ''}
                    onBlur={e => saveChannel(ch.channel, { config: { ...ch.config, context_template: e.target.value } })}
                  />
                </>
              )}

              <div className="mt-2 text-xs flex gap-2 items-center text-muted-foreground">
                Digest:
                <select
                  value={ch.digest || 'realtime'}
                  disabled={ch.channel === 'in_app'}
                  onChange={e => saveChannel(ch.channel, { digest: e.target.value })}
                  className="text-xs border border-border rounded px-1 py-0.5 bg-background"
                >
                  <option value="realtime">realtime</option>
                  <option value="hourly">hourly</option>
                  <option value="daily">daily</option>
                </select>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Matrix */}
      <section>
        <h2 className="text-xs uppercase tracking-wide font-medium text-muted-foreground mb-2">
          When should I be notified?
        </h2>
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse">
            <thead>
              <tr>
                <th className="text-left pr-4 py-1 font-medium">Event</th>
                {RELATIONSHIPS.map(r => (
                  <th key={r} className="px-2 text-center font-medium capitalize">
                    {r.replace('_', ' ')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {eventTypes.map(type => (
                <tr key={type} className="hover:bg-black/[0.02]">
                  <td className="pr-4 py-0.5 text-muted-foreground">{type}</td>
                  {RELATIONSHIPS.map(rel => {
                    const def  = prefs.defaults.find(d => d.relationship_type === rel && d.event_type === type)
                    const over = prefs.overrides.find(o => o.relationship_type === rel && o.event_type === type)
                    const enabled = over ? over.enabled : (def?.enabled ?? false)
                    const disabled = !def
                    return (
                      <td key={rel} className="px-2 text-center py-0.5">
                        <input
                          type="checkbox"
                          checked={enabled}
                          disabled={disabled}
                          onChange={e => toggleMatrix(rel, type, e.target.checked)}
                          className={disabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}
                        />
                        {over && (
                          <span className="text-[9px] ml-0.5 text-muted-foreground" title="Overridden">•</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
