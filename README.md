# shell-scripts

A [Pi Coding Agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) extension that turns shell scripts in `.pi/bash/` into callable tools.

## What it does

- Scans `.pi/bash/` for `*.sh` files
- Registers each script as a Pi tool (tool name = filename without `.sh`)
- Executes scripts through Pi’s built-in bash tool
- Supports optional script args via an `args` parameter
- Supports per-script timeout metadata
- Adds a `reload-scripts` command to re-scan and re-register tools

## Script discovery rules

Only files in `.pi/bash/` are registered when they:

- are regular files
- end with `.sh`
- are not hidden (don’t start with `.`)
- have a valid base name matching: `^[a-z0-9_-]+$`

Examples of valid names:

- `py_version.sh`
- `lint-all.sh`
- `deploy_prod.sh`

## Script metadata

### Description

The extension derives a tool description from the first lines of the script:

1. `# Description: ...` (preferred)
2. first non-empty comment line (`# ...`)
3. fallback: `Run the <script-name> script`

### Timeout

Set a script timeout using:

```bash
# timeout: 300
```

If omitted, the default timeout is **120 seconds**.

## Usage

### 1) Add scripts

Create scripts in:

```text
.pi/bash/
```

Example:

```bash
#!/usr/bin/env bash
# Description: Print installed Python version
python3 --version
```

### 2) Start Pi

On session start, the extension auto-registers script tools.

### 3) Reload after changes

If you add/remove scripts while Pi is running, run:

```text
/reload-scripts
```

## Tool behavior

When a script tool is called:

- optional `args` are appended to `bash "<script>" <args>`
- script execution is delegated to Pi’s bash tool
- if the script no longer exists, the tool returns an error

## Local development

This extension is declared in `package.json`:

```json
"pi": {
  "extensions": ["./index.ts"]
}
```

So Pi can load it directly from this project.
