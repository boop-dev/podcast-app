/* The app's data layer: everything runs on the device (IndexedDB storage,
 * native HTTP for feeds, real files for downloads). See ./mobile/api.js. */

import { mobileApi } from './mobile/api.js'

export const api = mobileApi

/** OPML export: writes podcast-subscriptions.opml into the Documents folder
 *  and returns its URI. */
export async function exportOpmlToFile() {
  return mobileApi.saveOpmlToFile()
}
