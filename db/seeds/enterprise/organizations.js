/**
 * Enterprise org hierarchy modeled after a large company using
 * ServiceNow + Jira Align to manage development across multiple ARTs,
 * platform teams, horizontal functions, and service desks.
 *
 * Hierarchy:
 *   Digital Technology (enterprise)
 *   ├── Product Engineering ART (program)
 *   │   ├── Payments Team (feature-team)
 *   │   ├── Mobile Experience Team (feature-team)
 *   │   └── UX Design Studio (horizontal)
 *   ├── Platform ART (program)
 *   │   ├── Cloud Infrastructure (platform-team)
 *   │   ├── Data Platform (platform-team)
 *   │   └── IT Service Desk (service-center)
 *   ├── Enterprise Architecture (horizontal)
 *   ├── PMO (department)
 *   └── People Operations (horizontal)
 */

export const organizations = [
  // Top-level
  {
    slug: 'digital-technology',
    name: 'Digital Technology',
    org_type: 'enterprise',
    parent_slug: null,
  },

  // ARTs (programs) — under Digital Technology
  {
    slug: 'product-engineering',
    name: 'Product Engineering ART',
    org_type: 'program',
    parent_slug: 'digital-technology',
  },
  {
    slug: 'platform-art',
    name: 'Platform ART',
    org_type: 'program',
    parent_slug: 'digital-technology',
  },

  // Feature teams under Product Engineering ART
  {
    slug: 'payments',
    name: 'Payments Team',
    org_type: 'feature-team',
    parent_slug: 'product-engineering',
  },
  {
    slug: 'mobile-experience',
    name: 'Mobile Experience Team',
    org_type: 'feature-team',
    parent_slug: 'product-engineering',
  },
  {
    slug: 'ux-design',
    name: 'UX Design Studio',
    org_type: 'horizontal',
    parent_slug: 'product-engineering',
  },

  // Platform teams under Platform ART
  {
    slug: 'cloud-infra',
    name: 'Cloud Infrastructure',
    org_type: 'platform-team',
    parent_slug: 'platform-art',
  },
  {
    slug: 'data-platform',
    name: 'Data Platform',
    org_type: 'platform-team',
    parent_slug: 'platform-art',
  },
  {
    slug: 'it-service-desk',
    name: 'IT Service Desk',
    org_type: 'service-center',
    parent_slug: 'platform-art',
  },

  // Horizontal / shared — directly under Digital Technology
  {
    slug: 'enterprise-architecture',
    name: 'Enterprise Architecture',
    org_type: 'horizontal',
    parent_slug: 'digital-technology',
  },
  {
    slug: 'pmo',
    name: 'PMO',
    org_type: 'department',
    parent_slug: 'digital-technology',
  },
  {
    slug: 'people-ops',
    name: 'People Operations',
    org_type: 'horizontal',
    parent_slug: 'digital-technology',
  },
]
