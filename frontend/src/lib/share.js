/* Share an episode through Android's share sheet. */

import { Share } from '@capacitor/share'
import { shareText } from './episodeList.js'

/** Returns true if the share sheet was opened. */
export async function shareEpisode(episode, showTitle) {
  const { title, text, url } = shareText(episode, showTitle)
  try {
    await Share.share({ title, text, url: url || undefined, dialogTitle: 'Share episode' })
    return true
  } catch {
    return false // dismissed or unavailable
  }
}
