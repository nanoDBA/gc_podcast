# Security Policy

## Reporting Security Vulnerabilities

If you discover a security vulnerability in this repository, please report it responsibly by [contacting Lars directly](https://linktr.ee/nanodba) rather than using the public issue tracker.

Please include the following information:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested remediation

We will acknowledge receipt of your report within 48 hours and provide updates on our progress toward a fix.

## Security Scanning Posture

### Enabled Scans

This repository employs the following automated security scanning:

#### 1. **CodeQL Analysis**
- **Frequency**: On push to main, on pull requests, and weekly
- **Scope**: JavaScript/TypeScript codebase
- **Details**: Detects potential security vulnerabilities and coding errors
- **Results**: Available in the [Security > Code scanning](../../security/code-scanning) tab

#### 2. **Dependency Review**
- **Frequency**: On pull requests
- **Scope**: Node.js dependency changes
- **Details**: Flags known vulnerabilities in npm packages
- **Results**: Visible in pull request checks

#### 3. **Secret Scanning**
- **Status**: Enabled via GitHub organization settings
- **Scope**: Repository commit history and pull requests
- **Details**: Detects accidentally committed secrets (API keys, tokens, etc.)
- **Results**: Available in the [Security > Secret scanning](../../security/secret-scanning) tab

#### 4. **Dependabot**
- **Frequency**: Weekly
- **Scope**: GitHub Actions
- **Details**: Auto-creates PRs for outdated actions
- **Configuration**: [.github/dependabot.yml](../dependabot.yml)

## Development Best Practices

- Never commit secrets, API keys, or credentials
- Keep dependencies up to date via Dependabot
- Run security scans locally before pushing (`npm audit`)
- Review all dependency changes before merging
- Use environment variables for sensitive configuration
- Follow principle of least privilege in workflow permissions

## Questions?

For security-related questions not involving a vulnerability report, please open a [GitHub Discussion](../../discussions) rather than an issue.
