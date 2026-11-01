
请严格按下面清单使用 `Bash` tool 发From tool call。这个脚本只用于制造 Bash shell-provider 轨迹。

1. 只execute，不验证，不解释，不对比，不修复。
2. 每个 case 使用One个独立的 `Bash` tool call，不要合并多个 case。
3. 必须严格串行execute：按 S1、S2、S3 ... 的顺序逐个execute，上One条 Bash tool result Back后再发Next Bash tool call。平台不适用的 optional case 可以Skip。
4. 除非 case 单独写了 tool 参Count，否则只传 `command` and `description`。
5. 不要使用 `Read` / `Grep` / `Glob` / `Edit` / `Write` / `Agent` / `WebSearch` 等OtherTools。
6. 除了 `/tmp/cf-bash-shell-profile-*` and `/tmp/cf-bash-shell-profile-last-*`，不要创建or修改OtherTestsFile。
7. 即使CommandBack非 0，也Continue execution后续 Bash tool call。
8. executeCompleted后，只ReplyOne行：`DONE`。

## S1. Shell identity and process substitution

```json
{
  "description": "Print shell identity and process substitution output",
  "command": "printf 'CASE01 shell0=%s\\n' \"$0\"\nprintf 'CASE01 versions bash=%s zsh=%s\\n' \"${BASH_VERSION:-}\" \"${ZSH_VERSION:-}\"\ncat <(printf 'CASE01 process-substitution-ok\\n')"
}
```

## S2. Login shell mode

```json
{
  "description": "Check login shell mode",
  "command": "if [ -n \"${BASH_VERSION:-}\" ]; then\n  shopt -q login_shell\nelif [ -n \"${ZSH_VERSION:-}\" ]; then\n  [[ -o login ]]\nelse\n  false\nfi\nrc=$?\nprintf 'CASE02 login_rc=%s\\n' \"$rc\"\nprintf 'CASE02 shell_versions bash=%s zsh=%s\\n' \"${BASH_VERSION:-}\" \"${ZSH_VERSION:-}\""
}
```

## S3. Arrays and pipeline status

```json
{
  "description": "Run bash or zsh array and pipeline status syntax",
  "command": "if [ -n \"${BASH_VERSION:-}\" ]; then\n  arr=(a b)\n  printf 'CASE03 array=%s\\n' \"${arr[1]}\"\n  false | true\n  printf 'CASE03 pipe=%s %s\\n' \"${PIPESTATUS[0]}\" \"${PIPESTATUS[1]}\"\nelif [ -n \"${ZSH_VERSION:-}\" ]; then\n  arr=(a b)\n  printf 'CASE03 array=%s\\n' \"${arr[2]}\"\n  false | true\n  printf 'CASE03 pipe=%s %s\\n' \"${pipestatus[1]}\" \"${pipestatus[2]}\"\nelse\n  printf 'CASE03 unsupported-shell\\n'\nfi"
}
```

## S4. Double bracket regex

```json
{
  "description": "Run double bracket regex syntax",
  "command": "if [[ \"alpha-123\" =~ ^alpha-[0-9]+$ ]]; then\n  printf 'CASE04 regex-match\\n'\nelse\n  printf 'CASE04 regex-no-match\\n'\nfi"
}
```

## S5. Stdin close behavior

Tool 参Count：`timeout: 3000`

```json
{
  "description": "Confirm stdin closes without blocking",
  "timeout": 3000,
  "command": "cat >/tmp/cf-bash-shell-profile-stdin.txt\nprintf 'CASE05 after-cat\\n'"
}
```

## S6. Set persisted working directory inside workspace

```json
{
  "description": "Set persisted working directory inside workspace",
  "command": "START=\"$(pwd -P)\"\nif [ -d \"$START/apps/cli\" ]; then\n  NEXT=\"$START/apps/cli\"\nelif [ -d \"$START/packages/core\" ]; then\n  NEXT=\"$START/packages/core\"\nelif [ -d \"$START/src\" ]; then\n  NEXT=\"$START/src\"\nelse\n  NEXT=\"$START\"\nfi\nprintf '%s\\n' \"$START\" > /tmp/cf-bash-shell-profile-last-start-cwd\nprintf '%s\\n' \"$NEXT\" > /tmp/cf-bash-shell-profile-last-inside-cwd\ncd \"$NEXT\"\nprintf 'CASE06 start=%s\\n' \"$START\"\nprintf 'CASE06 pwd=%s\\n' \"$(pwd -P)\"\nprintf 'CASE06 cwd-set-inside\\n'"
}
```

## S7. Use persisted working directory

```json
{
  "description": "Use persisted working directory",
  "command": "printf 'CASE07 pwd=%s\\n' \"$(pwd -P)\"\nprintf 'CASE07 saved=%s\\n' \"$(cat /tmp/cf-bash-shell-profile-last-inside-cwd)\"\nprintf 'CASE07 cwd-persisted-inside\\n'"
}
```

