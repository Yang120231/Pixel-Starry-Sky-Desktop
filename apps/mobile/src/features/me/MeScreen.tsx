// 设置（抽屉底部的齿轮进来）：iOS 分组列表（§26）——电脑（切换、添加）、通用（外观、语言、锁屏提醒、添加到主屏幕）、
// 安全（指纹、在手机上删掉）、页脚。外观和语言各一行：右边显示当前值，点开底部面板选。
import { useState, type ReactNode } from 'react'
import { Check, Globe, Laptop, Moon, Plus, ShieldCheck, SquarePlus, Trash2 } from 'lucide-react'
import { connections, phoneFingerprint } from '@/connection'
import { useConnections } from '@/data/hooks'
import { L, langPreference, setLangPreference, type LangPreference } from '@/i18n'
import { linkStateLabel } from '@/i18n/labels'
import { promptInstall, useInstallEntry } from '@/platform/pwa'
import { Dot, Row, Screen, Section, cn } from '@/ui'
import { Sheet } from '@/ui/sheet'
import { PushRow } from './PushRow'
import { themeOptions, useThemePreference } from './theme'

const langOptions = (): { value: LangPreference; label: string }[] => [
  { value: 'system', label: L('跟随系统', 'System') },
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
]

/** 单选面板：一行一项，选中的右边打勾；点一项就选中并关掉 */
function PickSheet<T extends string>({
  title,
  options,
  value,
  note,
  onPick,
  onClose,
}: {
  title: string
  options: readonly { value: T; label: string }[]
  value: T
  note?: ReactNode
  onPick(value: T): void
  onClose(): void
}) {
  return (
    <Sheet title={title} onClose={onClose}>
      <div role="radiogroup" aria-label={title} className="flex flex-col px-5 pb-3">
        {options.map((o, i) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            onClick={() => {
              onPick(o.value)
              onClose()
            }}
            className={cn(
              'flex min-h-12 w-full items-center gap-3 py-2 text-left text-ui active:bg-hover',
              i > 0 && 'border-t border-line-subtle',
              o.value === value && 'font-medium',
            )}
          >
            <span className="flex-1">{o.label}</span>
            {o.value === value && <Check size={20} className="shrink-0 text-accent-fg" />}
          </button>
        ))}
        {note && <p className="pt-2 text-label text-fg-faint">{note}</p>}
      </div>
    </Sheet>
  )
}

export function MeScreen({ menu, onAdd, onInstall }: { menu: ReactNode; onAdd: () => void; onInstall: () => void }) {
  const { list, active } = useConnections()
  const [theme, setTheme] = useThemePreference()
  const install = useInstallEntry()
  const [picker, setPicker] = useState<'theme' | 'lang' | null>(null)
  const themes = themeOptions()
  const langs = langOptions()
  const lang = langPreference()
  return (
    <Screen large title={L('设置', 'Settings')} leading={menu}>
      <div className="flex flex-col gap-5 pb-8">
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
            icon={<Plus size={22} strokeWidth={1.5} className="text-accent-fg" />}
            title={<span className="text-accent-fg">{L('添加电脑', 'Add a computer')}</span>}
            onClick={onAdd}
          />
        </Section>

        <Section title={L('通用', 'General')}>
          <Row
            icon={<Moon size={22} strokeWidth={1.5} />}
            title={L('外观', 'Appearance')}
            trailing={<span className="text-meta text-fg-muted">{themes.find(o => o.value === theme)?.label}</span>}
            onClick={() => setPicker('theme')}
            chevron
          />
          <Row
            icon={<Globe size={22} strokeWidth={1.5} />}
            title={L('语言', 'Language')}
            trailing={<span className="text-meta text-fg-muted">{langs.find(o => o.value === lang)?.label}</span>}
            onClick={() => setPicker('lang')}
            chevron
          />
          {list.length > 0 && <PushRow onInstall={onInstall} />}
          {/* 0 也表示在 App 里 / 已从主屏幕打开，不是「已添加」，所以整行不显示 */}
          {install > 0 && (
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
          )}
        </Section>

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

        <p className="px-5 text-center text-label text-fg-faint">
          {L(
            '像素星空 · 手机版（网页）。内容在手机和电脑之间端到端加密。',
            'PixelSky · mobile web. Content is end-to-end encrypted between your phone and computer.',
          )}
        </p>
      </div>

      {picker === 'theme' && (
        <PickSheet
          title={L('外观', 'Appearance')}
          options={themes}
          value={theme}
          onPick={setTheme}
          onClose={() => setPicker(null)}
        />
      )}
      {picker === 'lang' && (
        <PickSheet
          title={L('语言', 'Language')}
          options={langs}
          value={lang}
          onPick={setLangPreference}
          note={L(
            'AI 的回复、文件内容和电脑上的提示原文不翻译。',
            'AI replies, file contents and messages from the computer are not translated.',
          )}
          onClose={() => setPicker(null)}
        />
      )}
    </Screen>
  )
}
