/** Extensions routed to local Office extraction or configured media recognition. */
export const OFFICE_EXTENSIONS = new Set(['docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods'])
export const AUDIO_EXTENSIONS = new Set(['mp3', 'mpga', 'm4a', 'wav', 'flac', 'ogg', 'oga'])
export const VIDEO_EXTENSIONS = new Set(['mp4', 'mpeg', 'mpg', 'mov', 'webm', 'mkv', 'avi', 'm4v'])

/** Return a lower-case extension without its leading dot.
 * @param name - file name from an attachment or browser File.
 * @returns the extension, or an empty string when none is present.
 */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/** Accepted Office settings used to decide whether a media file is ready to upload.
 */
export interface OfficeMediaSettings {
  audioEndpoint?: string
  audioModel?: string
  videoEndpoint?: string
  videoModel?: string
}

/** Match the Host's media-ready rule for a browser filename and accepted values.
 * @param name - browser File name.
 * @param settings - last Host-accepted Office settings snapshot.
 * @returns whether the extension is supported and its endpoint and model are configured.
 */
export function acceptsOfficeNativeUpload(name: string, settings: OfficeMediaSettings | undefined): boolean {
  const extension = fileExtension(name)
  if (OFFICE_EXTENSIONS.has(extension) || extension === 'pdf') return true
  const configured = (endpoint: string | undefined, model: string | undefined): boolean =>
    (endpoint?.trim().length ?? 0) > 0 && (model?.trim().length ?? 0) > 0
  if (AUDIO_EXTENSIONS.has(extension)) return configured(settings?.audioEndpoint, settings?.audioModel)
  if (VIDEO_EXTENSIONS.has(extension)) return configured(settings?.videoEndpoint, settings?.videoModel)
  return false
}
