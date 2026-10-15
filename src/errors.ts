export class GatewayError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly diagnostics?: {
      dependency: 'directory' | 'upstream'; phase: 'credential' | 'request' | 'response';
      status?: number; causeType?: string
    }
  ) {
    super(code);
  }
}
