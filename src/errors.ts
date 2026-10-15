export class GatewayError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
  }
}
