import type { ErrorBody, ErrorCode } from '@khatm/contract'

/** A failure the control API answers with this code, as is. */
export class ControlError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly extra: Partial<ErrorBody['error']> = {},
  ) {
    super(message)
  }
}
