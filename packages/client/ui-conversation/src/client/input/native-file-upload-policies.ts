/** Client policies that opt native-path files into the standard upload rail. */

/** Additive registry for native files that should upload instead of becoming references. */
export class NativeFileUploadPolicies {
  private readonly policies = new Map<string, { accepts: (file: File) => boolean }>()

  /** Register one additive upload policy.
   * @param id - unique owner id for this registration.
   * @param accepts - returns true when the original file should use the upload path.
   * @returns a disposer that removes only this registration.
   */
  register(id: string, accepts: (file: File) => boolean): () => void {
    if (id.trim() === '') throw new TypeError('nativeFileUploadPolicies: id must not be empty')
    if (this.policies.has(id)) throw new Error(`nativeFileUploadPolicies: duplicate id "${id}"`)
    const registration = { accepts }
    this.policies.set(id, registration)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      if (this.policies.get(id) === registration) this.policies.delete(id)
    }
  }

  /** Return whether any registered policy accepts the file.
   * @param file - original browser File, including any native-path metadata.
   * @returns true when the standard composer should upload the file.
   */
  accepts(file: File): boolean {
    for (const registration of this.policies.values()) if (registration.accepts(file)) return true
    return false
  }

  /** Remove all policies when the owning composer service is disposed. */
  clear(): void { this.policies.clear() }
}
