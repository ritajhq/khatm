import { createContext, type ReactNode, useContext, useMemo } from 'react'
import {
  chooseLocale,
  type MessageId,
  PageConfig,
  resolveMessages,
} from '@khatm/pages'

interface Page {
  config: PageConfig
  /** The text for a message id, in the visitor's language when the branding has one. */
  t(id: MessageId): string
}

const PageContext = createContext<Page | undefined>(undefined)

/** The config the worker embedded in the page, checked against its schema. */
export function readConfig(document: Document): PageConfig {
  const element = document.getElementById('khatm-config')
  if (!element?.textContent) throw new Error('The page has no khatm config')
  return PageConfig.parse(JSON.parse(element.textContent))
}

export function PageProvider(
  { config, languages, children }: {
    config: PageConfig
    languages: readonly string[]
    children: ReactNode
  },
) {
  const page = useMemo<Page>(() => {
    const messages = resolveMessages(
      config.messages,
      chooseLocale(languages, config.messages),
    )
    return { config, t: (id) => messages[id] }
  }, [config, languages])
  return <PageContext.Provider value={page}>{children}</PageContext.Provider>
}

export function usePage(): Page {
  const page = useContext(PageContext)
  if (!page) throw new Error('usePage needs a PageProvider')
  return page
}
