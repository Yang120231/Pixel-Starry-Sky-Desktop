// 设置云同步（docs/ui/settings-sync.md）：主进程和渲染进程之间传的东西

/** 云端的一项设置：值和服务端给的更新时间（毫秒，严格递增） */
export interface CloudSetting {
  value: unknown
  updatedAt: number
}
export type CloudSettings = Record<string, CloudSetting>

/** 拉取 / 上传的结果；account 是当时登录的账号，没登录时为 null */
export interface SettingsSyncReply {
  account: string | null
  settings: CloudSettings
}