## S8. Failed cwd change

```json
{
  "description": "Fail after changing directory",
  "command": "FAILED_OUT=\"/tmp/cf-bash-shell-profile-failed-cwd-${USER:-user}-$(date +%s)-$$\"\nmkdir -p \"$FAILED_OUT\"\ncd \"$FAILED_OUT\"\nprintf 'CASE08 before-fail-pwd=%s\\n' \"$(pwd -P)\"\nexit 3"
}
```

## S9. Working directory after failure

```json
{
  "description": "Print working directory after failed command",
  "command": "printf 'CASE09 after-failed-cd-pwd=%s\\n' \"$(pwd -P)\""
}
```

## S10. Successful outside cwd change

```json
{
  "description": "Change to outside temp directory successfully",
  "command": "OUTSIDE=\"/tmp/cf-bash-shell-profile-reset-cwd-${USER:-user}-$(date +%s)-$$\"\nmkdir -p \"$OUTSIDE\"\nprintf '%s\\n' \"$OUTSIDE\" > /tmp/cf-bash-shell-profile-last-outside-cwd\ncd \"$OUTSIDE\"\nprintf 'CASE10 outside-success-pwd=%s\\n' \"$(pwd -P)\"\nprintf 'CASE10 outside-success\\n'"
}
```

## S11. Working directory after outside reset

```json
{
  "description": "Print working directory after outside reset",
  "command": "printf 'CASE11 after-reset-pwd=%s\\n' \"$(pwd -P)\"\nprintf 'CASE11 start=%s\\n' \"$(cat /tmp/cf-bash-shell-profile-last-start-cwd)\"\nprintf 'CASE11 outside=%s\\n' \"$(cat /tmp/cf-bash-shell-profile-last-outside-cwd)\""
}
```

## S12. Nonzero stdout and stderr

```json
{
  "description": "Return stdout stderr and nonzero exit",
  "command": "printf 'CASE12 stdout-before-fail\\n'\nprintf 'CASE12 stderr-before-fail\\n' >&2\nexit 7"
}
```

## S13. Empty successful output

```json
{
  "description": "Run empty successful command",
  "command": "true"
}
```

## S14. Large stdout

```json
{
  "description": "Emit large stdout for persisted output",
  "command": "i=0\nwhile [ \"$i\" -lt 2200 ]; do\n  printf 'CASE14-%04d abcdefghijklmnopqrstuvwxyz\\n' \"$i\"\n  i=$((i + 1))\ndone"
}
```

## S15. PNG data URI stdout

```json
{
  "description": "Emit png data URI stdout",
  "command": "printf '%s' 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='"
}
```

## S16. PNG data URI with failure

```json
{
  "description": "Emit png data URI then fail",
  "command": "printf '%s\\n' 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='\nprintf 'CASE16 stderr-before-fail\\n' >&2\nexit 5"
}
```

## S17. Shell time keyword

```json
{
  "description": "Run shell time keyword",
  "command": "{ time printf 'CASE17 time-body\\n'; } 2>&1"
}
```

## S18. Ripgrep no match

```json
{
  "description": "Run ripgrep no match command",
  "command": "TMP=\"$(mktemp -d /tmp/cf-bash-shell-profile-rg.XXXXXX)\"\nprintf 'abc\\n' > \"$TMP/file.txt\"\nrg 'definitely-no-match-cf-shell-profile' \"$TMP\""
}
```

## S19. Background shell command

Tool 参Count：`run_in_background: true`

```json
{
  "description": "Run background shell command",
  "run_in_background": true,
  "command": "sleep 1\nprintf 'CASE19 background stdout\\n'\nprintf 'CASE19 background stderr\\n' >&2"
}
```

## S20. Final shell state

```json
{
  "description": "Print final shell state",
  "command": "printf 'CASE20 pwd=%s\\n' \"$(pwd -P)\"\nprintf 'CASE20 versions bash=%s zsh=%s\\n' \"${BASH_VERSION:-}\" \"${ZSH_VERSION:-}\""
}
```

## S21. Windows Git Bash optional addendum

如果Current session Run在 Windows，再execute这个 case；否则Skip。

```json
{
  "description": "Print Windows Git Bash shell details",
  "command": "printf 'CASE21 shell0=%s\\n' \"$0\"\nprintf 'CASE21 bash=%s\\n' \"${BASH_VERSION:-}\"\nprintf 'CASE21 pwd=%s\\n' \"$(pwd -P)\"\narr=(win bash)\nprintf 'CASE21 array=%s\\n' \"${arr[1]}\"\ncat <(printf 'CASE21 process-substitution\\n')"
}
```
