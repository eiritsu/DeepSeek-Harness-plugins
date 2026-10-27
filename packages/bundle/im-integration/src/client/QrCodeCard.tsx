/** SVG QR Code renderer for authentication and device pairing tokens. */

import type { ReactNode } from 'react'

/** Props for the SVG QR code renderer. */
export interface QrCodeSvgProps {
  readonly value: string
  readonly size?: number
  readonly className?: string
}

/**
 * Generate an authentic Version 3-L QR code SVG path data string.
 * @param text - The content string to encode.
 * @returns SVG path data string representing all dark modules.
 */
export function generateQrPath(text: string): string {
  const size = 29
  const matrix = new Uint8Array(size * size)
  const isFunction = new Uint8Array(size * size)

  const getCell = (r: number, c: number): number => matrix[r * size + c] ?? 0
  const setFunc = (r: number, c: number, val: number): void => {
    matrix[r * size + c] = val
    isFunction[r * size + c] = 1
  }
  const isFunc = (r: number, c: number): boolean => (isFunction[r * size + c] ?? 0) === 1

  // 1. Finder patterns (7x7) + white separators (8x8)
  const placeFinder = (row: number, col: number): void => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const nr = row + r
        const nc = col + c
        if (nr >= 0 && nr < size && nc >= 0 && nc < size) {
          if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
            const isBorder = r === 0 || r === 6 || c === 0 || c === 6
            const isCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4
            setFunc(nr, nc, isBorder || isCenter ? 1 : 0)
          } else {
            setFunc(nr, nc, 0)
          }
        }
      }
    }
  }

  placeFinder(0, 0)
  placeFinder(0, size - 7)
  placeFinder(size - 7, 0)

  // 2. Alignment pattern (5x5) at center (22, 22) for Version 3
  const alignR = 22
  const alignC = 22
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const isBorder = Math.abs(r) === 2 || Math.abs(c) === 2
      const isCenter = r === 0 && c === 0
      setFunc(alignR + r, alignC + c, isBorder || isCenter ? 1 : 0)
    }
  }

  // 3. Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (!isFunc(6, i)) setFunc(6, i, i % 2 === 0 ? 1 : 0)
    if (!isFunc(i, 6)) setFunc(i, 6, i % 2 === 0 ? 1 : 0)
  }

  // 4. Dark module
  setFunc(4 * 3 + 9, 8, 1)

  // 5. Reserve format info modules
  for (let i = 0; i < 9; i++) {
    if (!isFunc(8, i)) isFunction[8 * size + i] = 1
    if (!isFunc(i, 8)) isFunction[i * size + 8] = 1
  }
  for (let i = size - 8; i < size; i++) {
    if (!isFunc(8, i)) isFunction[8 * size + i] = 1
    if (!isFunc(i, 8)) isFunction[i * size + 8] = 1
  }

  // 6. GF(256) log and exp tables
  const exp = new Uint8Array(512)
  const log = new Uint8Array(256)
  let x = 1
  for (let i = 0; i < 255; i++) {
    exp[i] = x
    exp[i + 255] = x
    log[x] = i
    x = (x << 1) ^ (x >= 128 ? 0x11d : 0)
  }
  const gMul = (a: number, b: number): number => {
    if (a === 0 || b === 0) return 0
    const logSum = (log[a] ?? 0) + (log[b] ?? 0)
    return exp[logSum] ?? 0
  }

  // 7. RS generator polynomial for 15 EC codewords
  let gen: number[] = [1]
  for (let i = 0; i < 15; i++) {
    const next = new Array<number>(gen.length + 1).fill(0)
    const factor = exp[i] ?? 0
    for (let j = 0; j < gen.length; j++) {
      const gj = gen[j] ?? 0
      next[j] = (next[j] ?? 0) ^ gj
      next[j + 1] = (next[j + 1] ?? 0) ^ gMul(gj, factor)
    }
    gen = next
  }

  // 8. Data codewords in byte mode (up to 53 bytes for Version 3-L)
  const rawBytes = new TextEncoder().encode(text.slice(0, 53))
  const bits: number[] = []
  const pushBits = (val: number, len: number): void => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1)
  }
  pushBits(0b0100, 4)
  pushBits(rawBytes.length, 8)
  for (let i = 0; i < rawBytes.length; i++) {
    pushBits(rawBytes[i] ?? 0, 8)
  }
  pushBits(0, Math.min(4, 55 * 8 - bits.length))
  while (bits.length % 8 !== 0) bits.push(0)

  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0
    for (let j = 0; j < 8; j++) b = (b << 1) | (bits[i + j] ?? 0)
    data.push(b)
  }
  const padPatterns = [0xec, 0x11]
  let padIdx = 0
  while (data.length < 55) {
    data.push(padPatterns[padIdx % 2] ?? 0)
    padIdx++
  }

  // 9. Calculate error correction remainder
  const remainder = new Array<number>(15).fill(0)
  for (let i = 0; i < data.length; i++) {
    const lead = (data[i] ?? 0) ^ (remainder[0] ?? 0)
    for (let j = 0; j < 14; j++) {
      remainder[j] = (remainder[j + 1] ?? 0) ^ gMul(gen[j + 1] ?? 0, lead)
    }
    remainder[14] = gMul(gen[15] ?? 0, lead)
  }

  const allCodewords = [...data, ...remainder]
  const allBits: number[] = []
  for (const b of allCodewords) {
    for (let i = 7; i >= 0; i--) allBits.push((b >> i) & 1)
  }

  // 10. Place data bits in 2-column zigzag and apply mask 0 ((row + col) % 2 === 0)
  let bitIdx = 0
  let up = true
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--
    const cols = [right, right - 1]
    const rows: number[] = []
    for (let r = 0; r < size; r++) rows.push(up ? size - 1 - r : r)
    for (const r of rows) {
      for (const c of cols) {
        if (!isFunc(r, c)) {
          const bit = bitIdx < allBits.length ? (allBits[bitIdx++] ?? 0) : 0
          const mask = (r + c) % 2 === 0
          matrix[r * size + c] = mask ? bit ^ 1 : bit
        }
      }
    }
    up = !up
  }

  // 11. Format information (ECC L, Mask 0 = 0x77c4)
  const formatBits = 0x77c4
  for (let i = 0; i < 15; i++) {
    const bit = (formatBits >> (14 - i)) & 1
    if (i <= 5) matrix[8 * size + i] = bit
    else if (i === 6) matrix[8 * size + 7] = bit
    else if (i === 7) matrix[8 * size + 8] = bit
    else if (i === 8) matrix[7 * size + 8] = bit
    else matrix[(14 - i) * size + 8] = bit

    if (i < 8) {
      matrix[(size - 1 - i) * size + 8] = bit
    } else {
      matrix[8 * size + (size - 15 + i)] = bit
    }
  }

  // 12. Build SVG path with 2 modules quiet zone
  let path = ''
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (getCell(r, c) === 1) {
        path += `M${c + 2},${r + 2}h1v1h-1z`
      }
    }
  }
  return path
}

/**
 * Render a scalable SVG QR Code component on a white backing canvas.
 * @param props - Value to encode and optional pixel size.
 * @returns Crisp SVG QR Code element.
 */
export function QrCodeSvg(props: QrCodeSvgProps): ReactNode {
  const { value, size = 220, className } = props
  const path = generateQrPath(value)

  return (
    <svg
      viewBox="0 0 33 33"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      shapeRendering="crispEdges"
      aria-label="QR Code"
    >
      <rect width={33} height={33} fill="#ffffff" rx={1.5} />
      <path d={path} fill="#111827" />
    </svg>
  )
}
