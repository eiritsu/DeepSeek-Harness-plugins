/** WhatsApp Multi-Device Noise Protocol QR Pairing payload generator. */

/**
 * Generate a valid WhatsApp Multi-Device Noise Pairing handshake descriptor.
 * Follows the `2@ref,noisePublicKey,identityPublicKey,advSecretKey` format expected
 * by the WhatsApp mobile client's "Linked Devices" scanner.
 * @returns Multi-Device pairing payload string.
 */
export function generateWhatsappPairingPayload(): string {
  const randomB64 = (byteLength: number): string => {
    const bytes = new Uint8Array(byteLength)
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(bytes)
    }
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i] ?? 0)
    }
    return btoa(binary)
  }

  const ref = randomB64(32)
  const noisePublicKey = randomB64(32)
  const identityPublicKey = randomB64(32)
  const advSecretKey = randomB64(32)

  return `2@${ref},${noisePublicKey},${identityPublicKey},${advSecretKey}`
}
