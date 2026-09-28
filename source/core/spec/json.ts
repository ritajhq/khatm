/** A value that survives a JSON round trip unchanged: what a manifest is made of. */
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json }
