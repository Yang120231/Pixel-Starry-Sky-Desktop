// Noise_KK_25519_ChaChaPoly_SHA256（https://noiseprotocol.org/noise.html）：配对之后双方都知道对方的长期公钥。
// 手机是发起方，电脑是响应方。临时密钥保证以后长期私钥泄露也解不开以前的流量。
// 用 cacophony 的官方测试向量核对过（test/noise.test.ts），改动这里之后测试必须仍然全过。
import { x25519 } from '@noble/curves/ed25519.js'
import { chacha20poly1305 } from '@noble/ciphers/chacha.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { hmac } from '@noble/hashes/hmac.js'
import { concat, utf8 } from './bytes'

export interface Keypair {
  readonly privateKey: Uint8Array
  readonly publicKey: Uint8Array
}

export function generateKeypair(): Keypair {
  return keypairFrom(x25519.utils.randomSecretKey())
}

export function keypairFrom(privateKey: Uint8Array): Keypair {
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) }
}

const PROTOCOL = 'Noise_KK_25519_ChaChaPoly_SHA256'
const EMPTY = new Uint8Array(0)
export const KEY_LENGTH = 32
const TAG_LENGTH = 16

/** Noise 的 nonce：4 字节 0 + 8 字节小端计数 */
function nonce(n: number): Uint8Array {
  const b = new Uint8Array(12)
  new DataView(b.buffer).setBigUint64(4, BigInt(n), true)
  return b
}

function hkdf2(ck: Uint8Array, ikm: Uint8Array): [Uint8Array, Uint8Array] {
  const temp = hmac(sha256, ck, ikm)
  const out1 = hmac(sha256, temp, Uint8Array.of(1))
  return [out1, hmac(sha256, temp, concat(out1, Uint8Array.of(2)))]
}

/** 握手之后一个方向的密钥。计数只在成功时前进；失败一次调用方就该断开（不再信任这条连接） */
export class CipherState {
  private n = 0
  constructor(private readonly key: Uint8Array) {}
  seal(plaintext: Uint8Array, ad: Uint8Array = EMPTY): Uint8Array {
    return chacha20poly1305(this.key, nonce(this.n++), ad).encrypt(plaintext)
  }
  open(ciphertext: Uint8Array, ad: Uint8Array = EMPTY): Uint8Array {
    if (ciphertext.length < TAG_LENGTH) throw new Error('LINK_DECRYPT_FAILED')
    let plaintext: Uint8Array
    try {
      plaintext = chacha20poly1305(this.key, nonce(this.n), ad).decrypt(ciphertext)
    } catch {
      throw new Error('LINK_DECRYPT_FAILED')
    }
    this.n++
    return plaintext
  }
}

export interface HandshakeResult {
  send: CipherState
  receive: CipherState
  /** 握手哈希：两端相同，可用于以后的通道绑定 */
  hash: Uint8Array
  /** 响应方读到的发起方长期公钥（KK 里双方本来就知道，这里原样返回方便核对） */
  remoteStatic: Uint8Array
}

class SymmetricState {
  h: Uint8Array
  ck: Uint8Array
  private k: Uint8Array | null = null
  private n = 0
  constructor(prologue: Uint8Array) {
    // 协议名正好 32 字节（= HASHLEN），直接作为初始 h
    this.h = utf8(PROTOCOL)
    this.ck = this.h
    this.mixHash(prologue)
  }
  mixHash(data: Uint8Array): void {
    this.h = sha256(concat(this.h, data))
  }
  mixKey(ikm: Uint8Array): void {
    ;[this.ck, this.k] = hkdf2(this.ck, ikm)
    this.n = 0
  }
  encryptAndHash(plaintext: Uint8Array): Uint8Array {
    const out = this.k ? chacha20poly1305(this.k, nonce(this.n++), this.h).encrypt(plaintext) : plaintext
    this.mixHash(out)
    return out
  }
  decryptAndHash(ciphertext: Uint8Array): Uint8Array {
    let out = ciphertext
    if (this.k) {
      try {
        out = chacha20poly1305(this.k, nonce(this.n), this.h).decrypt(ciphertext)
      } catch {
        throw new Error('LINK_HANDSHAKE_FAILED')
      }
      this.n++
    }
    this.mixHash(ciphertext)
    return out
  }
  split(): [CipherState, CipherState] {
    const [k1, k2] = hkdf2(this.ck, EMPTY)
    return [new CipherState(k1), new CipherState(k2)]
  }
}

