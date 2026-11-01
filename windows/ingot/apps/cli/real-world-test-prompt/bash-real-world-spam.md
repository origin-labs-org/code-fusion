
请严格按下面清单使用 `Bash` tool 发From tool call。这个脚本只用于制造 Bash tool result 轨迹。

1. 只execute，不验证，不解释，不对比，不修复。
2. 每个 case 使用One个独立的 `Bash` tool call，不要合并多个 case。
3. 必须严格串行execute：按 A1、A2、A3 ... J2 的顺序逐个execute，上One条 Bash tool result Back后再发Next Bash tool call。
4. 除非 case 单独写了 tool 参Count，否则只传 `command`。
5. 不要修改代码，不要Submit，不要清理临时File。
6. 不要To semantic exit E关CommandAppend `echo $?`、`true`、`echo done` or任何会覆盖Final exit code 的语句。
7. executeCompleted后，只Reply两行：
   - `Executed: ...`
   - `Not executed: ...`

### A1

```bash
echo "test $(date +%T)"
```

### A2

```bash
pwd
```

### A3

```bash
whoami && uname -a
```

### A4

```bash
echo $((2 + 2))
```

### A5

```bash
printf 'l1\nl2\nl3\n' | wc -l
```

### A6

```bash
printf '%s\n' alpha bravo | grep -n bravo
```

### A7

```bash
echo "stderr" >&2; echo "stdout"
```

### A8

```bash
printf 'encode me\n' | base64
```

### A9

```bash
seq 1 5 | paste -sd+ - | bc
```

### A10

使用 Bash tool，`command` 传Empty string：

```bash

```

### A11

```bash
touch /tmp/cf_bash_silent_$$
```

### B1

```bash
exit 5
```

### B2

```bash
false
```

### B3

```bash
true && echo "ok"
```

### B4

```bash
false || echo "fallback"
```

### B5

```bash
set -o pipefail; false | true; printf 'pf=%s\n' "$?"; set +o pipefail
```

### B6

Tool 参Count：`timeout: 100`

```bash
sleep 2
```

### C1

```bash
git rev-parse --short HEAD
```

### C2

```bash
git branch --show-current
```

### C3

```bash
node -e "console.log(process.version)"
```

### C4

```bash
command -v git; command -v node; command -v rg || true
```

## D. Image output

### D1

```bash
printf '%s' 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC'
```

### D2

```bash
printf '%s' 'data:image/png;base64,@@@@'
```

### D3

```bash
printf '%s' 'data:image/jpeg;base64,dGlueQ=='
```

### D4

```bash
printf '%s' 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC'; exit 7
```

## E. Large output / persisted output

### E1

```bash
seq 1 20000
```

### E2

```bash
yes x | head -c 60000
```

### E3

```bash
node -e 'process.stderr.write("E".repeat(60000))'
```

### E4

```bash
node -e 'process.stdout.write("O".repeat(60000)); process.exit(2)'
```

## F. Background task

### F1

Tool 参Count：`run_in_background: true`

```bash
sleep 8 && echo "bg done at $(date +%T)"
```

### F2

```bash
for i in 1 2 3; do echo "loop $i"; sleep 1; done
```

### F3

```bash
sleep 16 && echo "auto bg probe at $(date +%T)"
```

## G. Semantic non-error exits

不要To G1-G10 的CommandAppend任何语句。

### G1

```bash
grep 'definitely_missing_cf_token_123' /dev/null
```

### G2

```bash
grep 'definitely_missing_cf_token_123' /etc/hosts
```

### G3

```bash
rg 'definitely_missing_cf_token_123' /etc/hosts
```

### G4

```bash
egrep 'definitely_missing_cf_token_123' /etc/hosts
```

### G5

```bash
fgrep 'definitely_missing_cf_token_123' /etc/hosts
```

### G6

```bash
find /definitely_missing_cf_dir_123456 -name anything
```

### G7

```bash
printf 'left\n' > /tmp/cf_bash_diff_a_$$; printf 'right\n' > /tmp/cf_bash_diff_b_$$; diff /tmp/cf_bash_diff_a_$$ /tmp/cf_bash_diff_b_$$
```

### G8

```bash
test "abc" = "xyz"
```

### G9

```bash
[ "abc" = "xyz" ]
```

### G10

```bash
[ -d /definitely_missing_cf_dir_123456 ]
```

### G11

```bash
false
```

### G12

```bash
exit 1
```

### G13

```bash
ls /definitely_missing_cf_path_123456
```

### G14

```bash
rg --definitely-not-a-real-flag missing
```

## H. cwd / env / shell state

### H1

```bash
echo "before cd: $PWD"
```

### H2

```bash
cd /tmp; echo "after cd: $PWD"
```

### H3

```bash
pwd
```

### H4

```bash
MYENV=injected_$$; echo "var=$MYENV"
```

### H5

```bash
echo "after=$MYENV"
```

### H6

```bash
cf_tmp_func() { echo persisted-function; }; cf_tmp_func
```

### H7

```bash
cf_tmp_func
```

## I. gh rate-limit hint

这里用 shell function 模拟 `gh`，不要改成真实 GitHub Request。

### I1

```bash
command -v gh && gh --version || echo "gh NOT installed"
```

### I2

```bash
gh() { printf '%s\n' 'HTTP 404: Not Found'; return 1; }; gh repo view fake/fake
```

### I3

```bash
gh() { printf '%s\n' 'API rate limit exceeded'; return 1; }; gh auth status
```

### I4

```bash
gh() { printf '%s\n' 'API rate limit exceeded'; return 0; }; gh repo view fake/fake
```

### I5

```bash
gh() { printf '%s\n' 'API rate limit exceeded'; return 1; }; gh repo view fake/fake
```

## J. claude-code-hint text branches

### J1

```bash
printf 'visible\n<claude-code-hint v="1" type="plugin" value="demo@example" />\nafter\n'
```

### J2

```bash
printf 'visible\n<claude-code-hint v="1" type="plugin" value="demo@example" />\nafter\n'; exit 3
```

只Reply下面两行，不要Add任何Analytics：

```text
Executed: A1,A2,...
Not executed: none
```
