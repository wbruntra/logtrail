export interface HighlightedSegment {
  text: string
  isMatch: boolean
}

/**
 * Highlight search matches in text
 */
export function highlightSearchMatches(
  text: string, 
  searchQuery: string
): HighlightedSegment[] {
  if (!searchQuery.trim()) {
    return [{ text, isMatch: false }]
  }

  try {
    // Check if query might be a regex
    const isRegexLike = /[.*+?^${}()|[\]\\]/.test(searchQuery)
    let regex: RegExp

    if (isRegexLike) {
      try {
        regex = new RegExp(`(${searchQuery})`, 'gi')
      } catch {
        // If regex is invalid, treat as literal string
        const escapedQuery = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        regex = new RegExp(`(${escapedQuery})`, 'gi')
      }
    } else {
      // Simple case-insensitive search
      const escapedQuery = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      regex = new RegExp(`(${escapedQuery})`, 'gi')
    }

    const parts = text.split(regex)
    const segments: HighlightedSegment[] = []

    for (let i = 0; i < parts.length; i++) {
      if (parts[i]) {
        const isMatch = i % 2 === 1 // Odd indices are matches due to split with capturing group
        segments.push({
          text: parts[i],
          isMatch
        })
      }
    }

    return segments.length > 0 ? segments : [{ text, isMatch: false }]
  } catch {
    // Fallback for any errors
    return [{ text, isMatch: false }]
  }
}
