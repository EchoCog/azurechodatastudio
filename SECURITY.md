<!-- BEGIN MICROSOFT SECURITY.MD V0.0.5 BLOCK -->

## Security

Microsoft takes the security of our software products and services seriously, which includes all source code repositories managed through our GitHub organizations, which include [Microsoft](https://github.com/Microsoft), [Azure](https://github.com/Azure), [DotNet](https://github.com/dotnet), [AspNet](https://github.com/aspnet), [Xamarin](https://github.com/xamarin), and [our GitHub organizations](https://opensource.microsoft.com/).

If you believe you have found a security vulnerability in any Microsoft-owned repository that meets [Microsoft's definition of a security vulnerability](https://docs.microsoft.com/en-us/previous-versions/tn-archive/cc751383(v=technet.10)), please report it to us as described below.

## Reporting Security Issues

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them to the Microsoft Security Response Center (MSRC) at [https://msrc.microsoft.com/create-report](https://msrc.microsoft.com/create-report).

If you prefer to submit without logging in, send email to [secure@microsoft.com](mailto:secure@microsoft.com).  If possible, encrypt your message with our PGP key; please download it from the [Microsoft Security Response Center PGP Key page](https://www.microsoft.com/en-us/msrc/pgp-key-msrc).

You should receive a response within 24 hours. If for some reason you do not, please follow up via email to ensure we received your original message. Additional information can be found at [microsoft.com/msrc](https://www.microsoft.com/msrc).

Please include the requested information listed below (as much as you can provide) to help us better understand the nature and scope of the possible issue:

* Type of issue (e.g. buffer overflow, SQL injection, cross-site scripting, etc.)
* Full paths of source file(s) related to the manifestation of the issue
* The location of the affected source code (tag/branch/commit or direct URL)
* Any special configuration required to reproduce the issue
* Step-by-step instructions to reproduce the issue
* Proof-of-concept or exploit code (if possible)
* Impact of the issue, including how an attacker might exploit the issue

This information will help us triage your report more quickly.

If you are reporting for a bug bounty, more complete reports can contribute to a higher bounty award. Please visit our [Microsoft Bug Bounty Program](https://microsoft.com/msrc/bounty) page for more details about our active programs.

## Preferred Languages

We prefer all communications to be in English.

## Policy

Microsoft follows the principle of [Coordinated Vulnerability Disclosure](https://www.microsoft.com/en-us/msrc/cvd).

<!-- END MICROSOFT SECURITY.MD BLOCK -->

## Known Non-Applicable Dependency Advisories

The Angular framework packages in this repository are pinned to `@angular/*@4.1.3`
(matched to `rxjs@5.4.0`). Dependabot periodically flags this version against newer
Angular CVEs. The following advisory families have been assessed as **not applicable**
because the vulnerable features do not exist in Angular 4.1.3 and are not used by this
codebase:

- **Angular i18n XSS (`$localize`)** — the runtime i18n `$localize` mechanism was
  introduced in Angular 9. It is absent from `src/` and `extensions/`.
- **Angular Client Hydration (DOM clobbering / response-cache poisoning)** — client
  hydration (`provideClientHydration`) was introduced in Angular 16 and is not used.
- **Angular unsanitized SVG script attributes** — untrusted HTML output is sanitized via
  the independent `sanitize-html` library (not Angular's template sanitizer); see
  `src/sql/workbench/services/notebook/browser/outputs/sanitizer.ts`.

Each listed advisory's affected range begins at `>= 19.0.0-next.0` (or 20.x/21.x), which
is above the pinned 4.1.3. Do not "fix" these by bumping `@angular/core` alone: Angular
≥6 requires `rxjs@6+` (`rxjs/operators`), which is incompatible with the pinned
`rxjs@5.4.0` and breaks the unit-test bootstrap. A major Angular upgrade would require
migrating the entire `@angular/*` family and `rxjs` together.
