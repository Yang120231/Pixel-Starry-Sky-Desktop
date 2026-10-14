// 假的登录命令：印网址，印不带换行的提示符，等 stdin 一行，按参数退出
const mode = process.argv[2] ?? 'code'
if (mode === 'split') {
  // 网址分两段送出，中间停一会儿（像管道里分块到达）
  process.stdout.write("If the browser didn't open, visit: https://claude.com/cai/oa")
  setTimeout(() => {
    process.stdout.write('uth/authorize?code=true\n')
    process.exit(0)
  }, 400)
} else {
  console.log("If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&state=abc")
  if (mode === 'hang') setInterval(() => {}, 1000)
  else if (mode === 'exit') process.exit(Number(process.argv[3] ?? 0))
  else {
    process.stdout.write('\x1b[2mPaste code here if prompted >\x1b[0m ')
    process.stdin.setEncoding('utf8')
    let buf = ''
    process.stdin.on('data', d => {
      buf += d
      if (buf.includes('\n')) {
        console.log('got ' + buf.trim())
        process.exit(buf.trim() === 'bad' ? 1 : 0)
      }
    })
  }
}
