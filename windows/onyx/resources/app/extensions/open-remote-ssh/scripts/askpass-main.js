#!/usr/bin/env node
/**
 * SSH_ASKPASS Node.js client
 * Communicates with VS Code extension through Unix socket to get password/passphrase
 */

const net = require('net');
const fs = require('fs');

// Helper function to decode octal escape sequences in strings
// SSH may escape non-ASCII characters (like Chinese) as \xxx octal sequences
// These are UTF-8 bytes encoded as octal, so we need to decode them properly
function decodeOctalEscapes(str) {
	if (!str) return str;

	// Find all octal escape sequences and collect them
	const matches = str.match(/(?:\\[0-7]{3})+/g);
	if (!matches) return str;

	let result = str;
	for (const match of matches) {
		// Extract all octal sequences from this match
		const octals = match.match(/\\([0-7]{3})/g);
		if (!octals) continue;

		// Convert each octal to a byte value
		const bytes = octals.map(oct => parseInt(oct.slice(1), 8));

		// Create a Buffer from the bytes and decode as UTF-8
		const decoded = Buffer.from(bytes).toString('utf8');

		// Replace in result
		result = result.replace(match, decoded);
	}

	return result;
}

// Get arguments
let prompt = process.argv[2];
const socketPath = process.argv[3];

if (!prompt || !socketPath) {
	console.error('ERROR: Usage: askpass-main.js <prompt> <socket-path>');
	console.error(`ERROR: Received ${process.argv.length} arguments: ${process.argv.join(' ')}`);
	process.exit(1);
}

// Decode octal escape sequences that SSH might have added
const originalPrompt = prompt;
prompt = decodeOctalEscapes(prompt);

// Debug: Print what we're doing
console.error(`DEBUG: askpass-main.js starting`);
if (originalPrompt !== prompt) {
	console.error(`DEBUG: Original prompt (with escapes): ${originalPrompt}`);
	console.error(`DEBUG: Decoded prompt: ${prompt}`);
} else {
	console.error(`DEBUG: Prompt: ${prompt}`);
}
console.error(`DEBUG: Socket path: ${socketPath}`);
console.error(`DEBUG: Working directory: ${process.cwd()}`);

// Note: On some systems (like macOS), Unix domain socket files may not be
// visible via fs.existsSync even though the socket is listening and ready.
// We'll try to check, but if not found, we'll still attempt to connect.

let socketVisible = false;
let socketCheckRetries = 3;

while (!fs.existsSync(socketPath) && socketCheckRetries > 0) {
	console.error(`DEBUG: Socket file not visible, waiting... (${socketCheckRetries} retries left)`);
	// Wait 100ms before retry (use synchronous sleep)
	const now = Date.now();
	while (Date.now() - now < 100) {
		// Busy wait
	}
	socketCheckRetries--;
}

socketVisible = fs.existsSync(socketPath);
if (socketVisible) {
	console.error(`DEBUG: Socket file found and visible`);
} else {
	console.error(`DEBUG: Socket file not visible via fs.existsSync, but will attempt connection anyway`);
	console.error(`DEBUG: (This is normal on some systems where Unix sockets work without visible files)`);
}

console.error(`DEBUG: Attempting connection to ${socketPath}...`);

// Connect to VS Code extension socket
const client = net.createConnection(socketPath);
let response = '';

client.on('connect', () => {
	// Send the prompt request to VS Code
	const request = JSON.stringify({ request: prompt }) + '\n';
	client.write(request);
});

client.on('data', (data) => {
	response += data.toString();

	// Check if we received a complete response (ends with newline)
	if (response.endsWith('\n')) {
		try {
			const parsed = JSON.parse(response.trim());

			if (parsed.password !== undefined) {
				// Output the password to stdout (SSH will read it)
				process.stdout.write(parsed.password);
				client.end();
				process.exit(0);
			} else if (parsed.cancelled) {
				// User cancelled the prompt
				client.end();
				process.exit(1);
			} else {
				console.error('Invalid response from VS Code');
				client.end();
				process.exit(1);
			}
		} catch (err) {
			console.error('Failed to parse response:', err.message);
			client.end();
			process.exit(1);
		}
	}
});

client.on('error', (err) => {
	console.error(`ERROR: Socket connection failed: ${err.message}`);
	console.error(`ERROR: Socket path: ${socketPath}`);
	console.error(`ERROR: Error code: ${err.code || 'N/A'}`);

	// Check if it's a connection refused error
	if (err.code === 'ECONNREFUSED') {
		console.error(`ERROR: Connection refused - server may not be listening`);
	} else if (err.code === 'ENOENT') {
		console.error(`ERROR: Socket file not found - server may not have started`);
	}

	process.exit(1);
});

client.on('end', () => {
	if (!response) {
		console.error('Connection closed without response');
		process.exit(1);
	}
});

// Timeout after 5 minutes
setTimeout(() => {
	console.error('Timeout waiting for password');
	client.end();
	process.exit(1);
}, 5 * 60 * 1000);

