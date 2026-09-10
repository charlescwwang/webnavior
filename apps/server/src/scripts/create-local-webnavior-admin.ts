import process from 'node:process'

import { hashPassword } from 'better-auth/crypto'
import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'

import { createDrizzle } from '../libs/db'
import { parseEnv } from '../libs/env'

import * as schema from '../schemas'

/**
 * Creates or refreshes one verified local Webnavior administrator.
 *
 * Call stack:
 *
 * process environment
 *   -> {@link parseEnv}
 *     -> {@link createDrizzle}
 *       -> `user` and `account` credential records
 */
const email = process.env.WEBNAVIOR_TEST_ADMIN_EMAIL ?? 'admin@webnavior.local'
const password = process.env.WEBNAVIOR_TEST_ADMIN_PASSWORD

if (process.env.NODE_ENV === 'production')
  throw new Error('This local test-account command cannot run in production.')

if (!password)
  throw new Error('WEBNAVIOR_TEST_ADMIN_PASSWORD is required.')

const env = parseEnv(process.env)
const { db, pool } = createDrizzle(env)

try {
  const existingUser = await db.query.user.findFirst({
    where: eq(schema.user.email, email),
  })
  const passwordHash = await hashPassword(password)

  const user = existingUser
    ? (await db.update(schema.user)
        .set({ emailVerified: true, role: 'admin', updatedAt: new Date() })
        .where(eq(schema.user.id, existingUser.id))
        .returning())[0]
    : (await db.insert(schema.user)
        .values({
          id: nanoid(),
          name: 'Webnavior Local Administrator',
          email,
          emailVerified: true,
          role: 'admin',
        })
        .returning())[0]

  if (!user)
    throw new Error('Failed to create or update the local administrator.')

  const credentialAccount = await db.query.account.findFirst({
    where: and(
      eq(schema.account.userId, user.id),
      eq(schema.account.providerId, 'credential'),
    ),
  })

  if (credentialAccount) {
    await db.update(schema.account)
      .set({ password: passwordHash, updatedAt: new Date() })
      .where(eq(schema.account.id, credentialAccount.id))
  }
  else {
    await db.insert(schema.account).values({
      id: nanoid(),
      accountId: user.id,
      providerId: 'credential',
      userId: user.id,
      password: passwordHash,
    })
  }

  console.info(`Local Webnavior administrator is ready: ${email}`)
}
finally {
  await pool.end()
}
