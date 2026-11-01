/* Qualification only. Never reads payloads or emits a path, value or filename. */
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <spawn.h>
extern char **environ;
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

static void result(int fd) {
    if (fd >= 0) { close(fd); puts("opened"); }
    else if (errno == EPERM || errno == EACCES) puts("denied");
    else if (errno == ENOENT || errno == ENOTDIR) puts("missing");
    else printf("other:%d\n", errno);
}
int main(int argc, char **argv) {
    if (argc < 2) return 2;
    if (!strcmp(argv[1], "open") && argc == 3) {
        result(open(argv[2], O_RDONLY | O_NONBLOCK));
    } else if (!strcmp(argv[1], "list") && argc == 3) {
        /* Requiring directory-open denial avoids consuming any directory names. */
        result(open(argv[2], O_RDONLY | O_DIRECTORY | O_NONBLOCK));
    } else if (!strcmp(argv[1], "create") && argc == 3) {
        result(open(argv[2], O_WRONLY | O_CREAT | O_EXCL, 0600));
    } else if (!strcmp(argv[1], "unix") && argc == 3) {
        int fd = socket(AF_UNIX, SOCK_STREAM, 0);
        if (fd < 0) { result(fd); return 0; }
        struct sockaddr_un address = {0}; address.sun_family = AF_UNIX;
        if (strlen(argv[2]) >= sizeof(address.sun_path)) { close(fd); return 2; }
        strcpy(address.sun_path, argv[2]);
        int status = connect(fd, (struct sockaddr *)&address, sizeof(address));
        int error = errno; close(fd); errno = error;
        if (status == 0) puts("opened"); else result(-1);
    } else if (!strcmp(argv[1], "network-external")) {
        int fd = socket(AF_INET, SOCK_STREAM, 0);
        if (fd < 0) { result(fd); return 0; }
        struct sockaddr_in address = {0};
        address.sin_family = AF_INET; address.sin_port = htons(443);
        inet_pton(AF_INET, "203.0.113.1", &address.sin_addr);
        int status = connect(fd, (struct sockaddr *)&address, sizeof(address));
        int error = errno; close(fd); errno = error;
        if (status == 0) puts("opened"); else result(-1);
    } else if (!strcmp(argv[1], "network") && argc == 3) {
        int fd = socket(AF_INET, SOCK_STREAM, 0);
        if (fd < 0) { result(fd); return 0; }
        struct sockaddr_in address = {0};
        address.sin_family = AF_INET;
        address.sin_port = htons((unsigned short)atoi(argv[2]));
        address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        int status = connect(fd, (struct sockaddr *)&address, sizeof(address));
        int error = errno; close(fd); errno = error;
        if (status == 0) puts("opened"); else result(-1);
    } else if (!strcmp(argv[1], "fd") && argc == 3) {
        puts(fcntl(atoi(argv[2]), F_GETFD) == -1 && errno == EBADF ? "closed" : "opened");
    } else if (!strcmp(argv[1], "spawn")) {
        pid_t child = 0;
        char *arguments[] = {argv[0], "environment", NULL};
        int error = posix_spawn(&child, argv[0], NULL, NULL, arguments, environ);
        if (!error) { waitpid(child, NULL, 0); puts("opened"); }
        else { errno = error; result(-1); }
    } else if (!strcmp(argv[1], "fork")) {
        pid_t child = fork();
        if (child == 0) _exit(0);
        if (child > 0) { waitpid(child, NULL, 0); puts("opened"); }
        else result(-1);
    } else if (!strcmp(argv[1], "double-fork")) {
        pid_t first = fork();
        if (first == 0) {
            setsid();
            pid_t second = fork();
            if (second == 0) { sleep(2); _exit(0); }
            if (second > 0) waitpid(second, NULL, 0);
            _exit(0);
        }
        if (first > 0) { waitpid(first, NULL, 0); puts("opened"); }
        else result(-1);
    } else if (!strcmp(argv[1], "group-hold") && argc == 4) {
        /* A group leader cannot setsid directly; changing its group first is
           allowed on the qualified host. Leave the final group changed so the
           Stop fixture actually requires the owned positive PID. */
        setsid();
        int changed = setpgid(0, (pid_t)atoi(argv[3])) == 0 && getpgrp() != getpid();
        int fd = open(argv[2], O_WRONLY | O_CREAT | O_EXCL, 0600);
        if (fd < 0) return 3;
        const char *state = changed ? "moved" : "denied";
        if (write(fd, state, strlen(state)) < 0) { close(fd); return 4; }
        close(fd); sleep(3);
    } else if (!strcmp(argv[1], "environment")) {
        puts(getenv("SSH_AUTH_SOCK") || getenv("GITHUB_TOKEN") || getenv("ZEPHIUM_RUNNER_PARENT_SENTINEL") ? "present" : "absent");
    } else if (!strcmp(argv[1], "hold") && argc == 3) {
        int fd = open(argv[2], O_WRONLY | O_CREAT | O_EXCL, 0600);
        if (fd < 0) return 3;
        close(fd); sleep(60);
    } else if (!strcmp(argv[1], "flood")) {
        char bytes[8192]; memset(bytes, 'x', sizeof(bytes));
        while (write(STDOUT_FILENO, bytes, sizeof(bytes)) > 0) {}
    } else return 2;
    return 0;
}
