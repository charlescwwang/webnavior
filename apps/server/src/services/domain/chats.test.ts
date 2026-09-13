import type { Database } from '../../libs/db'
import type { HonoEnv } from '../../types/hono'

import { Hono } from 'hono'
import { beforeAll, describe, expect, it } from 'vitest'

import { clampLimit, resolveSenderId } from './chats'
import { createChatRoutes } from '../../routes/chats'
import { mockDB } from '../../libs/mock-db'
import * as schema from '../../schemas'
import { createChatService } from './chats'
import { ApiError } from '../../utils/error'

describe('resolveSenderId', () => {
  it('returns userId for user role', () => {
    expect(resolveSenderId('user', 'user-123', 'char-456')).toBe('user-123')
  })
  it('returns characterId for non-user role when available', () => {
    expect(resolveSenderId('assistant', 'user-123', 'char-456')).toBe('char-456')
  })
  it('returns null for non-user role without characterId', () => {
    expect(resolveSenderId('assistant', 'user-123')).toBeNull()
    expect(resolveSenderId('system', 'user-123', null)).toBeNull()
  })
})

describe('clampLimit', () => {
  it('returns default 100 when no limit', () => {
    expect(clampLimit()).toBe(100)
    expect(clampLimit(undefined)).toBe(100)
  })
  it('returns default 100 for zero or negative', () => {
    expect(clampLimit(0)).toBe(100)
    expect(clampLimit(-5)).toBe(100)
  })
  it('returns limit when within range', () => {
    expect(clampLimit(50)).toBe(50)
    expect(clampLimit(500)).toBe(500)
  })
  it('clamps to max 500', () => {
    expect(clampLimit(501)).toBe(500)
    expect(clampLimit(1000)).toBe(500)
  })
})

describe('chat creation idempotency', () => {
  let app: Hono<HonoEnv>
  let user: { id: string }

  beforeAll(async () => {
    const db: Database = await mockDB(schema)
    const [createdUser] = await db.insert(schema.user).values({
      id: 'chat-owner',
      name: 'Chat Owner',
      email: 'chat-owner@example.com',
    }).returning()
    user = { id: createdUser.id }

    app = new Hono<HonoEnv>()
      .use('*', async (c, next) => {
        c.set('user', user as HonoEnv['Variables']['user'])
        await next()
      })
      .route('/api/v1/chats', createChatRoutes(createChatService(db)))
      .onError((error, c) => {
        if (error instanceof ApiError)
          return c.json({ error: error.errorCode }, error.statusCode)
        return c.json({ error: 'INTERNAL_SERVER_ERROR' }, 500)
      })
  })

  it('returns 409 when a cloud-sync retry reuses an existing client chat ID', async () => {
    const request = () => new Request('http://localhost/api/v1/chats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'retryable-client-chat', type: 'bot' }),
    })

    expect((await app.fetch(request())).status).toBe(201)
    expect((await app.fetch(request())).status).toBe(409)
  })
})
