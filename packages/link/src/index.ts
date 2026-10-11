// 手机和电脑之间的加密连接（docs/mobile-remote.md §8.5.2）
export { concat, equalBytes, fromBase64Url, fromUtf8, toBase64Url, toHex, utf8 } from './bytes'
export { CipherState, Initiator, Responder, KEY_LENGTH, generateKeypair, keypairFrom } from './noise'
export type { HandshakeResult, Keypair } from './noise'
export { FrameType, MAX_FRAME, MAX_PAYLOAD, decodeFrame, decodeJson, encodeFrame, encodeJson } from './frame'
export {
  BRIDGE_PROTOCOL,
  LINK_VERSION,
  PROLOGUE,
  bridgeApiBase,
  bridgeProtocols,
  decodeOffer,
  encodeOffer,
  fingerprint,
  newPairingSecret,
  pairRequest,
  verifyPairRequest,
} from './pairing'
export type { PairRequest, PairStatus, PairingOffer } from './pairing'
export { SecureChannel } from './channel'
export type { Codec } from './channel'
export { RpcCore } from './rpc'
export type { RpcHandler, RpcMessage, RpcOptions } from './rpc'
