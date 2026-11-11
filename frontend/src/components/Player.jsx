/* Player entry point: the native ExoPlayer-backed player in the Android app,
 * and the <audio>-based one in the browser / PWA. */

import { isNative } from '../api'
import NativePlayer from './NativePlayer'
import WebPlayer from './WebPlayer'

export default function Player({ nowPlaying, queue, onEnded, onNativeChange, onQueueChanged }) {
  if (isNative()) {
    return (
      <NativePlayer
        nowPlaying={nowPlaying}
        queue={queue}
        onNativeChange={onNativeChange}
        onQueueChanged={onQueueChanged}
      />
    )
  }
  return (
    <WebPlayer
      episode={nowPlaying ? nowPlaying.episode : null}
      showTitle={nowPlaying ? nowPlaying.showTitle : ''}
      autoplay={nowPlaying ? nowPlaying.autoplay : false}
      onEnded={onEnded}
    />
  )
}
