import {
  type SiteContentItem,
  CONTENT_EVENT,
} from '../data/contentTypes'
import { hasRemoteApi } from './config'
import { fetchNoticias } from './publicApi'
import { noticiaToContentItem } from './mappers'
import { adminListNoticias } from './adminCms'
import { isLoggedIn } from './authToken'

let cached: SiteContentItem[] = []

export function readSiteContentSync(): SiteContentItem[] {
  return cached
}

/** Noticias de comunidad desde API. */
export async function fetchSiteContent(): Promise<SiteContentItem[]> {
  if (!hasRemoteApi()) {
    cached = []
    return []
  }
  try {
    const noticias = isLoggedIn()
      ? await adminListNoticias()
      : await fetchNoticias()
    cached = noticias
      .map((n) => {
        const item = noticiaToContentItem(n)
        if (!item) return null
        if ('estado' in n && (n as { estado?: string }).estado) {
          return {
            ...item,
            published: (n as { estado: string }).estado === 'PUBLICADA',
          }
        }
        return item
      })
      .filter(Boolean) as SiteContentItem[]
    window.dispatchEvent(new Event(CONTENT_EVENT))
    return cached
  } catch {
    return cached
  }
}
