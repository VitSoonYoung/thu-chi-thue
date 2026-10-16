import { describe, expect, it, vi } from 'vitest'
import { createRequestId } from './requestId'

describe('request IDs', () => {
  it('creates distinct UUIDs when randomUUID is unavailable', () => {
    const randomUUID = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('randomUUID unavailable')
    })
    try {
      const ids = Array.from({ length: 100 }, createRequestId)
      expect(new Set(ids).size).toBe(ids.length)
      for (const id of ids) {
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      }
      expect(randomUUID).not.toHaveBeenCalled()
    } finally {
      randomUUID.mockRestore()
    }
  })
})
