import { afterEach, describe, expect, it } from 'vitest'
import { Server as SshServer, type Connection } from 'ssh2'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { createServer, connect, type Server } from 'node:net'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { RpcPeer } from './rpc'
import { SshConnection, FingerprintRequired, quoteSh } from './ssh'
import type { MachineInput } from '../../preload/machines'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })
async function server() {
  await mkdir(resolve('../../scratch'), { recursive: true })
  const dir = await mkdtemp(join(resolve('../../scratch'), 'ssh-transport-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  const helper = join(dir, 'helper.cjs'); await writeFile(helper, '// helper test')
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs1' })
  const clients = new Set<Connection>(), forwards = new Set<Server>(), peers = new Set<RpcPeer>()
  let executed = 0, uploaded = ''
  const ssh = new SshServer({ hostKeys: [key] }, client => {
    clients.add(client); client.on('error', () => {})
    client.on('authentication', context => context.method === 'password' && context.password === 'test-password' ? context.accept() : context.reject())
    client.on('ready', () => {
      client.on('tcpip', (accept, reject, info) => {
        const socket = connect(info.destPort, info.destIP)
        socket.once('error', reject); socket.once('connect', () => { const stream = accept(); socket.on('error', () => stream.destroy()); stream.on('error', () => socket.destroy()); socket.pipe(stream).pipe(socket) })
      })
      client.on('request', (accept, reject, name, info) => {
        if (name !== 'tcpip-forward') { reject?.(); return }
        const forward = createServer(socket => client.forwardOut(info.bindAddr, (forward.address() as {port:number}).port, socket.remoteAddress!, socket.remotePort!, (error, channel) => {
          if (error) { socket.destroy(); return }
          socket.on('error', () => channel.destroy()); channel.on('error', () => socket.destroy()); socket.pipe(channel).pipe(socket)
        }))
        forwards.add(forward); forward.listen(0, '127.0.0.1', () => accept?.((forward.address() as {port:number}).port))
      })
      client.on('session', accept => accept().on('exec', (accept, _reject, info) => {
        executed++; const stream = accept()
        if (info.command.includes('process.stdout.write(JSON.stringify')) { stream.write(JSON.stringify({ home: '/test home', platform: 'linux', version: '22.0.0' })); stream.exit(0); stream.end(); return }
        if (info.command.includes('Buffer.concat')) {
          const chunks: Buffer[] = []; stream.on('data', (chunk: Buffer) => chunks.push(chunk)); stream.on('end', () => {
            const data = Buffer.concat(chunks); uploaded = data.toString(); const hash = createHash('sha256').update(data).digest('hex')
            stream.write('/test home/.local/share/pixelsky/remote/v1/helper-' + hash + '.cjs'); stream.exit(0); stream.end()
          }); return
        }
        const peer = new RpcPeer(stream, stream, method => {
          if (method !== 'hello') throw new Error('Unsupported')
          return { protocol: 1, platform: 'linux', home: '/test home', arch: 'x64', hostname: 'test', node: '22.0.0', shell: '/bin/sh' }
        }); peers.add(peer)
      }))
    })
  })
  await new Promise<void>(r => ssh.listen(0, '127.0.0.1', r))
  cleanup.push(() => { peers.forEach(p => p.close()); clients.forEach(c => c.end()); forwards.forEach(f => f.close()); ssh.close() })
  const config: MachineInput = { host:'127.0.0.1', port:(ssh.address() as {port:number}).port, name:'Test', username:'test', auth:'password', password:'test-password' }
  return { config, helper, stats: () => ({ executed, uploaded }) }
}
describe('SSH trust and loopback transport', () => {
  it('rejects an untrusted key before executing commands, then connects and forwards both directions', async () => {
    const target = await server(), untrusted = new SshConnection(); cleanup.push(() => untrusted.close())
    let fingerprint = ''
    try { await untrusted.connect(target.config, null, undefined, target.helper, () => {}); throw new Error('Unexpected trust') }
    catch (error) { expect(error).toBeInstanceOf(FingerprintRequired); fingerprint = (error as FingerprintRequired).fingerprint }
    expect(target.stats().executed).toBe(0); untrusted.close()
    const trusted = new SshConnection(); cleanup.push(() => trusted.close())
    expect((await trusted.connect(target.config, fingerprint, undefined, target.helper, () => {})).platform).toBe('linux')
    expect(target.stats().uploaded).toBe('// helper test')
    const echo = createServer(socket => socket.pipe(socket)); cleanup.push(() => { echo.close() })
    await new Promise<void>(r => echo.listen(0, '127.0.0.1', r))
    const port = (echo.address() as {port:number}).port
    const request = (port: number) => new Promise<string>((resolve, reject) => {
      const socket = connect(port, '127.0.0.1'); socket.setTimeout(2000, () => { socket.destroy(); reject(new Error('echo timeout')) })
      socket.on('error', reject); socket.on('connect', () => socket.write('ssh-roundtrip')); socket.on('data', data => { resolve(data.toString()); socket.destroy() })
    })
    expect(await request(await trusted.forwardPort(port))).toBe('ssh-roundtrip')
    expect(await request(await trusted.forwardGateway(port))).toBe('ssh-roundtrip')
    expect(await trusted.forwardGateway(port)).toBe(await trusted.forwardGateway(port))
  }, 15_000)
  it('quotes remote paths without interpreting shell substitutions', () => {
    expect(quoteSh("/tmp/a'b $(touch bad)")).toBe("'/tmp/a'\\''b $(touch bad)'")
  })
  it('blocks changed host keys and wrong credentials before upload', async () => {
    const target = await server(), changed = new SshConnection(); cleanup.push(() => changed.close())
    let fingerprint = ''
    try { await changed.connect(target.config, 'SHA256:old-key', undefined, target.helper, () => {}); throw new Error('Unexpected trust') }
    catch (error) { expect(error).toBeInstanceOf(FingerprintRequired); expect((error as FingerprintRequired).changed).toBe(true); fingerprint = (error as FingerprintRequired).fingerprint }
    expect(target.stats().executed).toBe(0); changed.close()
    const incorrect = new SshConnection(); cleanup.push(() => incorrect.close())
    await expect(incorrect.connect({ ...target.config, password: 'wrong' }, fingerprint, undefined, target.helper, () => {})).rejects.toThrow()
    expect(target.stats().executed).toBe(0)
  }, 15_000)
})
