class Finding {
  constructor(readonly path: string) {}
  describe(): string {
    return this.path;
  }
}

report(new Finding("src/a.ts")); // error
