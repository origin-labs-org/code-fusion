"use strict";
/**
 * Port/Socket forwarder for Dev Containers.
 *
 * This script runs as a standalone Node.js process on the host machine.
 * It creates a local TCP server that forwards connections into the container
 * via `docker exec`, enabling the VS Code client to communicate with the
 * VS Code Server running inside the container.
 *
 * Usage:
 *   node forwarder.js port <container_id> <remote_node_path> <remote_user> <remote_port> [docker_path]
 *   node forwarder.js socket <container_id> <remote_node_path> <remote_user> <local_socket> <remote_socket> [docker_path]
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const net = __importStar(require("net"));
const util_1 = require("util");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
function logInfo(message) {
    console.info(`forwarder: ${message}`);
}
function logError(message) {
    console.error(`forwarder error: ${message}`);
}
class Forwarder {
    constructor(dockerPath = 'docker') {
        this.dockerPath = dockerPath;
    }
    async expectContainer(containerId, field, value) {
        try {
            const { stdout } = await execFileAsync(this.dockerPath, ['inspect', '-f', `{{${field}}}`, containerId]);
            return stdout.trim() === value;
        }
        catch (error) {
            logError(`Error getting container status: ${error.message}`);
            return false;
        }
    }
    async monitorContainer(containerId) {
        while (true) {
            const containerRunning = await this.expectContainer(containerId, '.State.Running', 'true');
            const containerRestarting = await this.expectContainer(containerId, '.State.Restarting', 'true');
            const containerCreating = await this.expectContainer(containerId, '.State.Status', 'created');
            if (!(containerCreating || containerRestarting) && !containerRunning) {
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 10000));
        }
    }
    generateRemoteNodeJsCode(options) {
        if ((options.socket && options.port) || (!options.socket && !options.port)) {
            throw new Error('Invalid arguments, exactly one of socket or port must be provided.');
        }
        if (options.port) {
            return `
const net = require('net');
const fs = require('fs');
process.stdin.pause();
const client = net.createConnection({ host: '127.0.0.1', port: ${options.port} }, () => {
	console.error('Connection established');
	client.pipe(process.stdout);
	process.stdin.pipe(client);
});
client.on('close', function (hadError) {
	console.error(hadError ? 'Remote close with error' : 'Remote close');
	process.exit(hadError ? 1 : 0);
});
client.on('error', function (err) {
	process.stderr.write(err && (err.stack || err.message) || String(err));
});
process.stdin.on('close', function (hadError) {
	console.error(hadError ? 'Remote stdin close with error' : 'Remote stdin close');
	process.exit(hadError ? 1 : 0);
});
process.on('uncaughtException', function (err) {
	fs.writeSync(process.stderr.fd, 'error: ' + (err.stack || err.message) + '\\n');
	process.exit(1);
});`;
        }
        else {
            return `
const net = require('net');
const fs = require('fs');
process.stdin.pause();
const server = net.createServer(function (socket) {
	console.error('Connection established');
	socket.pipe(process.stdout);
	process.stdin.pipe(socket);
});
server.listen({ path: '${options.socket}' });
server.on('close', function (hadError) {
	console.error(hadError ? 'Remote close with error' : 'Remote close');
	process.exit(hadError ? 1 : 0);
});
server.on('error', function (err) {
	process.stderr.write(err && (err.stack || err.message) || String(err));
});
process.stdin.on('close', function (hadError) {
	console.error(hadError ? 'Remote stdin close with error' : 'Remote stdin close');
	process.exit(hadError ? 1 : 0);
});
process.on('uncaughtException', function (err) {
	fs.writeSync(process.stderr.fd, 'error: ' + (err.stack || err.message) + '\\n');
	process.exit(1);
});
`;
        }
    }
    async handleClient({ socket, containerId, options, remoteServerNodePath, remoteUser, }) {
        try {
            const nodeJsCode = this.generateRemoteNodeJsCode(options);
            const nodeCommand = `${remoteServerNodePath} -e "${nodeJsCode}"`;
            const command = [this.dockerPath, 'exec', '-u', remoteUser, '-i', containerId, 'bash', '-c', nodeCommand];
            const proc = (0, child_process_1.spawn)(command[0], command.slice(1), {
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            // Wait briefly for potential immediate failures
            await new Promise(resolve => setTimeout(resolve, 500));
            if (proc.exitCode !== null) {
                logError(`handleClient Error: subprocess terminated immediately with return code ${proc.exitCode}`);
                socket.end();
                return;
            }
            // Bidirectional forwarding
            if (proc.stdin && proc.stdout) {
                socket.pipe(proc.stdin);
                proc.stdout.pipe(socket);
            }
            // Handle cleanup
            socket.on('close', () => {
                proc.kill();
            });
            proc.on('error', (error) => {
                logError(`handleClient error: ${error.message}`);
                socket.end();
            });
        }
        catch (error) {
            logError(`handleClient Error: ${error}`);
            socket.end();
        }
    }
    async forwardPort(containerId, port, remoteServerNodePath, remoteUser) {
        const server = net.createServer((socket) => {
            this.handleClient({
                socket,
                containerId,
                options: { port },
                remoteServerNodePath,
                remoteUser,
            });
        });
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            logInfo(`====forwarderPort=${addr.port}====`);
        });
        // Monitor container status and close when stopped
        this.monitorContainer(containerId).then(() => {
            server.close();
            logInfo(`Stopping forwarding for port ${port}`);
        });
    }
    async forwardSocket(containerId, localSocket, remoteSocket, remoteServerNodePath, remoteUser) {
        const localClient = net.createConnection(localSocket);
        this.handleClient({
            socket: localClient,
            containerId,
            options: { socket: remoteSocket },
            remoteServerNodePath,
            remoteUser,
        });
        logInfo('====socketForward=success====');
        this.monitorContainer(containerId).then(() => {
            localClient.end();
            logInfo(`Stopping forwarding for socket ${localSocket} to ${remoteSocket}`);
        });
    }
}
async function main() {
    const args = process.argv.slice(2);
    if (args.length < 5 || args.length > 7) {
        logError('Expected arguments: "port"|"socket" <container_id> <remote_server_node_path> <remoteUser> (<port> | <local_socket> <remote_socket>) [docker_path]');
        process.exit(1);
    }
    const portOrSocket = args[0];
    if (portOrSocket !== 'port' && portOrSocket !== 'socket') {
        logError('Expected arguments: "port"|"socket" <container_id> <remote_server_node_path> <remoteUser> (<port> | <local_socket> <remote_socket>) [docker_path]');
        process.exit(1);
    }
    const containerId = args[1];
    const remoteServerNodePath = args[2];
    const remoteUser = args[3];
    if (portOrSocket === 'port') {
        if (args.length !== 5 && args.length !== 6) {
            logError('Expected arguments: port <container_id> <remote_server_node_path> <remoteUser> <port> [docker_path]');
            process.exit(1);
        }
        const port = parseInt(args[4]);
        const dockerPath = args[5] || 'docker';
        try {
            await new Forwarder(dockerPath).forwardPort(containerId, port, remoteServerNodePath, remoteUser);
        }
        catch (error) {
            logError(String(error));
            process.exit(1);
        }
    }
    else if (portOrSocket === 'socket') {
        if (args.length !== 6 && args.length !== 7) {
            logError('Expected arguments: socket <container_id> <remote_server_node_path> <remoteUser> <local_socket> <remote_socket> [docker_path]');
            process.exit(1);
        }
        const localSocket = args[4];
        const remoteSocket = args[5];
        const dockerPath = args[6] || 'docker';
        try {
            await new Forwarder(dockerPath).forwardSocket(containerId, localSocket, remoteSocket, remoteServerNodePath, remoteUser);
        }
        catch (error) {
            logError(String(error));
            process.exit(1);
        }
    }
}
main().catch((error) => {
    logError(String(error));
    process.exit(1);
});
