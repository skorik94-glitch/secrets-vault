// Infisical apply layer — talks to the REST API via global fetch (zero deps).
// Works against self-hosted or cloud Infisical (set apiUrl accordingly).
// NOTE: this writes to YOUR vault. It is exercised only under `onboard --apply`.
// Endpoints verified against Infisical docs; verify against your instance on first use.

async function http(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { ok: res.ok, status: res.status, body };
}

export function infisicalClient({ apiUrl, clientId, clientSecret, projectId, environment = "dev" }) {
  const base = apiUrl.replace(/\/+$/, "");
  let token = null;

  async function login() {
    const { ok, status, body } = await http(`${base}/api/v1/auth/universal-auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, clientSecret }),
    });
    if (!ok) throw new Error(`Infisical login failed (${status}): ${JSON.stringify(body)}`);
    token = body.accessToken;
    return token;
  }

  const auth = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

  // Best-effort: create each folder level; tolerate "already exists".
  async function ensureFolder(secretPath) {
    if (!secretPath || secretPath === "/") return;
    const parts = secretPath.split("/").filter(Boolean);
    let parent = "/";
    for (const name of parts) {
      const { ok, status, body } = await http(`${base}/api/v1/folders`, {
        method: "POST",
        headers: auth(),
        body: JSON.stringify({ workspaceId: projectId, environment, name, path: parent }),
      });
      // 400/409 typically mean the folder already exists — fine to continue.
      if (!ok && status !== 400 && status !== 409) {
        throw new Error(`folder create failed for ${parent}${name} (${status}): ${JSON.stringify(body)}`);
      }
      parent = parent === "/" ? `/${name}` : `${parent}/${name}`;
    }
  }

  async function secretExists(name, secretPath) {
    const url =
      `${base}/api/v3/secrets/raw/${encodeURIComponent(name)}` +
      `?workspaceId=${encodeURIComponent(projectId)}&environment=${encodeURIComponent(environment)}` +
      `&secretPath=${encodeURIComponent(secretPath)}`;
    const { ok } = await http(url, { headers: auth() });
    return ok;
  }

  async function setSecret({ name, value, secretPath, multiline, comment, update }) {
    const payload = {
      workspaceId: projectId,
      environment,
      secretPath,
      secretValue: value,
      secretComment: comment,
      skipMultilineEncoding: multiline === true ? true : undefined,
    };
    const method = update ? "PATCH" : "POST";
    const { ok, status, body } = await http(`${base}/api/v3/secrets/raw/${encodeURIComponent(name)}`, {
      method,
      headers: auth(),
      body: JSON.stringify(payload),
    });
    if (!ok) throw new Error(`set ${secretPath}/${name} failed (${status}): ${JSON.stringify(body)}`);
    return body;
  }

  const qs = (secretPath) =>
    `workspaceId=${encodeURIComponent(projectId)}&environment=${encodeURIComponent(environment)}` +
    `&secretPath=${encodeURIComponent(secretPath)}`;

  async function listFolders(secretPath = "/") {
    const { ok, body } = await http(
      `${base}/api/v1/folders?workspaceId=${encodeURIComponent(projectId)}` +
        `&environment=${encodeURIComponent(environment)}&path=${encodeURIComponent(secretPath)}`,
      { headers: auth() },
    );
    return ok ? body.folders || [] : [];
  }

  async function listSecrets(secretPath = "/") {
    const { ok, body } = await http(`${base}/api/v3/secrets/raw?${qs(secretPath)}`, { headers: auth() });
    return ok ? body.secrets || [] : [];
  }

  async function getSecret(name, secretPath = "/") {
    const { ok, status, body } = await http(
      `${base}/api/v3/secrets/raw/${encodeURIComponent(name)}?${qs(secretPath)}`,
      { headers: auth() },
    );
    if (!ok) throw new Error(`get ${secretPath}/${name} failed (${status})`);
    return body.secret?.secretValue;
  }

  // Wire an import so `secretPath` pulls in everything from `importPath` (reuse access).
  async function createSecretImport(secretPath, importPath, importEnvironment = environment) {
    const { ok, status, body } = await http(`${base}/api/v1/secret-imports`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({
        workspaceId: projectId,
        environment,
        path: secretPath,
        import: { environment: importEnvironment, path: importPath },
      }),
    });
    if (!ok && status !== 400 && status !== 409) {
      throw new Error(`import ${secretPath} <- ${importPath} failed (${status}): ${JSON.stringify(body)}`);
    }
    return body;
  }

  return { login, ensureFolder, secretExists, setSecret, listFolders, listSecrets, getSecret, createSecretImport };
}
