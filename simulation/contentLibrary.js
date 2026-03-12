/**
 * simulation/contentLibrary.js
 * Realistic titles, descriptions, and comments for simulation agents.
 */

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

// ─── Work Item Titles ──────────────────────────────────────────────────────

const featureTitles = [
  'Add dark mode toggle to user settings',
  'Implement real-time notification system',
  'Add bulk export to CSV for reports',
  'Redesign onboarding flow for new users',
  'Add two-factor authentication support',
  'Implement search filters for dashboard',
  'Add webhook configuration UI',
  'Build API rate limiting dashboard',
  'Implement SSO integration with Okta',
  'Add drag-and-drop file upload',
  'Create custom report builder',
  'Implement audit log viewer',
  'Add multi-language support for emails',
  'Build user activity timeline view',
  'Implement automated backup scheduling',
  'Add role-based access control matrix',
  'Create integration marketplace page',
  'Implement batch processing for imports',
  'Add customizable email templates',
  'Build performance metrics dashboard',
  'Implement data retention policies UI',
  'Add calendar view for scheduled tasks',
  'Create API key management interface',
  'Implement progressive web app support',
  'Add collaborative editing for documents',
]

const bugTitles = [
  'Login page crashes on Safari 17',
  'Pagination skips records when filter applied',
  'Email notifications sent twice on retry',
  'Memory leak in WebSocket connection handler',
  'CSV export truncates unicode characters',
  'Date picker shows wrong timezone offset',
  'Search results inconsistent after bulk update',
  'File upload fails silently for files > 10MB',
  'API returns 500 on concurrent status updates',
  'Dashboard widgets overlap on tablet viewport',
  'Password reset link expires immediately',
  'Dropdown menu renders behind modal overlay',
  'Sorting breaks when column has null values',
  'Session timeout doesn\'t redirect to login',
  'Image thumbnails not generated for HEIC format',
  'Auto-save triggers on read-only fields',
  'Webhook retry count never resets after success',
  'Currency formatting wrong for Japanese Yen',
  'Keyboard navigation broken in data grid',
  'Race condition in optimistic locking logic',
]

const taskTitles = [
  'Update Node.js to v22 LTS',
  'Migrate CI pipeline to GitHub Actions',
  'Document API endpoint conventions',
  'Set up staging environment monitoring',
  'Rotate production database credentials',
  'Configure log aggregation for new service',
  'Clean up deprecated API endpoints',
  'Add health check endpoint to auth service',
  'Update SSL certificates for Q2',
  'Review and update security headers',
  'Archive completed project repositories',
  'Set up automated dependency updates',
  'Write runbook for incident response',
  'Consolidate duplicate utility functions',
  'Update container base images to Alpine 3.19',
  'Configure CDN caching rules for static assets',
  'Set up database query performance monitoring',
  'Review third-party library licenses',
  'Create load testing scripts for API',
  'Update API documentation for v3 changes',
]

const serviceRequestTitles = [
  'Request VPN access for new contractor',
  'Need admin access to Confluence space',
  'Provision dev environment for Project Atlas',
  'Request license for IntelliJ IDEA Ultimate',
  'Set up shared mailbox for support team',
  'Need access to production logs dashboard',
  'Request cloud cost report for department',
  'Provision service account for CI/CD pipeline',
  'Need Slack channel created for new initiative',
  'Request elevated permissions for deploy pipeline',
  'Set up monitoring alerts for payment service',
  'Need database read replica for analytics team',
  'Request SSL certificate for new subdomain',
  'Provision test data in staging environment',
  'Need access to shared design system Figma',
]

const incidentTitles = [
  'Payment processing latency spike — P1',
  'Authentication service returning 503',
  'Database replication lag exceeding 30s',
  'CDN cache invalidation not propagating',
  'Email delivery queue backed up 2+ hours',
  'API gateway dropping requests intermittently',
  'Kubernetes pods in CrashLoopBackOff — prod',
  'SSL certificate expired on api.internal',
  'Search index out of sync with primary DB',
  'File storage service returning access denied',
]

const epicTitles = [
  'Q2 Platform Modernization',
  'Customer Self-Service Portal',
  'Real-time Analytics Pipeline',
  'Mobile App V3 Release',
  'Enterprise SSO Rollout',
  'Data Privacy Compliance Program',
  'Performance Optimization Sprint',
  'API V3 Migration',
  'Automated Testing Framework',
  'Observability Stack Upgrade',
]

// ─── Comments ──────────────────────────────────────────────────────────────

