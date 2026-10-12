import { describe, expect, it } from 'vitest'
import { detectInstallEnv } from './installEnv'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko)'
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'

describe('detectInstallEnv', () => {
  it('knows iPhone Safari', () => {
    expect(detectInstallEnv(`${IPHONE} Version/18.0 Mobile/15E148 Safari/604.1`)).toBe('ios-safari')
  })

  it('knows iPad Safari posing as a Mac', () => {
    expect(detectInstallEnv(MAC, 5)).toBe('ios-safari')
    expect(detectInstallEnv(MAC, 0)).toBe('desktop')
  })

  it('sends iOS browsers other than Safari, and web views, to Safari', () => {
    expect(detectInstallEnv(`${IPHONE} CriOS/130.0 Mobile/15E148 Safari/604.1`)).toBe('ios-other')
    expect(detectInstallEnv(`${IPHONE} Mobile/15E148`)).toBe('ios-other')
  })

  it('knows WeChat and QQ in-app browsers on both systems', () => {
    expect(detectInstallEnv(`${IPHONE} Mobile/15E148 MicroMessenger/8.0.50 NetType/WIFI`)).toBe('wechat')
    expect(detectInstallEnv(`${ANDROID} Chrome/120.0 Mobile Safari/537.36 MicroMessenger/8.0`)).toBe('wechat')
    expect(detectInstallEnv(`${IPHONE} Mobile/15E148 Safari/604.1 QQ/8.9.0`)).toBe('wechat')
    expect(detectInstallEnv(`${ANDROID} Chrome/120.0 Mobile MQQBrowser/6.2 Safari/537.36`)).toBe('wechat')
  })

  it('knows Android Chrome and other Android browsers', () => {
    expect(detectInstallEnv(`${ANDROID} Chrome/130.0.0.0 Mobile Safari/537.36`)).toBe('android-chrome')
    expect(detectInstallEnv(`${ANDROID} Chrome/130.0.0.0 Mobile Safari/537.36 EdgA/130.0`)).toBe('android-other')
    expect(detectInstallEnv(`${ANDROID} Chrome/130.0.0.0 Mobile Safari/537.36 SamsungBrowser/25.0`)).toBe(
      'android-other',
    )
    expect(
      detectInstallEnv(
        'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36',
      ),
    ).toBe('android-other')
  })

  it('treats everything else as a desktop browser', () => {
    expect(
      detectInstallEnv('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36'),
    ).toBe('desktop')
    expect(detectInstallEnv('')).toBe('desktop')
  })
})
