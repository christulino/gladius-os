// admin-ui/src/lib/appConfig.js
// Lightweight app-wide config, set once at boot from GET /auth/status.
// Not reactive — these flags are fixed for the lifetime of a deployment,
// so a plain module singleton is simpler than a context provider here.

let multiOrgEnabled = false

export function setMultiOrgEnabled(value) {
  multiOrgEnabled = !!value
}

export function isMultiOrgEnabled() {
  return multiOrgEnabled
}
