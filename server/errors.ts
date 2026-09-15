/**
 * Structured error thrown by provider clients when an upstream API call fails
 * or returns a shape we cannot make sense of. Routes catch this and translate
 * it into a clear 502-style response — the frontend never sees a fabricated
 * 200 with placeholder data.
 */
export class ProviderError extends Error {
  /** HTTP status returned by the upstream provider, if any (0 = network/parse failure). */
  status: number;
  /** The provider this error came from, e.g. "sportradar" or "sportmonks". */
  provider: string;

  constructor(provider: string, status: number, message: string) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = status;
  }
}

/** Thrown when the caller did not supply a provider API key. */
export class MissingKeyError extends Error {
  constructor(message = 'Missing provider API key') {
    super(message);
    this.name = 'MissingKeyError';
  }
}
