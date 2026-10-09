import type { TerminalProfile } from '../../../preload/terminal'
export const demoTerminalProfiles: TerminalProfile[] = [
  { id: 'pwsh', label: 'PowerShell 7', command: 'pwsh.exe', args: [], available: true },
  { id: 'cmd', label: 'cmd', command: 'cmd.exe', args: ['/d'], available: true },
  { id: 'git-bash', label: 'Git Bash', command: 'bash.exe', args: ['--login', '-i'], available: true },
]
export const demoTerminalOutput = '\u001b[32mPixelSky\u001b[0m\r\n$ pnpm build\r\n\u001b[32m✓\u001b[0m Build complete\r\n$ '
