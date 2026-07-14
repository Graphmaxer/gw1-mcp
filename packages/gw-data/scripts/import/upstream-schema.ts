/** Validates upstream payloads against the JSON Schemas the upstream ships. */
export function validateAgainstSchema(
  ajv: import("ajv/dist/2020.js").Ajv2020,
  name: string,
  schemaText: string,
  payload: unknown,
): void {
  const schema = JSON.parse(schemaText) as Record<string, unknown>;
  delete schema.$id; // avoid remote-$ref resolution
  delete schema.$schema;
  // Upstream quirk: "float" is not a JSON Schema type (they use
  // ["float","integer"] on adrenaline_precise). Normalize to "number".
  const normalizeTypes = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(normalizeTypes);
    if (node && typeof node === "object") {
      const record = node as Record<string, unknown>;
      if (Array.isArray(record.type)) {
        record.type = [...new Set(record.type.map((t) => (t === "float" ? "number" : t)))];
      } else if (record.type === "float") {
        record.type = "number";
      }
      Object.values(record).forEach(normalizeTypes);
    }
  };
  normalizeTypes(schema);
  const validate = ajv.compile(schema);
  if (!validate(payload)) {
    console.error(`upstream ${name} fails its own schema:`, validate.errors?.slice(0, 5));
    process.exit(1);
  }
  console.log(`${name}: valid against upstream schema`);
}
