// ${VAR} and ${VAR:-default} expansion for MCP server fields, as Claude Code
// does it. An unset variable with no default keeps the literal text, and the
// caller gets the variable name so it can warn.

const PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

// An empty value counts as set, so `${VAR:-x}` expands to "" when VAR is "".
export function expandVars(value, vars, onUnset) {
  if (typeof value !== 'string' || !value.includes('${')) return value;
  return value.replace(PATTERN, (match, name, fallback) => {
    if (Object.hasOwn(vars, name)) return vars[name];
    if (fallback !== undefined) return fallback;
    onUnset(name);
    return match;
  });
}

// Claude Code runs a helper that a repository supplies without the credential variables of
// the user. A name with one of these words is a credential, except Git's GIT_CONFIG_KEY_<n>.
const CREDENTIAL_NAME = /TOKEN|SECRET|PASSWORD|KEY|AUTH/i;
const GIT_CONFIG_KEY = /^GIT_CONFIG_KEY_[0-9]+$/i;
// Credential variables whose names do not follow the pattern.
const CREDENTIAL_NAMES = new Set(['ANTHROPIC_CUSTOM_HEADERS']);

function isCredentialName(name) {
  if (GIT_CONFIG_KEY.test(name)) return false;
  return CREDENTIAL_NAME.test(name) || CREDENTIAL_NAMES.has(name.toUpperCase());
}

// The environment without credential variables. `removed` has the values that were
// dropped, so the caller can hide them in text that the helper still gets.
export function scrubbedEnv(env) {
  const kept = {};
  const removed = [];
  for (const [name, value] of Object.entries(env)) {
    if (!isCredentialName(name)) kept[name] = value;
    else if (typeof value === 'string' && value !== '') removed.push(value);
  }
  return { env: kept, removed };
}

export function redactValues(text, values) {
  return values.reduce((out, value) => out.replaceAll(value, 'REDACTED'), text);
}
