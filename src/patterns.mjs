// Detection rules and classification data for the secrets scanner.
// Pure data + tiny helpers, no I/O. Keep this file dependency-free.

/** Severity ordering, highest first. */
export const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

/** Return the more severe of two severity labels. */
export function maxSeverity(a, b) {
  if (!a) return b;
  if (!b) return a;
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

// ---------------------------------------------------------------------------
// Filename / path rules.
// Each rule: { id, label, type, service, severity, match(ctx) -> boolean }
// ctx = { base, lower, ext, dir, full, rel }
//   base : file basename                 e.g. "id_ed25519"
//   lower: basename lowercased
//   ext  : extension without dot, lower  e.g. "pem"
//   dir  : directory path
//   full : absolute path
//   rel  : path relative to the scanned root (posix-ish)
// ---------------------------------------------------------------------------

const ENV_EXCLUDE = /\.(example|sample|template|dist|defaults?)$/i;

export const NAME_RULES = [
  {
    id: "ssh-private-key",
    label: "SSH private key",
    type: "ssh_key",
    service: "ssh",
    severity: "critical",
    match: (c) =>
      c.full.includes("/.ssh/") &&
      !c.lower.endsWith(".pub") &&
      (["id_rsa", "id_dsa", "id_ecdsa", "id_ed25519", "identity"].includes(c.lower) ||
        /(_rsa|_dsa|_ecdsa|_ed25519)$/.test(c.lower)),
  },
  {
    id: "apple-auth-key",
    label: "Apple .p8 auth key",
    type: "p8",
    service: "apple",
    severity: "high",
    match: (c) => c.ext === "p8",
  },
  {
    id: "pkcs12",
    label: "PKCS#12 keystore (.p12/.pfx)",
    type: "p12",
    service: "cert",
    severity: "high",
    match: (c) => c.ext === "p12" || c.ext === "pfx",
  },
  {
    id: "private-key-file",
    label: "Private key file (.pem/.key)",
    type: "private_key",
    service: "cert",
    severity: "high",
    match: (c) => c.ext === "pem" || c.ext === "key",
  },
  {
    id: "java-keystore",
    label: "Java/Android keystore",
    type: "keystore",
    service: "android",
    severity: "high",
    match: (c) => c.ext === "keystore" || c.ext === "jks",
  },
  {
    id: "pgp-key",
    label: "PGP/GPG key file",
    type: "pgp",
    service: "pgp",
    severity: "medium",
    match: (c) => c.ext === "asc" || c.ext === "gpg",
  },
  {
    id: "apple-provisioning",
    label: "Apple provisioning/cert",
    type: "cert",
    service: "apple",
    severity: "medium",
    match: (c) => ["mobileprovision", "cer", "cert", "crt"].includes(c.ext),
  },
  {
    id: "dotenv",
    label: "Environment file (.env)",
    type: "env",
    service: "generic",
    severity: "high",
    match: (c) => /^\.env(\..+)?$/.test(c.base) && !ENV_EXCLUDE.test(c.base),
  },
  {
    id: "gcp-service-account",
    label: "GCP service-account JSON (by name)",
    type: "service_account_json",
    service: "google",
    severity: "critical",
    match: (c) => /service[-_]?account.*\.json$/i.test(c.base),
  },
  {
    id: "gcloud-adc",
    label: "gcloud application default credentials",
    type: "service_account_json",
    service: "google",
    severity: "critical",
    match: (c) => c.lower === "application_default_credentials.json",
  },
  {
    id: "gcloud-store",
    label: "gcloud credential store",
    type: "token_store",
    service: "google",
    severity: "high",
    match: (c) =>
      c.full.includes("/.config/gcloud/") &&
      ["credentials.db", "access_tokens.db"].includes(c.lower),
  },
  {
    id: "google-client-config",
    label: "Google client config (plist/json)",
    type: "client_config",
    service: "google",
    severity: "medium",
    match: (c) =>
      c.base === "GoogleService-Info.plist" || c.base === "google-services.json",
  },
  {
    id: "aws-credentials",
    label: "AWS credentials file",
    type: "api_key",
    service: "aws",
    severity: "critical",
    match: (c) => /\/\.aws\/credentials$/.test(c.full),
  },
  {
    id: "aws-config",
    label: "AWS config file",
    type: "config",
    service: "aws",
    severity: "medium",
    match: (c) => /\/\.aws\/config$/.test(c.full),
  },
  {
    id: "npmrc",
    label: ".npmrc (may hold _authToken)",
    type: "api_key",
    service: "npm",
    severity: "high",
    match: (c) => c.base === ".npmrc",
  },
  {
    id: "pypirc",
    label: ".pypirc",
    type: "api_key",
    service: "pypi",
    severity: "high",
    match: (c) => c.base === ".pypirc",
  },
  {
    id: "netrc",
    label: ".netrc",
    type: "password",
    service: "generic",
    severity: "high",
    match: (c) => c.base === ".netrc",
  },
  {
    id: "git-credentials",
    label: "git credential store",
    type: "password",
    service: "generic",
    severity: "critical",
    match: (c) => c.base === ".git-credentials",
  },
  {
    id: "docker-config",
    label: "Docker config.json (registry auth)",
    type: "api_key",
    service: "docker",
    severity: "high",
    match: (c) => /\/\.docker\/config\.json$/.test(c.full),
  },
  {
    id: "kube-config",
    label: "Kubernetes kubeconfig",
    type: "config",
    service: "kubernetes",
    severity: "high",
    match: (c) => /\/\.kube\/config$/.test(c.full),
  },
  {
    id: "gh-hosts",
    label: "GitHub CLI hosts.yml (oauth token)",
    type: "api_key",
    service: "github",
    severity: "high",
    match: (c) => /\/gh\/hosts\.yml$/.test(c.full),
  },
  {
    id: "terraform-tfvars",
    label: "Terraform tfvars",
    type: "config",
    service: "terraform",
    severity: "medium",
    match: (c) => c.ext === "tfvars",
  },
  {
    id: "terraform-state",
    label: "Terraform state (often holds secrets)",
    type: "config",
    service: "terraform",
    severity: "high",
    match: (c) => c.ext === "tfstate" || c.base === "terraform.tfstate",
  },
];

// ---------------------------------------------------------------------------
// Content rules. Applied only to text files within the size cap.
// Each rule: { id, label, type, service, severity, re (global regex) }
// The first capture group (or full match) is fingerprinted, never stored raw.
// ---------------------------------------------------------------------------

export const CONTENT_RULES = [
  {
    id: "private-key-header",
    label: "PEM private key block",
    type: "private_key",
    service: "cert",
    severity: "critical",
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g,
  },
  {
    id: "gcp-sa-inline",
    label: "Inline GCP service account",
    type: "service_account_json",
    service: "google",
    severity: "critical",
    re: /"type"\s*:\s*"service_account"/g,
  },
  {
    id: "aws-access-key-id",
    label: "AWS access key id",
    type: "api_key",
    service: "aws",
    severity: "high",
    re: /\b(AKIA[0-9A-Z]{16})\b/g,
  },
  {
    id: "aws-secret-key",
    label: "AWS secret access key",
    type: "api_key",
    service: "aws",
    severity: "critical",
    re: /aws_secret_access_key\s*=\s*([A-Za-z0-9/+]{40})/gi,
  },
  {
    id: "github-token",
    label: "GitHub token",
    type: "api_key",
    service: "github",
    severity: "high",
    re: /\b(gh[posru]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/g,
  },
  {
    id: "anthropic-key",
    label: "Anthropic API key",
    type: "api_key",
    service: "anthropic",
    severity: "high",
    re: /\b(sk-ant-[A-Za-z0-9_-]{20,})\b/g,
  },
  {
    id: "openai-key",
    label: "OpenAI API key",
    type: "api_key",
    service: "openai",
    severity: "high",
    re: /\b(sk-(?:proj-)?[A-Za-z0-9_-]{20,})\b/g,
  },
  {
    id: "stripe-key",
    label: "Stripe secret key",
    type: "api_key",
    service: "stripe",
    severity: "high",
    re: /\b((?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,})\b/g,
  },
  {
    id: "slack-token",
    label: "Slack token",
    type: "api_key",
    service: "slack",
    severity: "high",
    re: /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
  },
  {
    id: "google-api-key",
    label: "Google API key",
    type: "api_key",
    service: "google",
    severity: "high",
    re: /\b(AIza[0-9A-Za-z_-]{35})\b/g,
  },
  {
    id: "jwt",
    label: "JWT (e.g. Supabase service_role)",
    type: "token",
    service: "generic",
    severity: "medium",
    re: /\b(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g,
  },
  {
    id: "generic-secret-assignment",
    label: "Generic secret assignment",
    type: "secret",
    service: "generic",
    severity: "medium",
    re: /(?:api[_-]?key|secret|token|passwd|password|client[_-]?secret)\s*[:=]\s*['"]?([A-Za-z0-9_+/-]{16,})['"]?/gi,
  },
  {
    id: "certificate",
    label: "Certificate block",
    type: "cert",
    service: "cert",
    severity: "low",
    re: /-----BEGIN CERTIFICATE-----/g,
  },
];

// ---------------------------------------------------------------------------
// Project detection + directory walk tuning.
// ---------------------------------------------------------------------------

/** Files/dirs whose presence marks a directory as a project root. */
export const PROJECT_MARKERS = [
  "package.json",
  ".git",
  "pyproject.toml",
  "requirements.txt",
  "Pipfile",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "Gemfile",
  "composer.json",
  "pubspec.yaml",
  "Podfile",
  "app.json",
];

/** Project markers that are matched by extension/suffix rather than exact name. */
export const PROJECT_MARKER_SUFFIXES = [".xcodeproj", ".xcworkspace", ".csproj"];

/**
 * Directories skipped by default: huge, low secret-density, or VCS internals.
 * Override with --include-skipped or extend with --add-skip.
 */
export const DEFAULT_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  ".cache",
  ".npm",
  ".rustup",
  ".gradle",
  ".m2",
  "Pods",
  "DerivedData",
  ".next",
  ".nuxt",
  ".turbo",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  ".Trash",
  "Caches",
  "Containers",
  "Logs",
]);
