import { useState, useCallback } from 'react'
import type { LogLine } from '../types/logTypes'

export interface SearchResult extends LogLine {
  // LogLine already has lineNumber and content
}

export interface SearchResponse {
  query: string
  regex: boolean
  caseSensitive: boolean
  totalMatches: number
  results: SearchResult[]
  truncated: boolean
}

export interface ContextLine extends LogLine {
  isTarget: boolean
}

export interface ContextResponse {
  targetLine: number
  contextLines: number
  startLine: number
  endLine: number
  totalLines: number
  lines: ContextLine[]
}

interface UseBackendSearchReturn {
  searchResults: SearchResult[]
  contextData: ContextResponse | null
  isSearching: boolean
  isLoadingContext: boolean
  searchFile: (file: string, query: string, options?: { regex?: boolean; caseSensitive?: boolean }) => Promise<void>
  getContext: (file: string, lineNumber: number, contextLines?: number) => Promise<void>
  clearResults: () => void
  clearContext: () => void
}

export const useBackendSearch = (): UseBackendSearchReturn => {
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [contextData, setContextData] = useState<ContextResponse | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [isLoadingContext, setIsLoadingContext] = useState(false)

  const searchFile = useCallback(async (
    file: string, 
    query: string, 
    options: { regex?: boolean; caseSensitive?: boolean } = {}
  ) => {
    if (!query.trim()) return

    setIsSearching(true)
    try {
      const params = new URLSearchParams({
        file,
        query: query.trim(),
        regex: options.regex ? 'true' : 'false',
        caseSensitive: options.caseSensitive ? 'true' : 'false'
      })

      const response = await fetch(`/api/logs/search?${params}`, {
        credentials: 'include'
      })

      if (!response.ok) {
        throw new Error(`Search failed: ${response.statusText}`)
      }

      const data: SearchResponse = await response.json()
      setSearchResults(data.results)
    } catch (error) {
      console.error('Search error:', error)
      setSearchResults([])
    } finally {
      setIsSearching(false)
    }
  }, [])

  const getContext = useCallback(async (
    file: string, 
    lineNumber: number, 
    contextLines: number = 10
  ) => {
    setIsLoadingContext(true)
    try {
      const params = new URLSearchParams({
        file,
        context: contextLines.toString()
      })

      const response = await fetch(`/api/logs/context/${lineNumber}?${params}`, {
        credentials: 'include'
      })

      if (!response.ok) {
        throw new Error(`Context fetch failed: ${response.statusText}`)
      }

      const data: ContextResponse = await response.json()
      setContextData(data)
    } catch (error) {
      console.error('Context error:', error)
      setContextData(null)
    } finally {
      setIsLoadingContext(false)
    }
  }, [])

  const clearResults = useCallback(() => {
    setSearchResults([])
  }, [])

  const clearContext = useCallback(() => {
    setContextData(null)
  }, [])

  return {
    searchResults,
    contextData,
    isSearching,
    isLoadingContext,
    searchFile,
    getContext,
    clearResults,
    clearContext
  }
}
