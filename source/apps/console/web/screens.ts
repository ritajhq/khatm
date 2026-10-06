import type { IconName } from '@khatm-libs/ui'

/** How auth is configured, then who uses it: two planes, kept apart in the sidebar. */
export type Plane = 'control' | 'data'

export type ScreenId =
  | 'overview'
  | 'revisions'
  | 'configuration'
  | 'branding'
  | 'users'
  | 'audit'

export interface Screen {
  readonly id: ScreenId
  readonly label: string
  readonly description: string
  readonly icon: IconName
  readonly plane: Plane
  /** Screens that edit the draft manifest, and end in the plan bar. */
  readonly edits: boolean
}

export const SCREENS: readonly Screen[] = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'What is serving, and whether it is healthy',
    icon: 'home',
    plane: 'control',
    edits: false,
  },
  {
    id: 'revisions',
    label: 'Revisions',
    description: 'Every applied manifest, and rolling back to one',
    icon: 'clock',
    plane: 'control',
    edits: false,
  },
  {
    id: 'configuration',
    label: 'Configuration',
    description: 'The manifest and the plugins it turns on',
    icon: 'sliders-horizontal',
    plane: 'control',
    edits: true,
  },
  {
    id: 'branding',
    label: 'Branding',
    description: 'How the login pages look, previewed live',
    icon: 'palette',
    plane: 'control',
    edits: true,
  },
  {
    id: 'users',
    label: 'Users',
    description: 'Who signs in, their roles, bans and sessions',
    icon: 'users',
    plane: 'data',
    edits: false,
  },
  {
    id: 'audit',
    label: 'Audit',
    description: 'Who did what to whom',
    icon: 'shield',
    plane: 'data',
    edits: false,
  },
]

export const PLANES: readonly {
  readonly plane: Plane
  readonly label: string
}[] = [
  { plane: 'control', label: 'Control plane' },
  { plane: 'data', label: 'Data plane' },
]

/** The screen a `#/…` hash names, the overview otherwise. */
export function ScreenOf(hash: string): Screen {
  return SCREENS.find((screen) => `#/${screen.id}` === hash) ?? SCREENS[0]
}
