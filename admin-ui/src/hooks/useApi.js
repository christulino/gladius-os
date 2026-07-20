import { useState, useEffect, useCallback } from 'react'

export function useApi(fetchFn, deps = []) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchFn()
      setData(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  // deps is a caller-supplied array; react-hooks/exhaustive-deps cannot analyze it
  // statically. Suppression directive removed in DEBT.26638 because the rule is not
  // installed (an unknown-rule directive is itself a lint error). Restore
  // `eslint-disable-next-line react-hooks/exhaustive-deps` here if eslint-plugin-react-hooks
  // is ever adopted -- the omission is intentional, not an oversight.
  }, deps)

  useEffect(() => { load() }, [load])

  return { data, loading, error, reload: load }
}
