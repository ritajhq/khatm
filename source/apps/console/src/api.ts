import { Client, ControlError } from '@khatm/client'

/** The control API, through this console instance's relay. The browser's session cookie goes with it. */
export const api = new Client({ url: `${globalThis.location?.origin}/control` })
  .api

export function describeError(error: unknown): string {
  if (error instanceof ControlError) {
    const details = error.body.details?.length
      ? `: ${error.body.details.join('; ')}`
      : ''
    return `${error.message}${details}`
  }
  return error instanceof Error ? error.message : String(error)
}

export { ControlError }