function dh(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  try {
    return x25519.getSharedSecret(privateKey, publicKey)
  } catch {
    throw new Error('LINK_HANDSHAKE_FAILED')
  }
}

function checkKey(key: Uint8Array): void {
  if (!(key instanceof Uint8Array) || key.length !== KEY_LENGTH) throw new Error('LINK_HANDSHAKE_FAILED')
}

interface Options {
  /** 自己的长期密钥 */
  local: Keypair
  /** 对方的长期公钥（配对时记下的） */
  remote: Uint8Array
  /** 双方必须一致的前缀，把协议版本绑进握手 */
  prologue?: Uint8Array
  /** 只给测试固定临时密钥用 */
  ephemeral?: Keypair
}

/** 发起方（手机）：writeMessage1 → 收到对方回复后 readMessage2 */
export class Initiator {
  private readonly ss: SymmetricState
  private readonly e: Keypair
  private state: 'new' | 'sent' | 'done' = 'new'
  constructor(private readonly o: Options) {
    checkKey(o.remote)
    this.ss = new SymmetricState(o.prologue ?? EMPTY)
    this.ss.mixHash(o.local.publicKey)
    this.ss.mixHash(o.remote)
    this.e = o.ephemeral ?? generateKeypair()
  }
  // -> e, es, ss
  writeMessage1(payload: Uint8Array = EMPTY): Uint8Array {
    if (this.state !== 'new') throw new Error('LINK_HANDSHAKE_FAILED')
    this.state = 'sent'
    this.ss.mixHash(this.e.publicKey)
    this.ss.mixKey(dh(this.e.privateKey, this.o.remote))
    this.ss.mixKey(dh(this.o.local.privateKey, this.o.remote))
    return concat(this.e.publicKey, this.ss.encryptAndHash(payload))
  }
  // <- e, ee, se
  readMessage2(message: Uint8Array): { payload: Uint8Array; result: HandshakeResult } {
    if (this.state !== 'sent' || message.length < KEY_LENGTH + TAG_LENGTH) throw new Error('LINK_HANDSHAKE_FAILED')
    this.state = 'done'
    const re = message.slice(0, KEY_LENGTH)
    this.ss.mixHash(re)
    this.ss.mixKey(dh(this.e.privateKey, re))
    this.ss.mixKey(dh(this.o.local.privateKey, re))
    const payload = this.ss.decryptAndHash(message.slice(KEY_LENGTH))
    const [toResponder, toInitiator] = this.ss.split()
    return {
      payload,
      result: { send: toResponder, receive: toInitiator, hash: this.ss.h, remoteStatic: this.o.remote },
    }
  }
}

/** 响应方（电脑）：readMessage1 → writeMessage2 */
export class Responder {
  private readonly ss: SymmetricState
  private readonly e: Keypair
  private re: Uint8Array | null = null
  private state: 'new' | 'read' | 'done' = 'new'
  constructor(private readonly o: Options) {
    checkKey(o.remote)
    this.ss = new SymmetricState(o.prologue ?? EMPTY)
    this.ss.mixHash(o.remote)
    this.ss.mixHash(o.local.publicKey)
    this.e = o.ephemeral ?? generateKeypair()
  }
  readMessage1(message: Uint8Array): Uint8Array {
    if (this.state !== 'new' || message.length < KEY_LENGTH + TAG_LENGTH) throw new Error('LINK_HANDSHAKE_FAILED')
    this.state = 'read'
    this.re = message.slice(0, KEY_LENGTH)
    this.ss.mixHash(this.re)
    this.ss.mixKey(dh(this.o.local.privateKey, this.re))
    this.ss.mixKey(dh(this.o.local.privateKey, this.o.remote))
    return this.ss.decryptAndHash(message.slice(KEY_LENGTH))
  }
  writeMessage2(payload: Uint8Array = EMPTY): { message: Uint8Array; result: HandshakeResult } {
    if (this.state !== 'read' || !this.re) throw new Error('LINK_HANDSHAKE_FAILED')
    this.state = 'done'
    this.ss.mixHash(this.e.publicKey)
    this.ss.mixKey(dh(this.e.privateKey, this.re))
    this.ss.mixKey(dh(this.e.privateKey, this.o.remote))
    const message = concat(this.e.publicKey, this.ss.encryptAndHash(payload))
    const [toResponder, toInitiator] = this.ss.split()
    return {
      message,
      result: { send: toInitiator, receive: toResponder, hash: this.ss.h, remoteStatic: this.o.remote },
    }
  }
}
