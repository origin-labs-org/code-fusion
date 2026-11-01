export function createAccountRequestAuthService(resolver) {
    return {
        resolveAccessCurrent(access) {
            return resolver.resolveAccessCurrent(access);
        },
        resolveCurrent(input) {
            return resolver.resolveCurrent(input);
        },
        assertCurrent(input) {
            return resolver.assertCurrent(input);
        },
    };
}
//# sourceMappingURL=accountRequestAuthService.js.map