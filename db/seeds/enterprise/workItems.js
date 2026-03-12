/**
 * Sample work items to populate the board with realistic data.
 * Each item references an org_slug and type_name.
 * Items are created at the entry stage of their workflow.
 */

export const workItems = [
  // ─── Payments Team ───────────────────────────────────────────────────────
  { org_slug: 'payments', type_name: 'Payment Feature',  title: 'Apple Pay integration for subscription renewals' },
  { org_slug: 'payments', type_name: 'Payment Feature',  title: 'PCI DSS v4.0 compliance updates' },
  { org_slug: 'payments', type_name: 'Payment Bug',      title: 'Refund fails silently when original transaction > 90 days' },
  { org_slug: 'payments', type_name: 'Payment Bug',      title: 'Currency rounding error on JPY transactions' },
  { org_slug: 'payments', type_name: 'Payment Task',     title: 'Update Stripe SDK to v14' },

  // ─── Mobile Experience ───────────────────────────────────────────────────
  { org_slug: 'mobile-experience', type_name: 'Mobile Feature',   title: 'Biometric login for iOS and Android' },
  { org_slug: 'mobile-experience', type_name: 'Mobile Feature',   title: 'Offline mode for transaction history' },
  { org_slug: 'mobile-experience', type_name: 'Mobile Bug',       title: 'Push notifications not delivered on Android 14' },
  { org_slug: 'mobile-experience', type_name: 'Design Request',   title: 'Redesign onboarding flow — reduce drop-off' },
  { org_slug: 'mobile-experience', type_name: 'Mobile Task',      title: 'Migrate CI pipeline to Xcode 16' },

  // ─── Cloud Infrastructure ────────────────────────────────────────────────
  { org_slug: 'cloud-infra', type_name: 'Environment Setup',       title: 'Provision staging environment for payments v3' },
  { org_slug: 'cloud-infra', type_name: 'Environment Setup',       title: 'Scale production Kubernetes cluster — Black Friday prep' },
  { org_slug: 'cloud-infra', type_name: 'Infrastructure Incident', title: 'us-east-1 load balancer timeout spike' },
  { org_slug: 'cloud-infra', type_name: 'Infrastructure Task',     title: 'Rotate TLS certificates across all clusters' },
  { org_slug: 'cloud-infra', type_name: 'Acquisition Request',     title: 'Datadog Enterprise license renewal — 3-year commitment' },

  // ─── Data Platform ───────────────────────────────────────────────────────
  { org_slug: 'data-platform', type_name: 'Database Change Request', title: 'Add partitioning to transactions table (>500M rows)' },
  { org_slug: 'data-platform', type_name: 'Database Change Request', title: 'Create read replica for analytics workloads' },
  { org_slug: 'data-platform', type_name: 'Data Pipeline Task',     title: 'Fix dbt model for customer churn metrics' },
  { org_slug: 'data-platform', type_name: 'Data Platform Bug',      title: 'Kafka consumer lag on payment events topic' },

  // ─── Enterprise Architecture ─────────────────────────────────────────────
  { org_slug: 'enterprise-architecture', type_name: 'Architecture Review',    title: 'Review: Event-driven architecture for order processing' },
  { org_slug: 'enterprise-architecture', type_name: 'Architecture Review',    title: 'Review: GraphQL gateway vs. BFF pattern' },
  { org_slug: 'enterprise-architecture', type_name: 'Technology Assessment',  title: 'Assess Temporal.io for long-running workflow orchestration' },
  { org_slug: 'enterprise-architecture', type_name: 'Standards Exception',    title: 'Exception: Use MongoDB for mobile offline sync cache' },

  // ─── UX Design Studio ───────────────────────────────────────────────────
  { org_slug: 'ux-design', type_name: 'Design Request',       title: 'Dashboard redesign — key metrics visibility' },
  { org_slug: 'ux-design', type_name: 'Design Request',       title: 'Design system dark mode variant' },
  { org_slug: 'ux-design', type_name: 'Design System Update', title: 'Add data table component to design system' },
  { org_slug: 'ux-design', type_name: 'Accessibility Audit',  title: 'WCAG 2.2 audit for checkout flow' },

  // ─── PMO ─────────────────────────────────────────────────────────────────
  { org_slug: 'pmo', type_name: 'Project Intake',   title: 'Customer self-service portal — business case review' },
  { org_slug: 'pmo', type_name: 'Project Intake',   title: 'Legacy system decommission — mainframe migration phase 3' },
  { org_slug: 'pmo', type_name: 'Sizing Request',   title: 'Size: Real-time fraud detection pipeline' },
  { org_slug: 'pmo', type_name: 'Status Report',    title: 'Q1 portfolio health report' },

  // ─── IT Service Desk ─────────────────────────────────────────────────────
  { org_slug: 'it-service-desk', type_name: 'IT Service Request', title: 'Install IntelliJ Ultimate license — new developer' },
  { org_slug: 'it-service-desk', type_name: 'IT Service Request', title: 'VPN access request for contractor team' },
  { org_slug: 'it-service-desk', type_name: 'IT Incident',        title: 'SSO login failing intermittently since 9 AM' },
  { org_slug: 'it-service-desk', type_name: 'Access Request',     title: 'AWS console access for data platform team' },
  { org_slug: 'it-service-desk', type_name: 'Equipment Request',  title: 'MacBook Pro M4 — new hire starting March 20' },

  // ─── People Operations ───────────────────────────────────────────────────
  { org_slug: 'people-ops', type_name: 'Headcount Requisition',   title: 'Senior Backend Engineer — Payments Team backfill' },
  { org_slug: 'people-ops', type_name: 'Headcount Requisition',   title: 'UX Researcher — Design Studio growth' },
  { org_slug: 'people-ops', type_name: 'Contractor Request',      title: 'DevOps contractor — 6-month cloud migration support' },
  { org_slug: 'people-ops', type_name: 'People Service Request',  title: 'Onboarding checklist for March cohort (8 new hires)' },

  // ─── Product Engineering ART ─────────────────────────────────────────────
  { org_slug: 'product-engineering', type_name: 'Product Epic',         title: 'Customer 360 — unified profile across channels' },
  { org_slug: 'product-engineering', type_name: 'Product Feature',      title: 'Real-time order tracking with push notifications' },
  { org_slug: 'product-engineering', type_name: 'Feature Feasibility',  title: 'Feasibility: AI-powered product recommendations' },
  { org_slug: 'product-engineering', type_name: 'Sizing Request',       title: 'Size: Multi-tenant architecture migration' },

  // ─── Platform ART ───────────────────────────────────────────────────────
  { org_slug: 'platform-art', type_name: 'Platform Feature', title: 'API gateway rate limiting per tenant' },
  { org_slug: 'platform-art', type_name: 'Platform Epic',    title: 'Observability platform — distributed tracing rollout' },
]

// Note: Platform ART has its own types (Platform Feature, Platform Epic, Platform Bug)
// created in the seed runner alongside the org-specific types.
