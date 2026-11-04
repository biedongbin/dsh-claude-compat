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
// the user. A name with one of these words is a credential, as is a fixed list of names
// that do not follow the pattern. Git's GIT_CONFIG_KEY_<n> is not a credential. The words
// go further than Claude Code's own list: PASS, CRED, COOKIE and DSN also hide a credential.
const CREDENTIAL_NAME = /TOKEN|SECRET|PASS|KEY|AUTH|CRED|COOKIE|DSN|^ANTHROPIC_CUSTOM_HEADERS$/i;
const GIT_CONFIG_KEY = /^GIT_CONFIG_KEY_[0-9]+$/i;
// A value that is a URL with a password in it, such as a database URL.
const URL_WITH_PASSWORD = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/\s:@]*:[^/\s@]+@/;

function isCredential(name, value) {
  if (GIT_CONFIG_KEY.test(name)) return false;
  return CREDENTIAL_NAME.test(name) || URL_WITH_PASSWORD.test(String(value));
}

// The environment without credential variables. `removed` has the non-empty values that
// were dropped, so the caller can hide them in text that the helper still gets.
export function scrubbedEnv(env) {
  const kept = {};
  const removed = [];
  for (const [name, value] of Object.entries(env)) {
    if (!isCredential(name, value)) kept[name] = value;
    else if (typeof value === 'string' && value !== '') removed.push(value);
  }
  return { env: kept, removed };
}

// The names of the variables that scrubbedEnv removes, so a warning can name them.
export function credentialNames(env) {
  return new Set(Object.entries(env).filter(([name, value]) => isCredential(name, value)).map(([name]) => name));
}

export function redactValues(text, values) {
  return values.filter((value) => value !== '').reduce((out, value) => out.replaceAll(value, 'REDACTED'), text);
}
