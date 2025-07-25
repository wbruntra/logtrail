import { useState, useEffect, useCallback, useMemo } from 'react'
import type { LogLine } from '../types/logTypes'

interface UseLogSearchReturn {
  searchQuery: string
  setSearchQuery: (query: string) => void
  filteredLogs: LogLine[]
  isSearching: boolean
  matchCount: number
  clearSearch: () => void
  debouncedQuery: string
}

export const useLogSearch = (logs: LogLine[]): UseLogSearchReturn => {
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')

  // Debounce search query to avoid excessive filtering
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim())
    }, 300)

    return () => clearTimeout(timer)
  }, [searchQuery])

  // Filter logs based on search query
  const filteredLogs = useMemo(() => {
    // Don't filter if query is empty or too short
    if (!debouncedQuery || debouncedQuery.length < 2) {
      return logs
    }

    try {
      // Check if query might be a regex (contains special regex characters)
      const isRegexLike = /[.*+?^${}()|[\]\\]/.test(debouncedQuery)
      
      if (isRegexLike) {
        // Try to use as regex
        try {
          const regex = new RegExp(debouncedQuery, 'i')
          return logs.filter(log => regex.test(log.content))
        } catch {
          // If regex is invalid, fall back to string search
          const lowerQuery = debouncedQuery.toLowerCase()
          return logs.filter(log => log.content.toLowerCase().includes(lowerQuery))
        }
      } else {
        // Simple case-insensitive string search
        const lowerQuery = debouncedQuery.toLowerCase()
        return logs.filter(log => log.content.toLowerCase().includes(lowerQuery))
      }
    } catch {
      // Fallback for any unexpected errors
      return logs
    }
  }, [logs, debouncedQuery])

  const isSearching = Boolean(debouncedQuery && debouncedQuery.length >= 2)
  const matchCount = isSearching ? filteredLogs.length : logs.length

  const clearSearch = useCallback(() => {
    setSearchQuery('')
  }, [])

  return {
    searchQuery,
    setSearchQuery,
    filteredLogs,
    isSearching,
    matchCount,
    clearSearch,
    debouncedQuery
  }
}
