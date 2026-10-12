// 开发版（pnpm dev / dev:demo）用自己的数据目录：安装版和开发版的应用名都是 @pixelsky/desktop，
// 默认会用同一个 %APPDATA%\@pixelsky\desktop——单实例锁也按数据目录算，开着安装版时开发版一启动就退出（唤起安装版的窗口），
// 而且开发版会读写安装版真实的会话、设置和账号。安装版的位置不变（改了会丢数据）。
// 必须在 index.ts 里第一个导入：别的模块初始化时可能就读数据目录。
import { join, resolve } from 'node:path'
import { app } from 'electron'

const override = process.env.PIXELSKY_USER_DATA
if (override) app.setPath('userData', override)
// 已经用 --user-data-dir 或 setPath 换过（测试、截图）的不动。默认路径里混着 \ 和 /（@pixelsky/desktop），比较前先规范化
else if (!app.isPackaged && resolve(app.getPath('userData')) === resolve(app.getPath('appData'), app.name))
  app.setPath('userData', join(app.getPath('appData'), '@pixelsky', 'desktop-dev'))
