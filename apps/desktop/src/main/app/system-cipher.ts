// 系统加密（Windows DPAPI / macOS 钥匙串 / Linux libsecret）。Linux 上没有密钥环时 Electron 会退回
// 固定密钥的 basic_text，等同明文，按不可用处理：调用方只放内存、不写盘
import { safeStorage } from 'electron'
import type { Cipher } from '../core/secure-store'

export const systemCipher: Cipher = {
  available: () => {
    if (!safeStorage.isEncryptionAvailable()) return false
    if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function') {
      const backend = safeStorage.getSelectedStorageBackend()
      if (backend === 'basic_text' || backend === 'unknown') return false
    }
    return true
  },
  encrypt: value => safeStorage.encryptString(value).toString('base64'),
  decrypt: value => safeStorage.decryptString(Buffer.from(value, 'base64')),
}