const progressComments = [
  'Making good progress on this. Should have a PR up by end of day.',
  'Started the implementation. Running into some edge cases with the existing API.',
  'First draft is working. Need to add error handling and tests.',
  'Waiting on design review before proceeding with the UI changes.',
  'Infrastructure setup is done. Moving on to the application layer.',
  'About 70% done. The core logic is solid, working on integration now.',
  'Completed the backend changes. Frontend work starts tomorrow.',
  'Hit a snag with the database migration. Working through it.',
  'Tests are passing locally. Setting up CI to validate.',
  'Prototype looks good. Scheduling demo with stakeholders this week.',
  'Refactored the existing code to make the new feature fit cleanly.',
  'Deployed to staging for initial testing. Looks stable so far.',
]

const questionComments = [
  'Should we support both JSON and XML response formats here?',
  'Do we need to maintain backward compatibility with the v1 API?',
  'What\'s the expected behavior when the user has no permissions?',
  'Is there a preference for the error message format?',
  'Should this be behind a feature flag for the initial rollout?',
  'Do we need to notify existing users about this change?',
  'What\'s the SLA expectation for this service?',
  'Should we add rate limiting to this endpoint from day one?',
]

const blockerComments = [
  'Blocked on infrastructure team — need the new VPC peering set up.',
  'Can\'t proceed until the API contract is finalized.',
  'Blocked by a dependency on the auth team\'s token refresh changes.',
  'Need approval from security team before we can proceed.',
  'Waiting on third-party vendor to provide sandbox credentials.',
  'Database migration requires a maintenance window — scheduling.',
]

const reviewComments = [
  'Code looks clean. A few minor suggestions on error handling.',
  'LGTM! Nice work on the test coverage.',
  'Approved with one nit — can we rename that variable for clarity?',
  'Found a potential issue with concurrent access. See inline comment.',
  'The approach is solid. Let\'s add a few more edge case tests.',
  'Good refactor. The separation of concerns is much better now.',
  'Needs a small fix on the input validation — otherwise ready to merge.',
  'Performance looks good in staging. Approving for production deploy.',
]

const triageComments = [
  'Confirmed reproduction on latest version. Assigning to the team.',
  'This looks like a P2 — impacting a subset of users. Adding to sprint.',
  'Duplicate of PBUG.12 — linking and closing.',
  'Need more info from the reporter. Asking for browser/OS details.',
  'Root cause identified — it\'s a race condition in the cache layer.',
  'Moving to the payments team — this is in their domain.',
]

// ─── Descriptions ──────────────────────────────────────────────────────────

const featureDescriptions = [
  'Users have been requesting this feature since Q3. It will improve workflow efficiency by reducing manual steps.',
  'This aligns with our Q2 OKR to improve user engagement. See the design spec in Confluence for details.',
  'Part of the platform modernization initiative. This replaces the legacy implementation with a modern approach.',
  'Customer feedback consistently highlights this as a pain point. Implementation follows the RFC approved last sprint.',
  'This feature enables self-service for operations that currently require support team intervention.',
]

const bugDescriptions = [
  'Steps to reproduce: 1) Navigate to the page, 2) Apply the filter, 3) Observe the error. Expected: no error. Actual: page crashes.',
  'This has been reported by 3 customers in the past week. Impact: data loss potential. Priority: high.',
  'Regression introduced in the last release. The root cause appears to be in the query optimization changes.',
  'Intermittent issue — happens roughly 1 in 20 requests under load. Likely a concurrency bug.',
  'The error is silent in the UI but visible in the server logs. Users don\'t know their action failed.',
]

// ─── Exports ───────────────────────────────────────────────────────────────

export const content = {
  pick,

  title(category) {
    switch (category) {
      case 'feature': return pick(featureTitles)
      case 'bug':     return pick(bugTitles)
      case 'task':    return pick(taskTitles)
      case 'service': return pick(serviceRequestTitles)
      case 'incident': return pick(incidentTitles)
      case 'epic':    return pick(epicTitles)
      default:        return pick(taskTitles)
    }
  },

  description(category) {
    if (category === 'bug') return pick(bugDescriptions)
    return pick(featureDescriptions)
  },

  comment(context) {
    switch (context) {
      case 'progress': return pick(progressComments)
      case 'question': return pick(questionComments)
      case 'blocker':  return pick(blockerComments)
      case 'review':   return pick(reviewComments)
      case 'triage':   return pick(triageComments)
      default:         return pick(progressComments)
    }
  },
}
