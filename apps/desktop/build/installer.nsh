; 安装向导的自定义部分（docs/release-update.md §9），electron-builder 自动读 build/installer.nsh
;
; 选完安装位置后、开始安装前插入一个不显示的页面，做两件事：
; 1. 最后一级文件夹不是「PixelSky」时补一层 \PixelSky。
;    卸载会整个删掉安装目录：选 D:\Tools 就装到 D:\Tools\PixelSky，删不到用户自己的文件。
;    （electron-builder 自带的检查只看路径里「包含」应用名，选 D:\PixelSkyStuff 时不会补。）
;    目录里已经装着像素星空（覆盖安装、老版本的目录）时不补。
; 2. 位置没有写权限（「仅为我」却选了 Program Files）时提示，并回到选择位置那一页。
; 自动更新（--updated）时跳过，装回原来的位置。

; 安装文件夹名：产品名是中文时 electron-builder 会改用包名（@pixelsky/desktop → @pixelskydesktop）。
; 不能改包名：数据目录（%APPDATA%\@pixelsky\desktop）跟着包名走，改了老用户的设置和会话就找不到了。
; 这个文件在模板之前载入，所以在这里只改安装程序用的文件夹名。
!ifdef APP_FILENAME
  !undef APP_FILENAME
!endif
!define APP_FILENAME "PixelSky"

; 函数写在宏里：宏在安装程序的页面顺序里才展开（这时 LogicLib、isUpdated 都已就绪），卸载程序里不展开
!macro customPageAfterChangeDir
  !include LogicLib.nsh
  !include FileFunc.nsh
  Page custom pixelskyCheckDir

Function pixelskyCheckDir
  ${if} ${isUpdated}
    Abort
  ${endif}

  ; 1. 补子文件夹
  ${GetFileName} "$INSTDIR" $0
  ${if} $0 != "${APP_FILENAME}"
  ${andIfNot} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
  ${endif}

  ; 2. 写权限：从安装目录往上找到第一个已存在的文件夹，试着在里面建一个临时文件
  ; 判断文件夹是否存在用属性（GetFileAttributes），不用 FileExists "\*.*"：后者要列目录，没有列目录权限时会当成不存在
  StrCpy $1 "$INSTDIR"
  ${do}
    ${GetFileAttributes} "$1" "DIRECTORY" $4
    ${if} $4 == 1
      ${break}
    ${endif}
    ${GetParent} "$1" $2
    ${if} $2 == ""
    ${orIf} $2 == $1
      ${break}
    ${endif}
    StrCpy $1 $2
  ${loop}
  ClearErrors
  FileOpen $3 "$1\pixelsky-write-test.tmp" w
  ${ifNot} ${Errors}
    FileClose $3
    Delete "$1\pixelsky-write-test.tmp"
    Abort
  ${endif}

  ${if} $LANGUAGE == 2052
    MessageBox MB_OK|MB_ICONEXCLAMATION "没有权限写入这个位置：$\r$\n$INSTDIR$\r$\n$\r$\n请换一个位置，或者返回上一步选择「为所有用户安装」。"
  ${else}
    MessageBox MB_OK|MB_ICONEXCLAMATION "You don't have permission to write to:$\r$\n$INSTDIR$\r$\n$\r$\nChoose another location, or go back and install for all users."
  ${endif}
  ; 回到选择位置那一页（去掉刚补上的子文件夹，免得再补一层）
  ${GetFileName} "$INSTDIR" $0
  ${if} $0 == "${APP_FILENAME}"
  ${andIfNot} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    ${GetParent} "$INSTDIR" $INSTDIR
  ${endif}
  SendMessage $HWNDPARENT 0x408 -1 ""
  Abort
FunctionEnd
!macroend
