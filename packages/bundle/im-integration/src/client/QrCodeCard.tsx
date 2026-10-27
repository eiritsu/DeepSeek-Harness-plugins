/** SVG QR Code renderer for authentication and device pairing tokens. */

import type { ReactNode } from 'react'
import { encode } from 'uqr'

/** Props for the SVG QR code renderer. */
export interface QrCodeSvgProps {
  readonly value: string
  readonly size?: number
  readonly className?: string
}

/**
 * Generate an authentic QR code SVG path data string using uqr.
 * @param text - The content string to encode.
 * @returns SVG path data string representing all dark modules.
 */
export function generateQrPath(text: string): string {
  const { data, size } = encode(text)
  let path = ''
  for (let r = 0; r < size; r++) {
    const row = data[r]
    if (!row) continue
    for (let c = 0; c < size; c++) {
      if (row[c]) {
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
  const { data, size: matrixSize } = encode(value)
  let path = ''
  for (let r = 0; r < matrixSize; r++) {
    const row = data[r]
    if (!row) continue
    for (let c = 0; c < matrixSize; c++) {
      if (row[c]) {
        path += `M${c + 2},${r + 2}h1v1h-1z`
      }
    }
  }
  const total = matrixSize + 4

  return (
    <svg
      viewBox={`0 0 ${total} ${total}`}
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      shapeRendering="crispEdges"
      aria-label="QR Code"
    >
      <rect width={total} height={total} fill="#ffffff" rx={2} />
      <path d={path} fill="#111827" />
    </svg>
  )
}
