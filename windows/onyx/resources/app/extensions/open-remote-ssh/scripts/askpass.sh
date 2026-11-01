#!/bin/sh
# SSH_ASKPASS script for qoder remote-ssh extension
# This script is called by SSH when it needs password/passphrase input
# It communicates with VS Code through a Unix socket

# Debug output
echo "DEBUG: askpass.sh called" >&2
echo "DEBUG: Arguments: $@" >&2
echo "DEBUG: Arg count: $#" >&2

# The prompt text is passed as $1
# Note: SSH may escape non-ASCII characters (like Chinese) as octal sequences
# These will be decoded by the Node.js script
PROMPT="$1"
if [ -z "$PROMPT" ]; then
	# Read from stdin if no argument provided
	echo "DEBUG: No argument provided, reading from stdin" >&2
	read -r PROMPT
fi

echo "DEBUG: PROMPT (may contain octal escapes)=\"$PROMPT\"" >&2

# VSCODE_SSH_ASKPASS_HANDLE is set by the extension with the socket path
if [ -z "$VSCODE_SSH_ASKPASS_HANDLE" ]; then
	echo "ERROR: VSCODE_SSH_ASKPASS_HANDLE not set" >&2
	exit 1
fi

echo "DEBUG: VSCODE_SSH_ASKPASS_HANDLE=$VSCODE_SSH_ASKPASS_HANDLE" >&2

# VSCODE_SSH_ASKPASS_NODE is set by the extension with the Node.js path
if [ -z "$VSCODE_SSH_ASKPASS_NODE" ]; then
	echo "ERROR: VSCODE_SSH_ASKPASS_NODE not set" >&2
	exit 1
fi

echo "DEBUG: VSCODE_SSH_ASKPASS_NODE=$VSCODE_SSH_ASKPASS_NODE" >&2

# VSCODE_SSH_ASKPASS_MAIN is set by the extension with the main script path
if [ -z "$VSCODE_SSH_ASKPASS_MAIN" ]; then
	echo "ERROR: VSCODE_SSH_ASKPASS_MAIN not set" >&2
	exit 1
fi

echo "DEBUG: VSCODE_SSH_ASKPASS_MAIN=$VSCODE_SSH_ASKPASS_MAIN" >&2

# Call Node.js script to communicate with VS Code and get the password
echo "DEBUG: Calling Node.js script..." >&2
exec "$VSCODE_SSH_ASKPASS_NODE" "$VSCODE_SSH_ASKPASS_MAIN" "$PROMPT" "$VSCODE_SSH_ASKPASS_HANDLE"

