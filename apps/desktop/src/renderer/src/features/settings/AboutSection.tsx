import { translateMessage } from '../../i18n/core'
import { useI18n } from '@/i18n/I18nProvider'
import { tr, translateText } from '../../i18n/core'
import { useEffect, useState, type ReactNode } from 'react'
import { Check, Copy, ExternalLink, FolderOpen, RefreshCw } from 'lucide-react'
import type { AppInfo, AppLink } from '../../../../shared/types/app-info'
import { useAccount } from '@/features/account'
import { Button, Logo, useComingSoon } from '@/ui'

const CHANNEL_LABELS: Record<AppInfo['channel'], string> = {
  get dev() {
    return tr('settings.AboutSection.developmentMode')
  },
  get portable() {
    return tr('settings.AboutSection.portable')
  },
  get installed() {
    return tr('settings.AboutSection.installed')
  },
}

/** 开源组件致谢：只列直接依赖的主要部分 */
const CREDITS = ['Electron', 'React', 'Tailwind CSS', 'Lucide', 'Vite']

/** 设置 → 关于：版本、运行环境、账号服务、本地数据（docs/ui/settings.md §5） */
export function AboutSection({ onOpenAccount }: { onOpenAccount: () => void }) {
  useI18n()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const comingSoon = useComingSoon()
  const acc = useAccount()

  useEffect(() => {
    const bridge = window.pixelsky?.app
    if (!bridge) {
      setError(tr('settings.AboutSection.applicationInformationIsUnavailable'))
      return
    }
    bridge.getInfo().then(setInfo, (e: unknown) => setError(String((e as Error)?.message ?? e)))
  }, [])

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])

  const open = (link: AppLink) => {
    window.pixelsky?.app.open(link).catch((e: unknown) => setError(String((e as Error)?.message ?? e)))
  }

  const copyInfo = async () => {
    if (!info) return
    try {
      await navigator.clipboard.writeText(diagnostics(info))
      setCopied(true)
    } catch {
      setError(tr('settings.AboutSection.copyFailedSelectAnd'))
    }
  }

  const accountText =
    acc.status === 'signed-in'
      ? tr('settings.AboutSection.signedIn', { p0: acc.user?.email ?? '' })
      : acc.status === 'signing-in'
        ? tr('sidebar.SidebarFooter.signingIn')
        : acc.status === 'loading'
          ? tr('session.live.SessionStrips.loading')
          : tr('sidebar.SidebarFooter.notSignedIn')

  return (
    <section>
      <div className="mb-6 flex items-center gap-4">
        <Logo size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="text-section font-semibold text-fg">
              {translateText(info?.name ?? tr('ui.Logo.pixelStarrySky'))}
            </h3>
            <span className="text-meta text-fg-muted">{info?.englishName ?? 'Pixel Starry Sky'}</span>
          </div>
          <p className="mt-0.5 text-ui text-fg-secondary tabular-nums">
            {info
              ? tr('settings.AboutSection.version', { p0: info.version, p1: CHANNEL_LABELS[info.channel] })
              : tr('settings.AboutSection.version2')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button icon={RefreshCw} onClick={() => comingSoon(tr('settings.AboutSection.checkForUpdates'))}>
            {tr('settings.AboutSection.checkForUpdates')}{' '}
          </Button>
          <Button icon={copied ? Check : Copy} onClick={copyInfo} disabled={!info} aria-live="polite">
            {copied ? tr('code.CodeBlock.copied') : tr('settings.AboutSection.copyVersionInformation')}
          </Button>
        </div>
      </div>

      {error && <p className="mb-4 rounded-md bg-subtle px-3 py-2 text-meta text-danger">{translateMessage(error)}</p>}

      <Group title={tr('settings.AboutSection.runtimeEnvironment')}>
        <Row label={tr('settings.AboutSection.applicationVersion')} value={info?.version} mono />
        <Row label="Electron" value={info?.electron} mono />
        <Row label="Chromium" value={info?.chrome} mono />
        <Row label="Node.js" value={info?.node} mono />
        <Row label={tr('settings.AboutSection.system')} value={info && `${info.os}（${info.arch}）`} />
      </Group>

      <Group title={tr('settings.AboutSection.accountAndData')}>
        <Row
          label={tr('settings.AboutSection.account')}
          value={accountText}
          action={
            <button
              type="button"
              onClick={onOpenAccount}
              className="press no-drag h-7 shrink-0 rounded-md px-2 text-meta text-fg-secondary hover:bg-hover hover:text-fg"
            >
              {tr('settings.AboutSection.manage')}{' '}
            </button>
          }
        />
        <Row
          label={tr('settings.AboutSection.authenticationService')}
          value={info?.authUrl.replace(/^https?:\/\//, '')}
          mono
          action={
            <LinkButton
              label={tr('settings.AboutSection.openAuthenticationServiceIn')}
              onClick={() => open('auth')}
              icon="external"
            />
          }
        />
        <Row
          label={tr('settings.AboutSection.dataDirectory')}
          value={info?.dataDir}
          mono
          title={info?.dataDir}
          action={
            <LinkButton
              label={tr('settings.AboutSection.openDataDirectory')}
              onClick={() => open('data-dir')}
              icon="folder"
            />
          }
        />
      </Group>

      <Group title={tr('settings.AboutSection.links')}>
        <Row
          label={tr('settings.AboutSection.sourceRepository')}
          value={info?.repoUrl.replace(/^https:\/\//, '')}
          mono
          action={
            <LinkButton
              label={tr('settings.AboutSection.openSourceRepositoryIn')}
              onClick={() => open('repo')}
              icon="external"
            />
          }
        />
      </Group>

      <p className="mt-6 text-meta text-fg-faint">
        {tr('settings.AboutSection.builtWith')} {CREDITS.join('、')}
        {tr('settings.AboutSection.andOtherOpenSource')} <br />© 2026 Pixel Starry Sky
      </p>
    </section>
  )
}

/** 复制给别人排查问题用的一段纯文本 */
function diagnostics(info: AppInfo): string {
  return [
    `${translateText(info.name)}（${info.englishName}）${info.version} · ${CHANNEL_LABELS[info.channel]}`,
    `Electron ${info.electron} · Chromium ${info.chrome} · Node.js ${info.node} · V8 ${info.v8}`,
    `${info.os}（${info.arch}）`,
    tr('settings.AboutSection.authenticationService2', { p0: info.authUrl }),
  ].join('\n')
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  useI18n()
  return (
    <div className="mb-5">
      <h4 className="mb-2 text-meta font-medium text-fg-muted">{title}</h4>
      <dl className="overflow-hidden rounded-lg border border-line">{children}</dl>
    </div>
  )
}

function Row({
  label,
  value,
  mono,
  title,
  action,
}: {
  label: string
  value: string | null | undefined
  mono?: boolean
  title?: string
  action?: ReactNode
}) {
  useI18n()
  return (
    <div className="flex min-h-10 items-center gap-4 border-b border-line-subtle px-4 py-1.5 last:border-b-0">
      <dt className="w-20 shrink-0 text-ui text-fg-muted">{label}</dt>
      <dd
        title={title}
        className={`selectable min-w-0 flex-1 truncate text-ui text-fg ${mono ? 'font-mono text-meta' : ''}`}
      >
        {value ?? '—'}
      </dd>
      {action}
    </div>
  )
}

function LinkButton({ label, onClick, icon }: { label: string; onClick: () => void; icon: 'external' | 'folder' }) {
  useI18n()
  const Icon = icon === 'folder' ? FolderOpen : ExternalLink
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="press no-drag flex size-7 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
    >
      <Icon size={15} strokeWidth={1.5} />
    </button>
  )
}
