export interface LogFile {
  name: string
  path: string
  description?: string
}

export interface LogLine {
  lineNumber: number
  content: string
}
