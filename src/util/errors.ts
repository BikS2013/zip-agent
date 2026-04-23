/**
 * Typed error taxonomy for zip-agent. Each class maps to a stable exit code
 * via {@link ./exit-codes.ts}. Throwing one of these from a command's run()
 * is the contract for user-facing failure modes.
 */
export class CliError extends Error {
  public readonly code: string;
  public readonly httpStatus?: number;
  constructor(code: string, message: string, httpStatus?: number) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    if (httpStatus !== undefined) this.httpStatus = httpStatus;
  }
}

export class UsageError extends CliError {
  constructor(message: string) {
    super('USAGE', message);
  }
}

export class ConfigurationError extends CliError {
  public readonly missingSetting: string;
  public readonly checkedSources: readonly string[];
  public readonly detail?: string;
  constructor(missingSetting: string, checkedSources: readonly string[], detail?: string) {
    const checked = checkedSources.join(', ');
    const detailSuffix = detail ? ` ${detail}` : '';
    super(
      'CONFIG_MISSING',
      `Mandatory setting "${missingSetting}" was not provided. Checked: ${checked}.${detailSuffix}`,
    );
    this.missingSetting = missingSetting;
    this.checkedSources = checkedSources;
    if (detail !== undefined) this.detail = detail;
  }
}

export class AuthError extends CliError {
  constructor(message: string, httpStatus?: number) {
    super('AUTH', message, httpStatus);
  }
}

export class UpstreamError extends CliError {
  constructor(message: string, httpStatus?: number) {
    super('UPSTREAM', message, httpStatus);
  }
}

export class IoError extends CliError {
  constructor(message: string) {
    super('IO', message);
  }
}

export class CollisionError extends CliError {
  constructor(message: string) {
    super('COLLISION', message);
  }
}
