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
