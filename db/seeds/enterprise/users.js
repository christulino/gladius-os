/**
 * Enterprise users with org memberships.
 * Each user has an email, display_name, and a list of org memberships.
 */

export const users = [
  // Leadership
  {
    email: 'sarah.chen@flowos.dev',
    display_name: 'Sarah Chen',
    memberships: [
      { org_slug: 'digital-technology', role_name: 'Org Admin' },
      { org_slug: 'product-engineering', role_name: 'Stakeholder' },
      { org_slug: 'platform-art', role_name: 'Stakeholder' },
    ],
  },

  // Product Engineering ART
  {
    email: 'marcus.williams@flowos.dev',
    display_name: 'Marcus Williams',
    memberships: [
      { org_slug: 'product-engineering', role_name: 'Product Owner' },
      { org_slug: 'payments', role_name: 'Stakeholder' },
      { org_slug: 'mobile-experience', role_name: 'Stakeholder' },
    ],
  },
  {
    email: 'elena.vasquez@flowos.dev',
    display_name: 'Elena Vasquez',
    memberships: [
      { org_slug: 'product-engineering', role_name: 'Service Delivery Manager' },
    ],
  },

  // Payments Team
  {
    email: 'raj.patel@flowos.dev',
    display_name: 'Raj Patel',
    memberships: [
      { org_slug: 'payments', role_name: 'Team Member' },
    ],
  },
  {
    email: 'lisa.nakamura@flowos.dev',
    display_name: 'Lisa Nakamura',
    memberships: [
      { org_slug: 'payments', role_name: 'Team Member' },
    ],
  },
  {
    email: 'david.okafor@flowos.dev',
    display_name: 'David Okafor',
    memberships: [
      { org_slug: 'payments', role_name: 'Product Owner' },
    ],
  },

  // Mobile Experience
  {
    email: 'yuki.tanaka@flowos.dev',
    display_name: 'Yuki Tanaka',
    memberships: [
      { org_slug: 'mobile-experience', role_name: 'Team Member' },
    ],
  },
  {
    email: 'james.morrison@flowos.dev',
    display_name: 'James Morrison',
    memberships: [
      { org_slug: 'mobile-experience', role_name: 'Team Member' },
    ],
  },
  {
    email: 'priya.sharma@flowos.dev',
    display_name: 'Priya Sharma',
    memberships: [
      { org_slug: 'mobile-experience', role_name: 'Product Owner' },
    ],
  },

  // Platform ART
  {
    email: 'alex.petrov@flowos.dev',
    display_name: 'Alex Petrov',
    memberships: [
      { org_slug: 'platform-art', role_name: 'Product Owner' },
      { org_slug: 'cloud-infra', role_name: 'Stakeholder' },
      { org_slug: 'data-platform', role_name: 'Stakeholder' },
    ],
  },

  // Cloud Infrastructure
  {
    email: 'nina.kowalski@flowos.dev',
    display_name: 'Nina Kowalski',
    memberships: [
      { org_slug: 'cloud-infra', role_name: 'Team Member' },
    ],
  },
  {
    email: 'omar.hassan@flowos.dev',
    display_name: 'Omar Hassan',
    memberships: [
      { org_slug: 'cloud-infra', role_name: 'Team Member' },
    ],
  },

  // Data Platform
  {
    email: 'mei.lin@flowos.dev',
    display_name: 'Mei Lin',
    memberships: [
      { org_slug: 'data-platform', role_name: 'Team Member' },
    ],
  },
  {
    email: 'carlos.rivera@flowos.dev',
    display_name: 'Carlos Rivera',
    memberships: [
      { org_slug: 'data-platform', role_name: 'Team Member' },
    ],
  },

  // Enterprise Architecture (spans multiple orgs)
  {
    email: 'daniel.berg@flowos.dev',
    display_name: 'Daniel Berg',
    memberships: [
      { org_slug: 'enterprise-architecture', role_name: 'Org Admin' },
      { org_slug: 'product-engineering', role_name: 'Stakeholder' },
      { org_slug: 'platform-art', role_name: 'Stakeholder' },
    ],
  },
  {
    email: 'fatima.al-rashid@flowos.dev',
    display_name: 'Fatima Al-Rashid',
    memberships: [
      { org_slug: 'enterprise-architecture', role_name: 'Team Member' },
    ],
  },

  // UX Design Studio
  {
    email: 'sophie.dubois@flowos.dev',
    display_name: 'Sophie Dubois',
    memberships: [
      { org_slug: 'ux-design', role_name: 'Org Admin' },
    ],
  },
  {
    email: 'ryan.kim@flowos.dev',
    display_name: 'Ryan Kim',
    memberships: [
      { org_slug: 'ux-design', role_name: 'Team Member' },
      { org_slug: 'mobile-experience', role_name: 'Stakeholder' },
    ],
  },

  // PMO
  {
    email: 'jennifer.wright@flowos.dev',
    display_name: 'Jennifer Wright',
    memberships: [
      { org_slug: 'pmo', role_name: 'Service Delivery Manager' },
      { org_slug: 'digital-technology', role_name: 'Stakeholder' },
    ],
  },
  {
    email: 'thomas.andersen@flowos.dev',
    display_name: 'Thomas Andersen',
    memberships: [
      { org_slug: 'pmo', role_name: 'Team Member' },
    ],
  },

  // IT Service Desk
  {
    email: 'maria.santos@flowos.dev',
    display_name: 'Maria Santos',
    memberships: [
      { org_slug: 'it-service-desk', role_name: 'Service Manager' },
    ],
  },
  {
    email: 'kevin.brown@flowos.dev',
    display_name: 'Kevin Brown',
    memberships: [
      { org_slug: 'it-service-desk', role_name: 'Team Member' },
    ],
  },
  {
    email: 'aisha.johnson@flowos.dev',
    display_name: 'Aisha Johnson',
    memberships: [
      { org_slug: 'it-service-desk', role_name: 'Team Member' },
    ],
  },

  // People Operations
  {
    email: 'rachel.green@flowos.dev',
    display_name: 'Rachel Green',
    memberships: [
      { org_slug: 'people-ops', role_name: 'Org Admin' },
    ],
  },
  {
    email: 'michael.torres@flowos.dev',
    display_name: 'Michael Torres',
    memberships: [
      { org_slug: 'people-ops', role_name: 'Team Member' },
    ],
  },
]
