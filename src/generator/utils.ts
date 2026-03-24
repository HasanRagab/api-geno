import { Endpoint } from '../models'

export function sanitizeIdentifier(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9_$]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((token, idx) => {
      if (idx === 0) {
        return token.charAt(0).toLowerCase() + token.slice(1)
      }
      return token.charAt(0).toUpperCase() + token.slice(1)
    })
    .join('')

  if (!cleaned) return 'unnamed'
  if (/^[0-9]/.test(cleaned)) {
    return `_${cleaned}`
  }
  return cleaned
}

export function getOperationIdOrFallback(endpoint: Endpoint): string {
  if (endpoint.operationId && typeof endpoint.operationId === 'string' && endpoint.operationId.trim() !== '') {
    return endpoint.operationId
  }

  const safePath = endpoint.path.replace(/[{}]/g, '').replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '')
  return `${endpoint.method.toLowerCase()}_${safePath || 'root'}`
}

export function safeMethodName(endpoint: Endpoint, used: Set<string>): string {
  const base = sanitizeIdentifier(getOperationIdOrFallback(endpoint))
  let candidate = base
  let suffix = 1
  while (used.has(candidate)) {
    candidate = `${base}${suffix}`
    suffix += 1
  }
  used.add(candidate)
  return candidate
}
