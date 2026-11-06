import { useEffect, useState } from 'react'
import {
  CONTENT_EVENT,
  type ContentArea,
  type SiteContentItem,
} from './contentTypes'
import { fetchSiteContent, readSiteContentSync } from '../api/contentApi'
import type { FeedItem } from './feedStore'

export function contentToFeedItem(item: SiteContentItem): FeedItem {
  const link = item.linkUrl.trim()
  const external = /^https?:\/\//i.test(link)
  return {
    id: `noticia:${item.id}`,
    source: 'web',
    title: item.title,
    body: item.body,
    dateISO: item.dateISO,
    dateLabel: item.dateLabel,
    imageUrl: item.imageUrl?.trim() || '',
    href: link || `/vida/noticias/${item.id}`,
    external: Boolean(link && external),
    area: item.area,
    moreLabel: item.linkLabel?.trim() || undefined,
  }
}

export function useSiteContent(area?: ContentArea) {
  const [items, setItems] = useState<SiteContentItem[]>(() => readSiteContentSync())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetchSiteContent()
      .then((data) => {
        if (!cancelled) setItems(data)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    function sync() {
      void fetchSiteContent()
        .then((data) => {
          if (!cancelled) setItems(data)
        })
        .catch(() => {})
    }
    window.addEventListener(CONTENT_EVENT, sync)
    return () => {
      cancelled = true
      window.removeEventListener(CONTENT_EVENT, sync)
    }
  }, [])

  const filtered = items
    .filter((i) => i.published)
    .filter((i) => (area ? i.area === area : true))
    .sort((a, b) => b.dateISO.localeCompare(a.dateISO))

  return {
    items: filtered,
    all: items,
    loading,
    reload: () => fetchSiteContent().then(setItems),
  }
}
