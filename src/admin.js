export function rupeesToPaise(value, { allowZero = false } = {}) {
  const amount = String(value).trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) {
    throw new Error('Enter a price with up to two decimal places.')
  }
  const paise = Math.round(Number(amount) * 100)
  if (!Number.isSafeInteger(paise) || paise < (allowZero ? 0 : 1) || paise > 1_000_000_000) {
    throw new Error('Price is outside the supported range.')
  }
  return paise
}

export function parseStockDelta(value) {
  const amount = String(value).trim()
  if (!/^-?\d+$/.test(amount)) throw new Error('Enter a whole number of grams.')
  const grams = Number(amount)
  if (!Number.isSafeInteger(grams) || grams === 0 || Math.abs(grams) > 1_000_000) {
    throw new Error('Adjustment must be between -1,000,000 and 1,000,000 grams, excluding zero.')
  }
  return grams
}
