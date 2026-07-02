import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { useApi } from '@/hooks/useApi'
import { OrgSelector } from '@/components/OrgSelector'
import OrgContextLibrary from './OrgContextLibrary'

export default function ContextLibraryPage() {
  const [selectedOrgId, setSelectedOrgId] = useState(() => {
    try {
      const stored = localStorage.getItem('context_org_id')
      return stored ? parseInt(stored) : null
    } catch { return null }
  })

  const { data: orgsData } = useApi(() => api.organizations(), [])

  useEffect(() => {
    if (selectedOrgId || !orgsData?.rows?.length) return
    const nonSystem = orgsData.rows.find(o => o.slug !== 'system')
    if (nonSystem) {
      setSelectedOrgId(nonSystem.id)
      localStorage.setItem('context_org_id', String(nonSystem.id))
    }
  }, [orgsData, selectedOrgId])

  function handleOrgChange(id) {
    setSelectedOrgId(id)
    localStorage.setItem('context_org_id', String(id))
  }

  return (
    <div className="p-6 max-w-3xl flex flex-col gap-4">
      {orgsData?.rows?.length > 0 && (
        <div className="flex items-center gap-3">
          <OrgSelector
            orgs={orgsData.rows}
            selectedId={selectedOrgId}
            onChange={handleOrgChange}
          />
        </div>
      )}
      {selectedOrgId
        ? <OrgContextLibrary orgId={selectedOrgId} />
        : <p className="text-xs text-muted-foreground">Select an org to view the context library.</p>
      }
    </div>
  )
}
