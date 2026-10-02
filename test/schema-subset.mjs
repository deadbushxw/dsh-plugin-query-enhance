/**
 * A checked copy of the tool registry's JSON Schema subset.
 *
 * The registry asserts every tool's raw schema against a closed subset before a
 * plugin can register it - the check that turns a malformed schema into a loud
 * failure at load time. Reimplementing it here means the test suite can prove
 * the schema fits without having the Host package installed, which is the same
 * reason the plugin does not import `defineTool`.
 *
 * Kept in step with the shipped check: the constraint keywords, the annotation
 * keywords, the type table, and the rules below.
 *
 * @module dsh-plugin-query-enhance/test/schema-subset
 */

const CONSTRAINT_KEYWORDS = new Set(['type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const']);
const ANNOTATION_KEYWORDS = new Set(['description', 'title', 'default', 'examples']);
const SCHEMA_TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'];
const ONE_OF_SIBLING_KEYWORDS = ['properties', 'required', 'additionalProperties', 'items', 'enum', 'const'];
const SCALAR_TYPES = ['string', 'number', 'integer', 'boolean', 'null'];

/**
 * Collect every way one raw schema leaves the supported subset.
 * @param {unknown} schema candidate schema
 * @returns {string[]} violations, empty when the schema is supported
 */
export function checkSchemaSubset(schema) {
  const violations = [];
  walk(schema, 'schema', violations, new Set());
  return violations;
}

/** Plain-object test, without trusting `Object.getPrototypeOf` on a JSON round trip. */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function walk(node, path, violations, seen) {
  if (!isRecord(node)) {
    violations.push(path + ' must be a schema object');
    return;
  }
  if (seen.has(node)) {
    violations.push(path + ' is circular');
    return;
  }
  seen.add(node);

  for (const key of Object.keys(node)) {
    if (CONSTRAINT_KEYWORDS.has(key)) continue;
    if (ANNOTATION_KEYWORDS.has(key)) continue;
    violations.push(path + '.' + key + ' is not a supported keyword');
  }
  if (Object.hasOwn(node, 'description') && typeof node.description !== 'string') {
    violations.push(path + '.description must be a string');
  }
  if (Object.hasOwn(node, 'title') && typeof node.title !== 'string') {
    violations.push(path + '.title must be a string');
  }

  const hasType = Object.hasOwn(node, 'type');
  const hasOneOf = Object.hasOwn(node, 'oneOf');
  if (hasType && hasOneOf) {
    violations.push(path + ' cannot declare both type and oneOf');
    return;
  }
  if (!hasType && !hasOneOf) {
    for (const key of ONE_OF_SIBLING_KEYWORDS) {
      if (Object.hasOwn(node, key)) violations.push(path + '.' + key + ' requires type or oneOf');
    }
    return;
  }

  if (hasOneOf) {
    if (!Array.isArray(node.oneOf) || node.oneOf.length < 2) {
      violations.push(path + '.oneOf must be an array of at least two schemas');
      return;
    }
    for (const key of ONE_OF_SIBLING_KEYWORDS) {
      if (Object.hasOwn(node, key)) violations.push(path + '.' + key + ' is not supported beside oneOf');
    }
    node.oneOf.forEach((branch, index) => walk(branch, path + '.oneOf[' + index + ']', violations, seen));
    return;
  }

  const type = node.type;
  if (typeof type !== 'string' || !SCHEMA_TYPES.includes(type)) {
    violations.push(path + '.type must be one of ' + SCHEMA_TYPES.join('/'));
    return;
  }
  for (const [key, types] of Object.entries({
    properties: ['object'],
    required: ['object'],
    additionalProperties: ['object'],
    items: ['array'],
    enum: SCALAR_TYPES,
    const: SCALAR_TYPES,
  })) {
    if (Object.hasOwn(node, key) && !types.includes(type)) {
      violations.push(path + '.' + key + ' is not supported on type "' + type + '"');
    }
  }

  if (type === 'object') {
    if (Object.hasOwn(node, 'properties')) {
      if (!isRecord(node.properties)) {
        violations.push(path + '.properties must be an object of schemas');
      } else {
        for (const [name, child] of Object.entries(node.properties)) {
          walk(child, path + '.properties.' + name, violations, seen);
        }
      }
    }
    if (Object.hasOwn(node, 'required') && !Array.isArray(node.required)) {
      violations.push(path + '.required must be an array');
    }
    return;
  }
  if (type === 'array') {
    if (Object.hasOwn(node, 'items')) walk(node.items, path + '.items', violations, seen);
    return;
  }
  if (Object.hasOwn(node, 'enum')) {
    const allowed = node.enum;
    if (!Array.isArray(allowed) || allowed.length === 0) violations.push(path + '.enum must be a non-empty array');
    else for (const entry of allowed) if (!scalarMatches(type, entry)) violations.push(path + '.enum must hold ' + type + ' values');
  }
  if (Object.hasOwn(node, 'const') && !scalarMatches(type, node.const)) {
    violations.push(path + '.const must be a ' + type + ' value');
  }
}

function scalarMatches(type, value) {
  if (type === 'string') return typeof value === 'string';
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'null') return value === null;
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return false;
}
