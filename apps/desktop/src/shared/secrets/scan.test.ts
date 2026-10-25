import { describe, expect, it } from 'vitest'
import { MASK, hitSnippet, redactSecrets, scanSecrets } from './scan'

const kinds = (text: string): string[] => scanSecrets(text).map(h => h.kind)

describe('scanSecrets', () => {
  it('finds provider tokens', () => {
    expect(kinds('key is sk-proj-abcdefghijklmnopqrstuvwxyz0123 ok')).toEqual(['sk'])
    expect(kinds('sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA')).toEqual(['sk'])
    expect(kinds('ghp_abcdefghijklmnopqrstuvwxyz0123456789')).toEqual(['github'])
    expect(kinds('gho_abcdefghijklmnopqrstuvwxyz0123456789')).toEqual(['github'])
    expect(kinds('github_pat_11ABCDEFG0abcdefghijkl_mnopqrstuvwxyz')).toEqual(['github'])
    expect(kinds('aws AKIAIOSFODNN7EXAMPLE here')).toEqual(['aws'])
  })

  it('finds private key blocks, with or without the end line', () => {
    const block = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----'
    expect(kinds(`before\n${block}\nafter`)).toEqual(['private-key'])
    expect(kinds('-----BEGIN PRIVATE KEY-----\nMIIEvQ')).toEqual(['private-key'])
    expect(redactSecrets(block)).toBe(`-----BEGIN RSA PRIVATE KEY-----${MASK}-----END RSA PRIVATE KEY-----`)
  })

  it('finds KEY= / TOKEN= / SECRET= / PASSWORD= assignments', () => {
    expect(kinds('STRIPE_SECRET_KEY=rk_live_51Habcdef')).toEqual(['assignment'])
    expect(kinds('export API_TOKEN="abcd1234efgh"')).toEqual(['assignment'])
    expect(kinds('{"password": "hunter2hunter2"}')).toEqual(['assignment'])
    expect(kinds('db_password = s3cretValue!')).toEqual(['assignment'])
  })

  it('ignores code references, short values and look-alikes', () => {
    expect(kinds('const key = process.env.API_KEY')).toEqual([])
    expect(kinds('API_KEY=$API_KEY')).toEqual([])
    expect(kinds('API_KEY=<your key>')).toEqual([])
    expect(kinds('token=short')).toEqual([])
    expect(kinds('max_tokens=100000000')).toEqual([])
    expect(kinds('if (token == "abcdefghij")')).toEqual([])
    expect(kinds('key: string')).toEqual([])
    expect(kinds('PASSWORD=getPassword()')).toEqual([])
    expect(kinds('sk-short')).toEqual([])
    expect(kinds('plain text about keys and tokens')).toEqual([])
  })

  it('counts a key assigned to a variable once', () => {
    const hits = scanSecrets('OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz0123')
    expect(hits.map(h => h.kind)).toEqual(['assignment'])
  })

  it('finds several hits in order', () => {
    const text = 'a ghp_abcdefghijklmnopqrstuvwxyz0123456789 b AKIAIOSFODNN7EXAMPLE'
    expect(kinds(text)).toEqual(['github', 'aws'])
  })
})

describe('redactSecrets', () => {
  it('keeps the prefix and replaces the rest with a fixed mask', () => {
    const text = 'use sk-proj-abcdefghijklmnopqrstuvwxyz0123 and TOKEN=abcdefghij1 now'
    const out = redactSecrets(text)
    expect(out).toBe(`use sk-${MASK} and TOKEN=${MASK} now`)
    expect(scanSecrets(out)).toEqual([])
  })

  it('masks a private key block assigned to a variable (assignment rule must not swallow it)', () => {
    const body = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC'
    const text = `PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n${body}\n-----END RSA PRIVATE KEY-----"`
    expect(redactSecrets(text)).not.toContain(body)
    expect(scanSecrets(text)).toHaveLength(1)
  })

  it('returns text without hits unchanged', () => {
    expect(redactSecrets('nothing here')).toBe('nothing here')
  })
})

describe('hitSnippet', () => {
  it('shows prefix and the last four characters, never the whole secret', () => {
    const text = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123'
    const snippet = hitSnippet(text, scanSecrets(text)[0])
    expect(snippet).toBe(`sk-${MASK}0123`)
  })

  it('shows no tail for short values and private keys', () => {
    const short = 'KEY_TOKEN=abcdefgh'
    expect(hitSnippet(short, scanSecrets(short)[0])).toBe(`KEY_TOKEN=${MASK}`)
    const pem = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0B\n-----END PRIVATE KEY-----'
    expect(hitSnippet(pem, scanSecrets(pem)[0])).toBe(`-----BEGIN PRIVATE KEY-----${MASK}`)
  })
})
