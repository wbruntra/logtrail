import { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react'

interface UseAutoScrollReturn {
  autoScroll: boolean
  setAutoScroll: (enabled: boolean) => void
  scrollToBottom: () => void
  handleScroll: () => void
  containerRef: React.RefObject<HTMLDivElement | null>
  scrollRestoreRef: React.MutableRefObject<{
    prevScrollHeight: number
    prevScrollTop: number
    pending: boolean
  }>
}

export const useAutoScroll = (
  logs: string[]
): UseAutoScrollReturn => {
  const [autoScroll, setAutoScroll] = useState(true)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const scrollRestoreRef = useRef<{
    prevScrollHeight: number
    prevScrollTop: number
    pending: boolean
  }>({ prevScrollHeight: 0, prevScrollTop: 0, pending: false })

  const scrollToBottom = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [])

  // Auto-scroll logic
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  // Restore scroll position after prepending history lines
  useLayoutEffect(() => {
    if (scrollRestoreRef.current.pending && containerRef.current) {
      const { prevScrollHeight, prevScrollTop } = scrollRestoreRef.current
      containerRef.current.scrollTop =
        containerRef.current.scrollHeight - prevScrollHeight + prevScrollTop
      scrollRestoreRef.current.pending = false
    }
  }, [logs])

  // Simple scroll handler that only manages auto-scroll state
  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return

    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 10
    setAutoScroll(atBottom)
  }, [])

  return {
    autoScroll,
    setAutoScroll,
    scrollToBottom,
    handleScroll,
    containerRef,
    scrollRestoreRef
  }
}
