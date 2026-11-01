# WebView2 security review: October 24, 2026

The reviewed floor and latest recommendation are now **156.0.4314.42**,
published October 22. Review again by October 31 inclusive; CI expires at
2026-11-01T00:00:00Z. The production-release blocker raised on October 6 is
cleared (below); runtime admission is unaffected.

## Vendor evidence

[Microsoft's security release notes](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-relnotes-security)
list Stable security releases 155.0.4283.45 (October 8), 155.0.4283.60
(October 15), 155.0.4283.62 (October 16) and 156.0.4314.42 (October 22), each
stating that it incorporates the latest Chromium security updates, with CVE
details to follow. The page carries no exploited-in-the-wild entry in that
range and no remaining notice that Microsoft is working on a pending fix; the
October 6 notice is absent from the live page and from an October 9 archive
snapshot. Every Stable release after the notice postdates it, so the blocker
is cleared and the floor now names a release published after the notice.

[Stable release notes](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-relnote-stable-channel)
confirm 156.0.4314.42 as the October 22 Stable main release.

The [Microsoft Update Catalog query](https://www.catalog.update.microsoft.com/Search.aspx?q=Microsoft+WebView2+Runtime+156.0.4314.42)
returns WebView2 Runtime 156.0.4314.42 packages for x86, x64 and ARM64, each
last updated 10/22/2026.

The reviewed major moves to 156; a 157 runtime keeps the unreviewed-runtime
advisory until it is reviewed. Beta, Dev and Canary remain denied.

## Boundary

This was a vendor-source review only. It did not reinstall or inventory a
Windows machine; 155.0.4283.62 and older runtimes now start with an
update-recommended advisory. Packaged native qualification and a second
maintainer's review remain required before signing a release.
