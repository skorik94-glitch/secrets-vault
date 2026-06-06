// Service discovery: map visited domains to a curated catalog of dev/SaaS
// services, aggregate usage, and cross-reference against filesystem findings.
// Pure functions, no I/O. Service ids overlap with patterns.mjs where possible
// so the cross-reference lines up (aws/github/google/apple/npm/docker/...).

/** [domain, serviceId, category] — domain matches itself and any subdomain. */
const RAW_CATALOG = [
  // cloud / infra
  ["console.aws.amazon.com", "aws", "cloud"],
  ["aws.amazon.com", "aws", "cloud"],
  ["console.cloud.google.com", "google", "cloud"],
  ["cloud.google.com", "google", "cloud"],
  ["console.firebase.google.com", "firebase", "cloud"],
  ["portal.azure.com", "azure", "cloud"],
  ["cloudflare.com", "cloudflare", "cloud"],
  ["dash.cloudflare.com", "cloudflare", "cloud"],
  ["digitalocean.com", "digitalocean", "cloud"],
  ["render.com", "render", "hosting"],
  ["railway.app", "railway", "hosting"],
  ["fly.io", "fly", "hosting"],
  ["heroku.com", "heroku", "hosting"],
  ["vercel.com", "vercel", "hosting"],
  ["netlify.com", "netlify", "hosting"],
  ["expo.dev", "expo", "mobile"],
  // databases / backend
  ["supabase.com", "supabase", "backend"],
  ["supabase.io", "supabase", "backend"],
  ["planetscale.com", "planetscale", "database"],
  ["neon.tech", "neon", "database"],
  ["turso.tech", "turso", "database"],
  ["upstash.com", "upstash", "database"],
  ["mongodb.com", "mongodb", "database"],
  ["redis.com", "redis", "database"],
  // auth
  ["auth0.com", "auth0", "auth"],
  ["clerk.com", "clerk", "auth"],
  ["clerk.dev", "clerk", "auth"],
  ["workos.com", "workos", "auth"],
  // payments
  ["stripe.com", "stripe", "payments"],
  ["dashboard.stripe.com", "stripe", "payments"],
  ["paddle.com", "paddle", "payments"],
  ["lemonsqueezy.com", "lemonsqueezy", "payments"],
  ["revenuecat.com", "revenuecat", "payments"],
  // AI
  ["platform.openai.com", "openai", "ai"],
  ["console.anthropic.com", "anthropic", "ai"],
  ["console.groq.com", "groq", "ai"],
  ["mistral.ai", "mistral", "ai"],
  ["replicate.com", "replicate", "ai"],
  ["huggingface.co", "huggingface", "ai"],
  ["together.ai", "together", "ai"],
  ["fireworks.ai", "fireworks", "ai"],
  ["pinecone.io", "pinecone", "ai"],
  // dev platforms
  ["github.com", "github", "vcs"],
  ["gitlab.com", "gitlab", "vcs"],
  ["bitbucket.org", "bitbucket", "vcs"],
  ["npmjs.com", "npm", "registry"],
  ["hub.docker.com", "docker", "registry"],
  ["docker.com", "docker", "registry"],
  // apple / google dev
  ["developer.apple.com", "apple", "mobile"],
  ["appstoreconnect.apple.com", "apple", "mobile"],
  ["play.google.com", "google-play", "mobile"],
  // comms / email / sms
  ["twilio.com", "twilio", "comms"],
  ["sendgrid.com", "sendgrid", "email"],
  ["resend.com", "resend", "email"],
  ["postmarkapp.com", "postmark", "email"],
  ["mailgun.com", "mailgun", "email"],
  // analytics / observability
  ["sentry.io", "sentry", "observability"],
  ["posthog.com", "posthog", "analytics"],
  ["mixpanel.com", "mixpanel", "analytics"],
  ["amplitude.com", "amplitude", "analytics"],
  ["datadoghq.com", "datadog", "observability"],
  // misc dev tooling
  ["ngrok.com", "ngrok", "tooling"],
  ["tailscale.com", "tailscale", "tooling"],
  ["algolia.com", "algolia", "search"],
];

export const CATALOG = [...RAW_CATALOG]
  .map(([domain, service, category]) => ({ domain, service, category }))
  .sort((a, b) => b.domain.length - a.domain.length); // most specific first

/** Extract a normalized hostname from a URL. Returns null if unparseable. */
export function domainOf(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h.startsWith("www.") ? h.slice(4) : h;
  } catch {
    return null;
  }
}

/** Match a hostname to a catalog entry (exact or subdomain). */
export function matchService(hostname, catalog = CATALOG) {
  if (!hostname) return null;
  for (const e of catalog) {
    if (hostname === e.domain || hostname.endsWith("." + e.domain)) return e;
  }
  return null;
}

/**
 * Aggregate a list of visits into per-service usage.
 * @param {Array<{url:string, visitCount?:number, lastVisit?:number, browser?:string}>} visits
 * @returns {Array<{service:string, category:string, visits:number, lastVisit:number, domains:string[], browsers:string[]}>}
 */
export function aggregateServices(visits) {
  const acc = new Map();
  for (const v of visits) {
    const dom = domainOf(v.url);
    if (!dom) continue;
    const m = matchService(dom);
    if (!m) continue;
    if (!acc.has(m.service)) {
      acc.set(m.service, {
        service: m.service,
        category: m.category,
        visits: 0,
        lastVisit: 0,
        domains: new Set(),
        browsers: new Set(),
      });
    }
    const a = acc.get(m.service);
    a.visits += v.visitCount || 1;
    if (v.lastVisit && v.lastVisit > a.lastVisit) a.lastVisit = v.lastVisit;
    a.domains.add(dom);
    if (v.browser) a.browsers.add(v.browser);
  }
  return [...acc.values()]
    .map((a) => ({ ...a, domains: [...a.domains], browsers: [...a.browsers] }))
    .sort((x, y) => y.visits - x.visits);
}

/**
 * Cross-reference services seen in the browser with services found on disk.
 * @param {Iterable<string>} fsServiceNames  service ids from the filesystem scan
 * @param {Array<{service:string}>} browserServices  output of aggregateServices
 */
export function crossReference(fsServiceNames, browserServices) {
  const fsSet = new Set(fsServiceNames);
  const browserSet = new Set(browserServices.map((b) => b.service));
  return {
    both: browserServices.filter((b) => fsSet.has(b.service)).map((b) => b.service),
    // used in browser but no NAMED local credential found -> candidate to vault
    gaps: browserServices.filter((b) => !fsSet.has(b.service)),
    // local credential exists but service never visited -> maybe stale / rotate
    orphans: [...fsSet].filter((s) => !browserSet.has(s) && s !== "generic" && s !== "cert"),
  };
}
