// 我的：配对过的电脑（切换、在手机上删掉）、锁屏提醒、主题、语言（§25）、关于
import type { ReactNode } from 'react'
import { Check, Laptop, Plus, ShieldCheck, SquarePlus, Trash2 } from 'lucide-react'
import { connections, phoneFingerprint } from '@/connection'
import { useConnections } from '@/data/hooks'
import { L, langPreference, setLangPreference, type LangPreference } from '@/i18n'
import { linkStateLabel } from '@/i18n/labels'
import { promptInstall, useInstallEntry } from '@/platform/pwa'
import { Dot, Row, Screen, Section, Segmented } from '@/ui'
import { PushRow } from './PushRow'
import { themeOptions, useThemePreference } from './theme'

export function MeScreen({ menu, onAdd, onInstall }: { menu: ReactNode; onAdd: () => void; onInstall: () => void }) {
  const { list, active } = useConnections()
  const [theme, setTheme] = useThemePreference()
  const install = useInstallEntry()
  return (
    <Screen large title={L('我的', 'Me')} leading={menu}>
      <div className="flex flex-col gap-6 pb-8">
        <Section title={L('电脑', 'Computers')}>
          {list.map(p => {
            const state = connections.state(p.deviceId)
            return (
              <Row
                key={p.deviceId}
                icon={<Laptop size={22} strokeWidth={1.5} />}
                title={p.desktopName}
                subtitle={
                  <span className="inline-flex items-center gap-1.5">
                    <Dot
                      tone={
                        state === 'ready'
                          ? 'online'
                          : state === 'removed' || state === 'incompatible'
                            ? 'danger'
                            : 'muted'
                      }
                    />
                    {state ? linkStateLabel(state) : ''}
                  </span>
                }
                trailing={active?.deviceId === p.deviceId ? <Check size={20} className="text-accent-fg" /> : undefined}
                onClick={() => connections.select(p.deviceId)}
              />
            )
          })}
          <Row
            icon={<Plus size={22} strokeWidth={1.5} />}
            title={L('添加电脑', 'Add a computer')}
            subtitle={L(
              '扫码，或粘贴电脑上复制的配对链接',
              'Scan the QR code, or paste the pairing link copied on the computer',
            )}
            onClick={onAdd}
            chevron
          />
        </Section>

        {install > 0 && (
          <Section>
            <Row
              icon={<SquarePlus size={22} strokeWidth={1.5} />}
              title={L('添加到主屏幕', 'Add to Home Screen')}
              subtitle={L(
                '像 App 一样从桌面图标打开，没有地址栏',
                'Open it from a home screen icon like an app, without the address bar',
              )}
              onClick={() => (install === 2 ? void promptInstall() : onInstall())}
              chevron={install === 1}
            />
          </Section>
        )}

        {list.length > 0 && <PushRow onInstall={onInstall} />}

        {active && (
          <Section title={L('安全', 'Security')}>
            <Row
              icon={<ShieldCheck size={20} strokeWidth={1.5} />}
              title={L('电脑指纹', 'Computer fingerprint')}
              trailing={<code className="font-mono text-meta text-fg-muted">{active.fingerprint}</code>}
            />
            <Row
              icon={<ShieldCheck size={20} strokeWidth={1.5} />}
              title={L('本机指纹', "This phone's fingerprint")}
              trailing={<code className="font-mono text-meta text-fg-muted">{phoneFingerprint(active)}</code>}
            />
            <Row
              icon={<Trash2 size={20} strokeWidth={1.5} className="text-danger" />}
              title={
                <span className="text-danger">
                  {L(`在这部手机上删掉「${active.desktopName}」`, `Remove “${active.desktopName}” from this phone`)}
                </span>
              }
              subtitle={L('电脑那边要在 设置 › 手机 里移除', 'On the computer, remove it in Settings › Phone')}
              onClick={() => {
                if (
                  confirm(
                    L(`在这部手机上删掉「${active.desktopName}」？`, `Remove “${active.desktopName}” from this phone?`),
                  )
                )
                  connections.forget(active.deviceId)
              }}
            />
          </Section>
        )}

        <div className="px-4">
          <div className="px-1 pb-2 text-meta font-medium text-fg-muted">{L('主题', 'Theme')}</div>
          <Segmented options={themeOptions()} value={theme} onChange={setTheme} />
        </div>

        <div className="px-4">
          <div className="px-1 pb-2 text-meta font-medium text-fg-muted">{L('语言', 'Language')}</div>
          <Segmented<LangPreference>
            options={[
              { value: 'system', label: L('跟随系统', 'System') },
              { value: 'zh', label: '中文' },
              { value: 'en', label: 'English' },
            ]}
            value={langPreference()}
            onChange={setLangPreference}
          />
          <p className="px-1 pt-2 text-label text-fg-faint">
            {L(
              'AI 的回复、文件内容和电脑上的提示原文不翻译。',
              'AI replies, file contents and messages from the computer are not translated.',
            )}
          </p>
        </div>

        <p className="px-5 text-center text-label text-fg-faint">
          {L(
            '像素星空 · 手机版（网页）。内容在手机和电脑之间端到端加密。',
            'PixelSky · mobile web. Content is end-to-end encrypted between your phone and computer.',
          )}
        </p>
      </div>
    </Screen>
  )
}
