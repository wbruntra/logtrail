import { useEffect, useRef } from 'preact/hooks'

/**
 * Calls `load` when the returned sentinel element comes within `margin` of
 * the viewport, so lists page in as you scroll. Pass `enabled: false` while a
 * page is loading, when there is no more, or after an error (leaving a manual
 * retry). `count` is the number of items loaded: observing again after each
 * page lets a short page that leaves the sentinel on screen load the next.
 */
export function useLoadMore<T extends Element>(
  load: () => void,
  { enabled, count, margin = '600px' }: { enabled: boolean; count: number; margin?: string },
) {
  const ref = useRef<T>(null)
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    const el = ref.current
    if (!enabled || !el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadRef.current()
      },
      { rootMargin: `0px 0px ${margin} 0px` },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [enabled, count, margin])

  return ref
}
