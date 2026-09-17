import process from 'node:process'

import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'

import { createDrizzle } from '../libs/db'
import { parseEnv } from '../libs/env'

import * as schema from '../schemas'

interface TestAccount {
  email: string
  globalRole: 'admin' | null
  name: string
  siteRole?: 'content_manager' | 'site_admin'
}

const testSite = {
  name: 'Webnavior 測試店',
  slug: 'webnavior-test-site',
}

const testAccounts: TestAccount[] = [
  {
    email: 'admin@webnavior.local',
    globalRole: 'admin',
    name: 'Webnavior 系統管理員',
  },
  {
    email: 'manager@webnavior.local',
    globalRole: null,
    name: 'Webnavior 測試店管理員',
    siteRole: 'site_admin',
  },
  {
    email: 'content@webnavior.local',
    globalRole: null,
    name: 'Webnavior 內容管理員',
    siteRole: 'content_manager',
  },
]

if (process.env.NODE_ENV === 'production')
  throw new Error('Test accounts cannot be created in production.')

const env = parseEnv(process.env)
const { db, pool } = createDrizzle(env)

async function ensureTestSite() {
  const currentSite = await db.query.kioskSites.findFirst({
    where: eq(schema.kioskSites.slug, testSite.slug),
  })
  if (currentSite)
    return currentSite

  const legacySite = await db.query.kioskSites.findFirst({
    where: eq(schema.kioskSites.slug, 'development-kiosk-poc'),
  })
  if (legacySite) {
    const [renamedSite] = await db.update(schema.kioskSites)
      .set({ name: testSite.name, slug: testSite.slug, updatedAt: new Date() })
      .where(eq(schema.kioskSites.id, legacySite.id))
      .returning()
    if (renamedSite)
      return renamedSite
  }

  const [createdSite] = await db.insert(schema.kioskSites).values(testSite).returning()
  if (!createdSite)
    throw new Error('Failed to create the Webnavior test site.')
  return createdSite
}

async function ensureAccount(account: TestAccount) {
  const existingUser = await db.query.user.findFirst({
    where: eq(schema.user.email, account.email),
  })
  if (existingUser) {
    const [updatedUser] = await db.update(schema.user)
      .set({
        emailVerified: true,
        name: account.name,
        role: account.globalRole,
        updatedAt: new Date(),
      })
      .where(eq(schema.user.id, existingUser.id))
      .returning()
    if (!updatedUser)
      throw new Error(`Failed to update ${account.email}.`)
    return updatedUser
  }

  const [createdUser] = await db.insert(schema.user).values({
    email: account.email,
    emailVerified: true,
    id: nanoid(),
    name: account.name,
    role: account.globalRole,
  }).returning()
  if (!createdUser)
    throw new Error(`Failed to create ${account.email}.`)
  return createdUser
}

async function ensureSiteMembership(input: { role: 'content_manager' | 'site_admin', siteId: string, userId: string }) {
  const membership = await db.query.kioskSiteMembers.findFirst({
    where: and(
      eq(schema.kioskSiteMembers.siteId, input.siteId),
      eq(schema.kioskSiteMembers.userId, input.userId),
    ),
  })
  if (membership) {
    await db.update(schema.kioskSiteMembers)
      .set({ role: input.role })
      .where(eq(schema.kioskSiteMembers.id, membership.id))
    return
  }

  await db.insert(schema.kioskSiteMembers).values({
    id: nanoid(),
    role: input.role,
    siteId: input.siteId,
    userId: input.userId,
  })
}

/**
 * Seeds the local Webnavior accounts used by development-only account recognition.
 *
 * Call stack:
 *
 * process environment
 *   -> {@link parseEnv}
 *     -> {@link createDrizzle}
 *       -> `user` and `kiosk_site_members` records
 */
try {
  const site = await ensureTestSite()
  let systemAdministratorId = ''
  for (const account of testAccounts) {
    const user = await ensureAccount(account)
    if (account.globalRole === 'admin')
      systemAdministratorId = user.id
    if (account.siteRole)
      await ensureSiteMembership({ role: account.siteRole, siteId: site.id, userId: user.id })
  }
  if (systemAdministratorId) {
    await db.update(schema.kioskSites)
      .set({ ownerUserId: systemAdministratorId, updatedAt: new Date() })
      .where(eq(schema.kioskSites.id, site.id))
  }

  console.info(`Webnavior test accounts are ready for ${site.name}:`)
  console.info('- admin@webnavior.local — 系統管理員')
  console.info('- manager@webnavior.local — 店別管理員')
  console.info('- content@webnavior.local — 內容管理員')
}
finally {
  await pool.end()
}
