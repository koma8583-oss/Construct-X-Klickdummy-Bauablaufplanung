/**
 * schema-version.ts — centralised schema version policy for TaktKoord PoC.
 *
 * All message envelopes (MessageEnvelope, typed message subtypes, Reminder,
 * Expiry) carry a `schemaVersion` field with the format `<major>.<minor>`.
 *
 * Policy:
 *   - This PoC supports exactly major version 1 (1.0 … 1.x).
 *   - Minor bumps are backward-compatible and are accepted automatically.
 *   - A different major version signals a breaking change and MUST be rejected
 *     at the processing boundary with a clear, descriptive error message.
 *   - Future major versions (2.x, 3.x …) must be handled explicitly once they
 *     are agreed upon; adding them to SUPPORTED_MAJOR_VERSIONS is sufficient.
 */

/** The major versions this service is willing to process. */
export const SUPPORTED_MAJOR_VERSIONS: readonly number[] = [1];

/** The canonical schema version for all messages produced by this service. */
export const CURRENT_SCHEMA_VERSION = "1.0" as const;

/**
 * Parse the major version number out of a `<major>.<minor>` string.
 * Returns NaN if the string does not match the expected format.
 */
export function parseMajorVersion(schemaVersion: string): number {
  const match = /^(\d+)\.\d+$/.exec(schemaVersion);
  return match ? parseInt(match[1]!, 10) : NaN;
}

/**
 * Return true if the given schemaVersion string carries a supported major version.
 *
 * @example
 * isSupportedMajorVersion("1.0")  // → true
 * isSupportedMajorVersion("1.7")  // → true  (minor bump, compatible)
 * isSupportedMajorVersion("2.0")  // → false (unsupported major)
 * isSupportedMajorVersion("v1")   // → false (invalid format)
 */
export function isSupportedMajorVersion(schemaVersion: string): boolean {
  const major = parseMajorVersion(schemaVersion);
  return SUPPORTED_MAJOR_VERSIONS.includes(major);
}

/**
 * Assert that the schemaVersion is supported; throw a descriptive Error if not.
 *
 * Intended for use in route handlers or transport boundaries where a clear
 * HTTP-compatible error is needed.
 *
 * @throws {UnsupportedSchemaVersionError}
 */
export function assertSupportedSchemaVersion(schemaVersion: string): void {
  if (!isSupportedMajorVersion(schemaVersion)) {
    throw new UnsupportedSchemaVersionError(schemaVersion);
  }
}

/**
 * Structured error thrown when an incoming message carries an unsupported major version.
 * Callers should surface this as HTTP 422 Unprocessable Entity.
 */
export class UnsupportedSchemaVersionError extends Error {
  readonly schemaVersion: string;
  readonly supportedMajorVersions: readonly number[];

  constructor(schemaVersion: string) {
    super(
      `Unsupported schema version "${schemaVersion}". ` +
      `Supported major versions: ${SUPPORTED_MAJOR_VERSIONS.join(", ")}. ` +
      `Received major: ${parseMajorVersion(schemaVersion)}.`,
    );
    this.name = "UnsupportedSchemaVersionError";
    this.schemaVersion = schemaVersion;
    this.supportedMajorVersions = SUPPORTED_MAJOR_VERSIONS;
  }
}
