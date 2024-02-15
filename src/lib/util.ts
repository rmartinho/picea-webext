export function titleCase(str: string): string {
  return str.toLowerCase().replace(/\b\w/g, s => s.toUpperCase())
}
export function timeout(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
